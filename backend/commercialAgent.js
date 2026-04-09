const {
  detectIntent,
  hasServiceGuidanceIntent,
  safeParseJson,
  systemPromptForMode,
  getCars,
} = require("./agent");
const { searchServiceKnowledgeRuntime } = require("./serviceKnowledge");
const {
  buildAgentPayload,
  deriveAgentStageCodeForCommercial,
  deriveAgentStatus: deriveSharedAgentStatus,
} = require("./agentRuntimeContract");
const {
  buildRoutingPolicy,
  enforceToolRoutingPolicy,
  resolveDeterministicFallback,
} = require("./agentRuntimePolicy");

const ALLOWED_MODES = new Set(["recommendation", "comparison", "service"]);
const ALLOWED_TOOLS = new Set([
  "recall_memory",
  "search_catalog",
  "compare_catalog",
  "find_stores",
  "search_service_knowledge",
]);
const MAX_TOOL_CALLS = 3;
const MAX_CONTEXT_MESSAGES = 8;
const LLM_TIMEOUT_MS = Math.max(1000, Number(process.env.LLM_TIMEOUT_MS || 8000));
const LLM_PLANNER_TIMEOUT_MS = Math.max(
  1200,
  Number(process.env.LLM_PLANNER_TIMEOUT_MS || Math.min(LLM_TIMEOUT_MS, 2500))
);
const LLM_SYNTHESIS_TIMEOUT_MS = Math.max(
  4000,
  Number(process.env.LLM_SYNTHESIS_TIMEOUT_MS || Math.max(12000, LLM_TIMEOUT_MS))
);
const ENABLE_LLM_PLANNER = process.env.AGENT_USE_LLM_PLANNER === "true";

function createTaskMemoryState() {
  return {
    activeTaskType: "",
    goal: "",
    stage: "",
    pendingAction: "",
    city: "",
    focusedCar: "",
    focusedCars: [],
    readyToConvert: false,
    updatedAt: new Date().toISOString(),
  };
}

function createSessionState() {
  const now = new Date().toISOString();
  return {
    createdAt: now,
    lastActiveAt: now,
    messages: [],
    profile: {},
    clientProfileId: "",
    userProfile: {},
    userMemorySummary: "",
    memorySummary: "",
    lastMode: "service",
    taskMemory: createTaskMemoryState(),
    turns: [],
  };
}

function trimSessionMessages(messages, max = 24) {
  if (!Array.isArray(messages) || messages.length <= max) return messages || [];
  return messages.slice(-max);
}

function withTimeout(promise, timeoutMs, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label || "operation"} timeout`)), timeoutMs);
    }),
  ]);
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+]+/gu, "");
}

function normalizeLooseCarToken(value) {
  return normalizeText(value)
    .replace(/mo(?=\d)/g, "m")
    .replace(/o(?=\d)/g, "0");
}

function uniqueStrings(list) {
  return [...new Set((Array.isArray(list) ? list : []).map((item) => String(item || "").trim()).filter(Boolean))];
}

function emitAgentStep(onStep, step) {
  if (typeof onStep !== "function" || !step || typeof step !== "object") return;
  try {
    onStep(step);
  } catch {}
}

function pickFirstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function compactTaskMemory(taskMemory) {
  const next = {
    activeTaskType: pickFirstString(taskMemory?.activeTaskType),
    goal: pickFirstString(taskMemory?.goal),
    stage: pickFirstString(taskMemory?.stage),
    pendingAction: pickFirstString(taskMemory?.pendingAction),
    city: pickFirstString(taskMemory?.city),
    focusedCar: pickFirstString(taskMemory?.focusedCar),
    focusedCars: uniqueStrings(taskMemory?.focusedCars),
    readyToConvert: taskMemory?.readyToConvert === true,
    updatedAt: pickFirstString(taskMemory?.updatedAt) || new Date().toISOString(),
  };

  if (!next.focusedCar && next.focusedCars.length === 1) {
    next.focusedCar = next.focusedCars[0];
  }
  if (next.focusedCar && !next.focusedCars.includes(next.focusedCar)) {
    next.focusedCars = [next.focusedCar, ...next.focusedCars];
  }

  return Object.fromEntries(
    Object.entries(next).filter(([key, value]) => {
      if (key === "readyToConvert") return value === true;
      if (Array.isArray(value)) return value.length > 0;
      return Boolean(value);
    })
  );
}

function normalizeBudgetText(text) {
  return String(text || "")
    .trim()
    .replace(/[－—–~～]/g, "-")
    .replace(/\s+/g, " ");
}

function parseBudgetTextCore(text) {
  const raw = normalizeBudgetText(text);
  if (!raw) return null;
  const cleanRangeMatch = raw.match(
    /(\d+(?:\.\d+)?)\s*(?:万|w)?\s*(?:到|至|-|~)\s*(\d+(?:\.\d+)?)\s*(?:万|w)/i
  );
  const cleanMatches = [...raw.matchAll(/(\d+(?:\.\d+)?)\s*(?:万|w)/gi)].map((m) => Number(m[1]));
  const cleanBelowPattern = /(以内|以下|不超过|最多|封顶)/;
  const cleanAbovePattern = /(以上|起步|起码|至少)/;

  if (cleanRangeMatch) {
    const a = Number(cleanRangeMatch[1]);
    const b = Number(cleanRangeMatch[2]);
    return {
      minWan: Math.min(a, b),
      maxWan: Math.max(a, b),
      raw: cleanRangeMatch[0],
    };
  }

  if (cleanMatches.length) {
    if (cleanBelowPattern.test(raw)) {
      return { minWan: null, maxWan: Math.max(...cleanMatches), raw };
    }
    if (cleanAbovePattern.test(raw)) {
      return { minWan: Math.min(...cleanMatches), maxWan: null, raw };
    }
    return {
      minWan: cleanMatches.length >= 2 ? Math.min(...cleanMatches) : null,
      maxWan: Math.max(...cleanMatches),
      raw,
    };
  }

  const belowPattern = /(以内|内|以下|不超过|最多|封顶)/;
  const abovePattern = /(以上|起步|起码|至少)/;
  const rangePattern =
    /(\d+(?:\.\d+)?)\s*(?:万|w)?\s*(?:到|至|-)\s*(\d+(?:\.\d+)?)\s*(?:万|w)/i;
  const explicitMatches = [...raw.matchAll(/(\d+(?:\.\d+)?)\s*(?:万|w)/gi)].map((m) =>
    Number(m[1])
  );
  const rangeMatch = raw.match(rangePattern);

  if (rangeMatch) {
    const a = Number(rangeMatch[1]);
    const b = Number(rangeMatch[2]);
    return {
      minWan: Math.min(a, b),
      maxWan: Math.max(a, b),
      raw,
    };
  }

  if (!explicitMatches.length) return null;

  if (belowPattern.test(raw)) {
    return { minWan: null, maxWan: Math.max(...explicitMatches), raw };
  }

  if (abovePattern.test(raw)) {
    return { minWan: Math.min(...explicitMatches), maxWan: null, raw };
  }

  return {
    minWan: explicitMatches.length >= 2 ? Math.min(...explicitMatches) : null,
    maxWan: Math.max(...explicitMatches),
    raw,
  };
}

function parseBudgetText(text) {
  return parseBudgetTextCore(text);
}

function numericHintFromText(text) {
  const raw = String(text || "");
  const kmMatch = raw.match(/(\d{3,4})\s*(?:km|公里)/i);
  const wanMatch = raw.match(/(\d+(?:\.\d+)?)\s*(?:万|w)/i);
  return {
    rangeKm: kmMatch ? Number(kmMatch[1]) : null,
    budgetWan: wanMatch ? Number(wanMatch[1]) : null,
  };
}

function parsePriceWan(text) {
  const matches = [...String(text || "").matchAll(/(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  if (!matches.length) return null;
  return Math.min(...matches);
}

function parseRangeKm(text) {
  const matches = [...String(text || "").matchAll(/(\d{3,4})/g)].map((m) => Number(m[1]));
  if (!matches.length) return null;
  return Math.max(...matches);
}

function compactProfile(profile) {
  const next = {
    budget: pickFirstString(profile?.budget),
    city: pickFirstString(profile?.city),
    charging: pickFirstString(profile?.charging),
    seats: pickFirstString(profile?.seats),
    bodyTypes: uniqueStrings(profile?.bodyTypes),
    energyTypes: uniqueStrings(profile?.energyTypes),
    priorities: uniqueStrings(profile?.priorities),
    usage: uniqueStrings(profile?.usage),
    preferredBrands: uniqueStrings(profile?.preferredBrands),
    excludedBrands: uniqueStrings(profile?.excludedBrands),
    mentionedCars: uniqueStrings(profile?.mentionedCars),
  };
  return Object.fromEntries(
    Object.entries(next).filter(([, value]) =>
      Array.isArray(value) ? value.length > 0 : Boolean(value)
    )
  );
}

function buildTaskMemoryProfileHints(taskMemory) {
  const compactTask = compactTaskMemory(taskMemory);
  return compactProfile({
    city: compactTask.city,
    mentionedCars: uniqueStrings([compactTask.focusedCar, ...(compactTask.focusedCars || [])]),
  });
}

function hasAdvisorFollowupSignal(text) {
  return /(?:(?:联系|让|帮我|安排|转).{0,6}顾问|顾问.{0,6}(?:跟进|联系|回电)|跟进|联系我|回电)/u.test(
    String(text || "")
  );
}

function inferTaskTypeFromTurn(mode, message, previousTaskType) {
  const text = String(message || "");
  if (hasAdvisorFollowupSignal(text)) return "advisor_followup";
  if (/试驾|预约|到店/.test(text)) return "test_drive";
  if (/配置|选配/.test(text)) return "configure";
  if (mode === "comparison") return "compare";
  if (mode === "recommendation") return "recommend";
  if (mode === "service") {
    return hasServiceGuidanceIntent(text) ? "service" : previousTaskType || "service";
  }
  return previousTaskType || "service";
}

function deriveTaskMemory({
  previousTaskMemory,
  profile,
  mode,
  message,
  plan,
  structured,
  status,
}) {
  const previous = compactTaskMemory(previousTaskMemory);
  const currentTurnProfile = compactProfile(extractProfileFromTextSafe(message, catalogBrands()));
  const currentFocusedCars = uniqueStrings([
    ...(currentTurnProfile.mentionedCars || []),
    ...getFocusedMentionedCars(profile, message).map((car) => normalizeCarLabel(car)),
  ]);
  const focusedCars = uniqueStrings([
    ...currentFocusedCars,
    ...(previous.focusedCars || []),
    previous.focusedCar || "",
  ]);
  const structuredIntentText = [
    structured?.title,
    structured?.diagnosis,
  ]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join(" ");
  const structuredTaskType = hasAdvisorFollowupSignal(structuredIntentText)
    ? "advisor_followup"
    : /试驾|预约|到店/.test(structuredIntentText)
      ? "test_drive"
      : "";
  const nextTaskType =
    structuredTaskType || inferTaskTypeFromTurn(mode, message, previous.activeTaskType);
  const shouldResetFocusedCars = nextTaskType === "service" && currentFocusedCars.length === 0;
  const nextFocusedCars = shouldResetFocusedCars ? [] : focusedCars;

  return compactTaskMemory({
    ...previous,
    activeTaskType: nextTaskType,
    goal: message,
    stage: plan?.clarify?.needed
      ? "clarify"
      : nextTaskType === "test_drive" || nextTaskType === "advisor_followup"
        ? "awaiting_form"
        : status === "ready_to_convert"
          ? "ready_to_convert"
          : mode === "comparison"
            ? "decision"
            : "active",
    pendingAction: plan?.clarify?.needed
      ? plan.clarify.question
      : pickFirstString(
          Array.isArray(structured?.next_steps) ? structured.next_steps[0] : "",
          Array.isArray(structured?.followups) ? structured.followups[0] : "",
          previous.pendingAction
        ),
    city: pickFirstString(currentTurnProfile.city, profile?.city, previous.city),
    focusedCar: pickFirstString(nextFocusedCars[0]),
    focusedCars: nextFocusedCars,
    readyToConvert:
      status === "ready_to_convert" ||
      nextTaskType === "test_drive" ||
      nextTaskType === "advisor_followup",
    updatedAt: new Date().toISOString(),
  });
}

function parseBudgetTextSafe(text) {
  return parseBudgetTextCore(text);
}

function numericHintFromTextSafe(text) {
  const raw = String(text || "");
  const kmMatch = raw.match(/(\d{3,4})\s*(?:km|\u516c\u91cc)/i);
  const wanMatch = raw.match(/(\d+(?:\.\d+)?)\s*(?:\u4e07|w)/i);
  return {
    rangeKm: kmMatch ? Number(kmMatch[1]) : null,
    budgetWan: wanMatch ? Number(wanMatch[1]) : null,
  };
}

function extractBudgetSnippet(text) {
  const raw = normalizeBudgetText(text);
  if (!raw) return null;
  const cleanRangeMatch = raw.match(
    /(\d+(?:\.\d+)?)\s*(?:万|w)?\s*(?:到|至|-|~)\s*(\d+(?:\.\d+)?)\s*(?:万|w)/i
  );
  if (cleanRangeMatch) return cleanRangeMatch[0];

  const cleanSingleMatch = raw.match(
    /(\d+(?:\.\d+)?)\s*(?:万|w)(?:\s*(?:以内|以下|以上|左右|上下|起步|起码|至少))?/i
  );
  if (cleanSingleMatch) return cleanSingleMatch[0];

  const rangeMatch = raw.match(
    /(\d+(?:\.\d+)?)\s*(?:万|w)?\s*(?:到|至|-)\s*(\d+(?:\.\d+)?)\s*(?:万|w)/i
  );
  if (rangeMatch) return rangeMatch[0];

  const singleMatch = raw.match(
    /(\d+(?:\.\d+)?)\s*(?:万|w)(?:\s*(?:以内|内|以下|以上|左右|上下|起步|起码|至少))?/i
  );
  return singleMatch ? singleMatch[0] : null;
}

function extractCitySnippetSafe(text) {
  const raw = String(text || "");
  const normalized = raw.replace(/\s+/g, "");
  const bannedPrefixes = ["主要", "这个", "那个", "一些", "城市", "同城", "本市", "全市"];
  const cleanCityCandidate = (value) => {
    const candidate = String(value || "").trim().replace(/特别行政区|自治区|自治州|地区|盟/g, "");
    if (!candidate || candidate.length < 2 || candidate.length > 8) return "";
    if (bannedPrefixes.some((item) => candidate.startsWith(item))) return "";
    if (/城市|市区|通勤|场景|全国|同城/.test(candidate)) return "";
    return candidate.replace(/[省市区县]$/g, "");
  };
  const directCnMatch = normalized.match(
    /(?:在|住在|人在|定位到|我在|我是)([\u4e00-\u9fa5]{2,10})(?:市|区|县)?/u
  );
  if (directCnMatch) {
    const cleaned = cleanCityCandidate(directCnMatch[1]);
    if (cleaned) return cleaned;
  }

  const cityCnMatch = normalized.match(
    /(?:^|[，。、“”"'\s])([\u4e00-\u9fa5]{2,8})(?:市|区|县)(?=$|[，。、“”"'\s的了呢呀吗吧人车店门试住买用])/u
  );
  if (cityCnMatch) {
    const cleaned = cleanCityCandidate(cityCnMatch[1]);
    if (cleaned) return cleaned;
  }
  const directMatch = raw.match(
    /(?:在|去|住在|人在|定位到|我在|我是)\s*([\u4e00-\u9fa5]{2,6})(?:市|区|县)?/u
  );
  if (directMatch) {
    const cleaned = cleanCityCandidate(directMatch[1]);
    if (cleaned) return cleaned;
  }

  const fallbackMatch = raw.match(
    /(?:^|[，。、“”"'\s])([\u4e00-\u9fa5]{2,6})(?:市|区|县)(?=$|[，。、“”"'\s的了呢呀吗吧人车店门试住买用])/u
  );
  if (!fallbackMatch) return "";
  return cleanCityCandidate(fallbackMatch[1]);
}

function sanitizeCityHint(value) {
  return extractCitySnippetSafe(String(value || "")) || "";
}

function buildMemorySummarySafe(profile) {
  const parts = [];
  if (profile.budget) parts.push(`\u9884\u7b97 ${profile.budget}`);
  if (profile.city) parts.push(`\u57ce\u5e02 ${profile.city}`);
  if (profile.bodyTypes?.length) parts.push(`\u8f66\u578b\u504f\u597d ${profile.bodyTypes.join(" / ")}`);
  if (profile.energyTypes?.length) parts.push(`\u80fd\u6e90\u504f\u597d ${profile.energyTypes.join(" / ")}`);
  if (profile.priorities?.length) parts.push(`\u5173\u6ce8\u70b9 ${profile.priorities.join(" / ")}`);
  if (profile.usage?.length) parts.push(`\u573a\u666f ${profile.usage.join(" / ")}`);
  if (profile.charging) parts.push(`\u8865\u80fd\u6761\u4ef6 ${profile.charging}`);
  if (profile.preferredBrands?.length) parts.push(`\u504f\u597d\u54c1\u724c ${profile.preferredBrands.join(" / ")}`);
  if (profile.excludedBrands?.length) parts.push(`\u6392\u9664\u54c1\u724c ${profile.excludedBrands.join(" / ")}`);
  return parts.join("\uff1b");
}

function extractProfileFromTextSafe(message, brands) {
  const text = String(message || "");
  const lower = text.toLowerCase();
  const profile = {};
  const budget = extractBudgetSnippet(text);
  const city = extractCitySnippetSafe(text);
  if (budget) profile.budget = budget.trim();
  if (city) profile.city = city;
  if (/(suv|SUV)/.test(text)) profile.bodyTypes = [...(profile.bodyTypes || []), "SUV"];
  if (/(\u8f7f\u8f66|\u8f7f\u8dd1)/.test(text)) profile.bodyTypes = [...(profile.bodyTypes || []), "Sedan"];
  if (/(mpv|MPV|\u516d\u5ea7|\u4e03\u5ea7)/.test(text)) profile.bodyTypes = [...(profile.bodyTypes || []), "MPV"];
  if (/(\u7eaf\u7535|ev|EV)/.test(text)) profile.energyTypes = [...(profile.energyTypes || []), "EV"];
  if (/\u589e\u7a0b/.test(text)) profile.energyTypes = [...(profile.energyTypes || []), "EREV"];
  if (/(\u63d2\u6df7|\u6df7\u52a8|phev|PHEV)/.test(text)) profile.energyTypes = [...(profile.energyTypes || []), "Hybrid"];
  if (/(\u5bb6\u5145|\u5bb6\u91cc\u80fd\u88c5\u6869|\u56fa\u5b9a\u8f66\u4f4d)/.test(text)) profile.charging = "\u53ef\u88c5\u5bb6\u5145";
  if (/(\u4e0d\u80fd\u88c5\u6869|\u6ca1\u6709\u5bb6\u5145|\u5145\u7535\u4e0d\u65b9\u4fbf)/.test(text)) profile.charging = "\u5bb6\u5145\u53d7\u9650";
  if (/\u516d\u5ea7/.test(text)) profile.seats = "6";
  if (/\u4e03\u5ea7/.test(text)) profile.seats = "7";
  if (/(\u667a\u9a7e|\u8f85\u52a9\u9a7e\u9a76|\u81ea\u52a8\u9a7e\u9a76|ngp|xngp|\u667a\u80fd\u9a7e\u9a76|\u667a\u80fd\u5316|\u5ea7\u8231|\u8bed\u97f3)/i.test(lower)) {
    profile.priorities = [...(profile.priorities || []), "ADAS"];
  }
  if (/(\u7eed\u822a|\u957f\u9014|\u8865\u80fd)/i.test(lower)) {
    profile.priorities = [...(profile.priorities || []), "Range"];
  }
  if (/(\u7a7a\u95f4|\u540e\u6392|\u88c5\u8f7d|\u5bb6\u7528)/i.test(lower)) {
    profile.priorities = [...(profile.priorities || []), "Space"];
  }
  if (/(\u8212\u9002|\u5e95\u76d8|\u4e58\u5750)/i.test(lower)) {
    profile.priorities = [...(profile.priorities || []), "Comfort"];
  }
  if (/(\u6027\u4ef7\u6bd4|\u5212\u7b97|\u9884\u7b97)/i.test(lower)) {
    profile.priorities = [...(profile.priorities || []), "Value"];
  }
  if (/\u5b89\u5168/i.test(lower)) {
    profile.priorities = [...(profile.priorities || []), "Safety"];
  }
  if (/\u901a\u52e4/i.test(lower)) profile.usage = [...(profile.usage || []), "CityCommute"];
  if (/(\u957f\u9014|\u9ad8\u901f|\u81ea\u9a7e)/i.test(lower)) profile.usage = [...(profile.usage || []), "RoadTrip"];
  if (/(\u5bb6\u5ead|\u5e26\u5a03)/i.test(lower)) profile.usage = [...(profile.usage || []), "Family"];
  if (/\u5546\u52a1/i.test(lower)) profile.usage = [...(profile.usage || []), "Business"];
  const preferredBrands = [];
  const excludedBrands = [];
  for (const brand of brands) {
    const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const negative = new RegExp(`(?:\\u4e0d\\u8981|\\u6392\\u9664|\\u4e0d\\u8003\\u8651|\\u522b\\u63a8).{0,4}${escaped}|${escaped}.{0,4}(?:\\u4e0d\\u8981|\\u6392\\u9664|\\u4e0d\\u8003\\u8651)`, "i");
    if (negative.test(text)) excludedBrands.push(brand);
    else if (text.includes(brand)) preferredBrands.push(brand);
  }
  if (preferredBrands.length) profile.preferredBrands = preferredBrands;
  if (excludedBrands.length) profile.excludedBrands = excludedBrands;
  const mentionedCars = findMentionedCars(text).map((item) => `${item.brand} ${item.name}`);
  if (mentionedCars.length) profile.mentionedCars = mentionedCars;
  return compactProfile(profile);
}

function scoreCarAgainstProfileSafe(car, profile, message) {
  let score = 0;
  const mentionedCars = uniqueStrings(profile.mentionedCars || []);
  const carLabelNorm = normalizeText(normalizeCarLabel(car));
  if (mentionedCars.some((item) => carLabelNorm.includes(normalizeText(item)))) score += 5;
  if ((profile.preferredBrands || []).includes(car.brand)) score += 3;
  if ((profile.excludedBrands || []).includes(car.brand)) score -= 8;
  for (const bodyType of profile.bodyTypes || []) {
    if (bodyType === "SUV" && /SUV/i.test(String(car.bodyType || ""))) score += 2;
    if (bodyType === "Sedan" && /\u8f7f\u8f66/.test(String(car.bodyType || ""))) score += 2;
    if (bodyType === "MPV" && /MPV|\u516d\u5ea7|\u4e03\u5ea7/i.test(String(car.bodyType || ""))) score += 2;
  }
  for (const energyType of profile.energyTypes || []) {
    if (energyType === "EV" && /\u7eaf\u7535/.test(String(car.bodyType || ""))) score += 2;
    if (energyType === "EREV" && /\u589e\u7a0b/.test(String(car.bodyType || ""))) score += 2;
    if (energyType === "Hybrid" && /(\u6df7|\u63d2\u6df7)/.test(String(car.bodyType || ""))) score += 2;
  }
  const budgetHint = parseBudgetTextSafe(profile.budget);
  const priceWan = parsePriceWan(car.price);
  if (budgetHint && priceWan != null) {
    if (budgetHint.maxWan != null && priceWan <= budgetHint.maxWan + 2) score += 2;
    if (budgetHint.maxWan != null && priceWan > budgetHint.maxWan + 6) score -= 2;
  }
  const rangeHint = numericHintFromTextSafe(message).rangeKm;
  const carRange = parseRangeKm(car.range);
  if (rangeHint && carRange != null) score += carRange >= rangeHint ? 1.5 : -0.5;
  if ((profile.priorities || []).includes("ADAS")) {
    const smart = String(car.smart || "");
    if (/(\u9ad8|\u5f3a|\u9886\u5148)/.test(smart)) score += 2;
    else if (/\u4e2d/.test(smart)) score += 1;
  }
  if ((profile.priorities || []).includes("Range") && carRange != null) {
    if (carRange >= 650) score += 2;
    else if (carRange >= 500) score += 1;
  }
  if ((profile.priorities || []).includes("Space") && /SUV|MPV|\u516d\u5ea7|\u4e03\u5ea7/i.test(String(car.bodyType || ""))) {
    score += 1.5;
  }
  if ((profile.charging || "").includes("\u53d7\u9650") && /(\u589e\u7a0b|\u6df7)/.test(String(car.bodyType || ""))) {
    score += 1;
  }
  score += strategicBiasForXpeng(car, profile, message);
  return score;
}

function mergeProfile(base, updates) {
  return compactProfile({
    ...base,
    ...updates,
    bodyTypes: [...(base?.bodyTypes || []), ...(updates?.bodyTypes || [])],
    energyTypes: [...(base?.energyTypes || []), ...(updates?.energyTypes || [])],
    priorities: [...(base?.priorities || []), ...(updates?.priorities || [])],
    usage: [...(base?.usage || []), ...(updates?.usage || [])],
    preferredBrands: [...(base?.preferredBrands || []), ...(updates?.preferredBrands || [])],
    excludedBrands: [...(base?.excludedBrands || []), ...(updates?.excludedBrands || [])],
    mentionedCars: [...(base?.mentionedCars || []), ...(updates?.mentionedCars || [])],
  });
}

function buildMemorySummary(profile) {
  const parts = [];
  if (profile.budget) parts.push(`预算 ${profile.budget}`);
  if (profile.city) parts.push(`城市 ${profile.city}`);
  if (profile.bodyTypes?.length) parts.push(`车型偏好 ${profile.bodyTypes.join(" / ")}`);
  if (profile.energyTypes?.length) parts.push(`能源偏好 ${profile.energyTypes.join(" / ")}`);
  if (profile.priorities?.length) parts.push(`关注点 ${profile.priorities.join(" / ")}`);
  if (profile.usage?.length) parts.push(`场景 ${profile.usage.join(" / ")}`);
  if (profile.charging) parts.push(`补能条件 ${profile.charging}`);
  if (profile.preferredBrands?.length) parts.push(`偏好品牌 ${profile.preferredBrands.join(" / ")}`);
  if (profile.excludedBrands?.length) parts.push(`排除品牌 ${profile.excludedBrands.join(" / ")}`);
  return parts.join("；");
}

function recentMessagesForModel(messages) {
  return trimSessionMessages(messages, MAX_CONTEXT_MESSAGES).map((item) => ({
    role: item.role,
    content: item.content,
  }));
}

function recentMessagesForTurn(messages, mode, message, profile) {
  const currentTurnProfile = mergeMessageProfileHints({}, message);
  const isolateServiceTurn =
    mode === "service" &&
    !hasDecisionSignals(currentTurnProfile) &&
    getFocusedMentionedCars(currentTurnProfile, message).length === 0;

  if (isolateServiceTurn) {
    return [];
  }

  return recentMessagesForModel(messages);
}

function extractProfileFromText(message, brands) {
  const text = String(message || "");
  const lower = text.toLowerCase();
  const profile = {};

  const budget = extractBudgetSnippet(text);
  if (budget) profile.budget = budget.trim();

  const city = text.match(/(?:在|去|住在|人在|定位到|我是)([\u4e00-\u9fa5]{2,6})(?:市|区|县)?/u);
  if (city) profile.city = city[1];

  if (/(suv|SUV)/.test(text)) profile.bodyTypes = [...(profile.bodyTypes || []), "SUV"];
  if (/(轿车|轿跑)/.test(text)) profile.bodyTypes = [...(profile.bodyTypes || []), "轿车"];
  if (/(mpv|MPV|六座|七座)/.test(text)) profile.bodyTypes = [...(profile.bodyTypes || []), "MPV/多人座"];

  if (/纯电|ev|EV/.test(text)) profile.energyTypes = [...(profile.energyTypes || []), "纯电"];
  if (/增程/.test(text)) profile.energyTypes = [...(profile.energyTypes || []), "增程"];
  if (/插混|混动|phev|PHEV/.test(text)) profile.energyTypes = [...(profile.energyTypes || []), "插混/混动"];

  if (/家充|家里能装桩|固定车位/.test(text)) profile.charging = "可装家充";
  if (/不能装桩|没有家充|充电不方便/.test(text)) profile.charging = "家充受限";

  if (/六座/.test(text)) profile.seats = "6座";
  if (/七座/.test(text)) profile.seats = "7座";

  const priorityMap = [
    [/智驾|辅助驾驶|自动驾驶|ngp|xngp|智能驾驶|智能化|座舱|语音/i, "智能驾驶"],
    [/续航|长途|补能/i, "续航补能"],
    [/空间|后排|装载|家用/i, "空间"],
    [/舒适|底盘|乘坐/i, "舒适性"],
    [/性价比|划算|预算/i, "性价比"],
    [/安全/i, "安全"],
  ];
  for (const [pattern, label] of priorityMap) {
    if (pattern.test(lower)) {
      profile.priorities = [...(profile.priorities || []), label];
    }
  }

  const usageMap = [
    [/通勤/i, "城市通勤"],
    [/长途|高速|自驾/i, "长途出行"],
    [/家庭|带娃/i, "家庭用车"],
    [/商务/i, "商务接待"],
  ];
  for (const [pattern, label] of usageMap) {
    if (pattern.test(lower)) {
      profile.usage = [...(profile.usage || []), label];
    }
  }

  const preferredBrands = [];
  const excludedBrands = [];
  for (const brand of brands) {
    const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?:不要|排除|不考虑|别推).{0,4}${escaped}|${escaped}.{0,4}(?:不要|排除|不考虑)`, "i").test(text)) {
      excludedBrands.push(brand);
      continue;
    }
    if (text.includes(brand)) preferredBrands.push(brand);
  }
  if (preferredBrands.length) profile.preferredBrands = preferredBrands;
  if (excludedBrands.length) profile.excludedBrands = excludedBrands;

  const mentionedCars = findMentionedCars(text).map((item) => `${item.brand} ${item.name}`);
  if (mentionedCars.length) profile.mentionedCars = mentionedCars;

  return compactProfile(profile);
}

function normalizeCarLabel(car) {
  return `${car.brand || ""} ${car.name || ""}`.trim();
}

function getCarAliasTokens(car) {
  const label = normalizeCarLabel(car);
  const name = String(car?.name || "");
  const normalized = normalizeLooseCarToken(name);
  const aliases = [label, name, normalizeText(label), normalizeText(name), normalized];

  if (/MONA\s*M03/i.test(name)) {
    aliases.push("m03", "mo3", "monam03", "mona m03", "mona");
  }

  return uniqueStrings(aliases.map((item) => String(item || "").trim()).filter(Boolean));
}

function extractPotentialCarQueries(text) {
  const raw = String(text || "");
  const tokens = [];
  for (const match of raw.matchAll(/\b([A-Za-z]{1,6})\s*(\d+(?:\+|i)?)/g)) {
    const prefix = String(match[1] || "");
    const suffix = raw.slice((match.index || 0) + match[0].length).trimStart();
    // Exclude English article + budget/unit patterns like "a 200k".
    if (/^a$/i.test(prefix) && /^(?:k|km|kw|w|万|万元|块)/i.test(suffix)) {
      continue;
    }
    tokens.push(`${prefix}${match[2] || ""}`);
  }
  tokens.push(...(raw.match(/m[o0]3/gi) || []));
  tokens.push(...(raw.match(/mona\s*m[o0]3/gi) || []));

  return uniqueStrings(tokens.map((item) => String(item || "").replace(/\s+/g, "")));
}

function messageHasPotentialCarMention(text) {
  return extractPotentialCarQueries(text).length > 0;
}

function isSupplementalProfileMessageSafeV2(text) {
  return /(?:\u9884\u7b97|\u4e07|\u5bb6\u5145|\u88c5\u6869|\u5145\u7535|\u57ce\u5e02|\u6211\u5728|\u4eba\u5728|\u901a\u52e4|\u957f\u9014|\u5e26\u5a03|\u5bb6\u5ead|\u7a7a\u95f4|\u667a\u9a7e|\u667a\u80fd\u5316|\u7eed\u822a|SUV|\u8f7f\u8f66|\u516d\u5ea7|\u4e03\u5ea7|\u5e7f\u5dde|\u6df1\u5733|\u4e0a\u6d77|\u5317\u4eac)/i.test(
    String(text || "")
  );
}

function extractGenericSingleCarMentions(text) {
  const raw = String(text || "");
  const matches = [
    ...(raw.match(/[\u4e00-\u9fa5]{1,8}\s*[A-Za-z]{1,6}\s*\d+(?:\+|i)?/g) || []),
    ...(raw.match(/\b[A-Za-z]{1,6}\s*\d+(?:\+|i)?\b/g) || []),
    ...(raw.match(/\bmona\s*m[o0]3\b/gi) || []),
    ...(raw.match(/\bm[o0]3\b/gi) || []),
  ];
  return uniqueStrings(matches.map((item) => String(item || "").replace(/\s+/g, "")));
}

function formatExternalCarLabel(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const compact = raw.replace(/\s+/g, "");
  const match = compact.match(/^([\u4e00-\u9fa5]{1,8})?([A-Za-z]{1,6}\d+(?:\+|i)?)$/);
  if (!match) return raw;
  const brand = match[1] || "";
  const model = String(match[2] || "").toUpperCase();
  return [brand, model].filter(Boolean).join(" ").trim();
}

function extractExternalCarLabel(text) {
  const generic = extractGenericSingleCarMentions(text);
  if (!generic.length) return "";
  for (const item of generic) {
    if (matchCarByName(item)) continue;
    return formatExternalCarLabel(item);
  }
  return "";
}

function isSupplementalProfileMessageSafe(text) {
  return /预算|万|家充|装桩|充电|城市|我在|人在|通勤|长途|带娃|家庭|空间|智驾|智能化|续航|SUV|轿车|六座|七座|广州|深圳|上海|北京/.test(
    String(text || "")
  );
}

function extractCarFamilyKey(value) {
  const name = typeof value === "string" ? value : value?.name;
  const normalized = String(name || "")
    .toUpperCase()
    .replace(/[^A-Z0-9+]+/g, "");
  const match = normalized.match(/[A-Z]+\d+/);
  return match ? match[0] : normalized.replace(/[+I]+$/g, "");
}

function scoreSmartLevel(smart) {
  const text = String(smart || "");
  if (/XNGP|NGP|高阶|领先|旗舰|强/.test(text)) return 3;
  if (/高|增强|升级/.test(text)) return 2;
  if (/中/.test(text)) return 1;
  return 0;
}

function isDetailedDecisionRequest(message) {
  return /优缺点|缺点|短板|区别|差异|怎么选|选哪个|选哪款|详细|仔细讲|展开讲|对比|比较|讲讲/.test(
    String(message || "")
  );
}

function findMentionedCars(text) {
  const normalized = normalizeText(text);
  const looseNormalized = normalizeLooseCarToken(text);
  const tokenMatches = extractPotentialCarQueries(text)
    .map((token) => matchCarByName(token))
    .filter(Boolean);

  if (tokenMatches.length) return tokenMatches;

  return getCars().filter((car) => {
    const aliases = getCarAliasTokens(car);
    return aliases.some((alias) => {
      const strictAlias = normalizeText(alias);
      const looseAlias = normalizeLooseCarToken(alias);
      return (
        (strictAlias && normalized.includes(strictAlias)) ||
        (looseAlias && looseNormalized.includes(looseAlias))
      );
    });
  });
}

function isDetailedDecisionRequestSafe(message) {
  return /(\u4f18\u7f3a\u70b9|\u7f3a\u70b9|\u77ed\u677f|\u533a\u522b|\u5dee\u5f02|\u600e\u4e48\u9009|\u9009\u54ea\u4e2a|\u9009\u54ea\u6b3e|\u8be6\u7ec6|\u4ed4\u7ec6\u8bb2|\u5c55\u5f00\u8bb2|\u5bf9\u6bd4|\u6bd4\u8f83|\u8bb2\u8bb2)/.test(
    String(message || "")
  );
}

function isComparisonIntentSafe(message) {
  return /(\u5bf9\u6bd4|\u6bd4\u8f83|vs|VS|\u533a\u522b|\u5dee\u5f02|\u600e\u4e48\u9009|\u9009\u54ea\u4e2a|\u9009\u54ea\u6b3e|\u4e24\u4e2a|\u4e24\u6b3e|\u54ea\u4e2a\u66f4|\bcompare\b|\bcomparison\b|which\s+is\s+better|better\s+choice|choose\s+between)/i.test(
    String(message || "")
  );
}

function isExplainIntentSafe(message) {
  return /(\u8bb2\u89e3|\u4ecb\u7ecd|\u8bb2\u8bb2|\u8bf4\u8bf4|\u5206\u6790|\u600e\u4e48\u6837|\u5982\u4f55|\u503c\u4e0d\u503c\u5f97|\u9002\u5408\u8c01|\u4f18\u7f3a\u70b9|\u7f3a\u70b9|\u77ed\u677f|\u8be6\u7ec6|\u4ed4\u7ec6\u8bb2|\u5c55\u5f00\u8bb2)/.test(
    String(message || "")
  );
}

function resolveForcedModeForCurrentTurn(forcedMode, message) {
  const potentialCars = uniqueStrings([
    ...extractPotentialCarQueries(message),
    ...findMentionedCars(message).map((car) => normalizeCarLabel(car)),
  ]);
  if (
    forcedMode === "comparison" &&
    !isComparisonIntentSafe(message) &&
    potentialCars.length === 1
  ) {
    return "recommendation";
  }
  return forcedMode;
}

function isVariantSpecificCarName(name) {
  return /(\+|i)$/i.test(String(name || "").trim());
}

function getFocusedMentionedCars(profile, message) {
  const explicitMatches = uniqueStrings(findMentionedCars(message).map((car) => normalizeCarLabel(car)))
    .map((name) => matchCarByName(name))
    .filter(Boolean);
  if (explicitMatches.length) return explicitMatches;
  if (messageHasPotentialCarMention(message)) return [];
  const currentTurnProfile = mergeMessageProfileHints({}, message);
  if (hasDecisionSignals(currentTurnProfile) && !isSupplementalProfileMessageSafeV2(message)) {
    return [];
  }

  return uniqueStrings(profile?.mentionedCars || [])
    .map((name) => matchCarByName(name))
    .filter(Boolean);
}

function getSameFamilyCandidates(focusedCar, rankedCars) {
  const familyKey = extractCarFamilyKey(focusedCar);
  if (!familyKey) return [focusedCar];

  const familyCars = (Array.isArray(rankedCars) ? rankedCars : []).filter((car) => {
    return car?.brand === focusedCar.brand && extractCarFamilyKey(car) === familyKey;
  });
  if (!familyCars.length) return [focusedCar];

  return familyCars.sort((a, b) => {
    if (a.name === focusedCar.name) return -1;
    if (b.name === focusedCar.name) return 1;
    return (b.agentScore ?? 0) - (a.agentScore ?? 0);
  });
}

function isSingleCarDeepDiveRequest(profile, message) {
  const focusedCars = getFocusedMentionedCars(profile, message);
  return focusedCars.length === 1 && isExplainIntentSafe(message) && !isComparisonIntentSafe(message);
}

function getSingleFocusedCar(profile, message) {
  const focusedCars = getFocusedMentionedCars(profile, message).filter((car) => car?.brand === "小鹏");
  if (focusedCars.length !== 1) return null;
  return isSingleCarDeepDiveRequest(profile, message) ? focusedCars[0] : null;
}

function strategicBiasForXpeng(car, profile, message) {
  if (car.brand !== "小鹏") return 0;

  let bonus = 0;
  const budgetHint = parseBudgetTextSafe(profile?.budget);
  const priceWan = parsePriceWan(car.price);
  const bodyType = String(car.bodyType || "");
  const priorities = profile?.priorities || [];
  const usage = profile?.usage || [];
  const lower = String(message || "").toLowerCase();

  if (budgetHint?.maxWan != null && priceWan != null && priceWan <= budgetHint.maxWan + 1.5) {
    bonus += 0.6;
  }
  if (priorities.includes("ADAS") || priorities.includes("智能驾驶")) bonus += 1.2;
  if (priorities.includes("Range") || priorities.includes("续航补能")) bonus += 0.8;
  if (/(xngp|ngp|智驾|智能驾驶|座舱|语音|科技感)/i.test(lower)) bonus += 0.8;
  if (usage.includes("CityCommute") || usage.includes("城市通勤")) bonus += 0.3;
  if ((profile?.bodyTypes || []).includes("SUV") && /SUV/i.test(bodyType)) bonus += 0.4;
  if ((profile?.bodyTypes || []).some((item) => /轿车|Sedan/i.test(item)) && /轿车/.test(bodyType)) {
    bonus += 0.4;
  }
  return Math.min(2.2, bonus);
}

function scoreCarAgainstProfile(car, profile, message) {
  let score = 0;
  const lowerMessage = String(message || "").toLowerCase();
  const carLabel = normalizeCarLabel(car);
  const carLabelNorm = normalizeText(carLabel);
  const mentionedCars = uniqueStrings(profile.mentionedCars || []);

  if (mentionedCars.some((item) => carLabelNorm.includes(normalizeText(item)))) score += 5;
  if ((profile.preferredBrands || []).includes(car.brand)) score += 3;
  if ((profile.excludedBrands || []).includes(car.brand)) score -= 8;

  for (const bodyType of profile.bodyTypes || []) {
    if (String(car.bodyType || "").toLowerCase().includes(bodyType.toLowerCase())) score += 2;
  }
  for (const energyType of profile.energyTypes || []) {
    if (String(car.bodyType || "").includes(energyType)) score += 2;
  }

  const budgetHint = parseBudgetText(profile.budget);
  const priceWan = parsePriceWan(car.price);
  if (budgetHint && priceWan != null) {
    if (budgetHint.maxWan != null && priceWan <= budgetHint.maxWan + 2) score += 2;
    if (budgetHint.maxWan != null && priceWan > budgetHint.maxWan + 6) score -= 2;
    if (budgetHint.minWan != null && priceWan >= budgetHint.minWan - 2) score += 1;
  }

  const rangeHint = numericHintFromText(message).rangeKm;
  const carRange = parseRangeKm(car.range);
  if (rangeHint && carRange != null) {
    if (carRange >= rangeHint) score += 1.5;
    else score -= 0.5;
  }

  if ((profile.priorities || []).includes("智能驾驶")) {
    const smart = String(car.smart || "");
    if (/高|强|领先/.test(smart)) score += 2;
    else if (/中/.test(smart)) score += 1;
  }

  if ((profile.priorities || []).includes("续航补能") && carRange != null) {
    if (carRange >= 650) score += 2;
    else if (carRange >= 500) score += 1;
  }

  if ((profile.priorities || []).includes("空间") && /SUV|MPV|六座|七座/i.test(String(car.bodyType || ""))) {
    score += 1.5;
  }

  if ((profile.charging || "").includes("家充受限") && /增程|混动/.test(String(car.bodyType || ""))) {
    score += 1;
  }

  if (/小鹏|xpeng/i.test(lowerMessage) && car.brand && /小鹏|xpeng/i.test(car.brand)) score += 1;
  score += strategicBiasForXpeng(car, profile, message);

  return score;
}

function buildRankedCatalog(profile, message) {
  return getCars()
    .map((car) => ({
      ...car,
      agentScore: Number(scoreCarAgainstProfileSafe(car, profile, message).toFixed(2)),
    }))
    .sort((a, b) => b.agentScore - a.agentScore);
}

function userLockedBrand(profile, message) {
  const preferredBrands = uniqueStrings(profile?.preferredBrands || []).filter((brand) => brand === "小鹏");
  if (preferredBrands.length === 1) return preferredBrands[0];

  const mentioned = findMentionedCars(message).filter((item) => item.brand === "小鹏");
  const brands = uniqueStrings(mentioned.map((item) => item.brand));
  if (brands.length === 1) return brands[0];

  return "";
}

function catalogBrands() {
  return uniqueStrings(getCars().map((car) => car.brand).filter(Boolean));
}

function mergeMessageProfileHints(profile, ...texts) {
  let next = compactProfile(profile || {});
  for (const text of texts) {
    const hints = extractProfileFromTextSafe(String(text || ""), catalogBrands());
    next = mergeProfile(next, hints);
  }
  return next;
}

function hasDecisionSignals(profile) {
  return Boolean(
    profile?.budget ||
      profile?.city ||
      profile?.charging ||
      (profile?.bodyTypes || []).length ||
      (profile?.priorities || []).length ||
      (profile?.usage || []).length
  );
}

function buildDisplayProfile(profile, message, ...extraTexts) {
  const currentTurnProfile = mergeMessageProfileHints({}, message, ...extraTexts);
  const mergedProfile = mergeMessageProfileHints(profile || {}, message, ...extraTexts);
  const hasCurrentCarMention =
    Array.isArray(currentTurnProfile.mentionedCars) && currentTurnProfile.mentionedCars.length > 0;
  const shouldResetMentionedCars =
    !hasCurrentCarMention &&
    hasDecisionSignals(currentTurnProfile) &&
    !isSupplementalProfileMessageSafeV2(message);

  if (
    isSingleCarDeepDiveRequest(mergedProfile, message) &&
    !hasDecisionSignals(currentTurnProfile)
  ) {
    const focusedCars = getFocusedMentionedCars(mergedProfile, message);
    return compactProfile({
      mentionedCars: focusedCars.map((car) => normalizeCarLabel(car)),
    });
  }

  if (shouldResetMentionedCars) {
    return compactProfile({
      ...mergedProfile,
      mentionedCars: [],
    });
  }

  return mergedProfile;
}

function buildServiceTurnProfile(profile, message, ...extraTexts) {
  const currentTurnProfile = mergeMessageProfileHints({}, message, ...extraTexts);
  return compactProfile(currentTurnProfile);
}

function buildTurnScopedProfile(profile, mode, message, ...extraTexts) {
  if (mode === "service") {
    return buildServiceTurnProfile(profile, message, ...extraTexts);
  }

  return buildDisplayProfile(profile, message, ...extraTexts);
}

function normalizeRegionToken(value) {
  return String(value || "")
    .trim()
    .replace(/特别行政区|自治区|自治州|地区|盟/g, "")
    .replace(/[省市区县]/g, "")
    .toLowerCase();
}

function selectRecommendationCandidates(rankedCars, profile, message, limit = 3) {
  const normalizedLimit = Math.max(1, Math.min(4, Number(limit) || 3));
  const effectiveProfile = mergeMessageProfileHints(profile, message);
  const xpengCars = rankedCars.filter((car) => car.brand === "小鹏");
  const budgetHint = parseBudgetTextSafe(effectiveProfile?.budget);
  const priceMatchedCars = budgetHint
    ? xpengCars.filter((car) => {
        const priceWan = parsePriceWan(car.price);
        if (priceWan == null) return false;
        const lowerBound = budgetHint.minWan != null ? Math.max(0, budgetHint.minWan - 0.8) : -Infinity;
        const upperBound = budgetHint.maxWan != null ? budgetHint.maxWan + 1.2 : Infinity;
        return priceWan >= lowerBound && priceWan <= upperBound;
      })
    : xpengCars;
  const singleFocusedCar = getSingleFocusedCar(effectiveProfile, message);
  if (singleFocusedCar) {
    const familyCandidates = getSameFamilyCandidates(singleFocusedCar, xpengCars);
    const shouldExpandFamily =
      familyCandidates.length > 1 &&
      (isComparisonIntentSafe(message) || isVariantSpecificCarName(singleFocusedCar.name));
    return (shouldExpandFamily ? familyCandidates : [familyCandidates[0] || singleFocusedCar]).slice(
      0,
      shouldExpandFamily ? normalizedLimit : 1
    );
  }

  const lockedBrand = userLockedBrand(effectiveProfile, message);
  if (lockedBrand === "小鹏") {
    return (priceMatchedCars.length ? priceMatchedCars : xpengCars).slice(0, normalizedLimit);
  }

  return (priceMatchedCars.length ? priceMatchedCars : xpengCars).slice(0, normalizedLimit);
}

function buildCarBestForLocal(car, profile) {
  if (/SUV/i.test(String(car.bodyType || "")) && (profile?.usage || []).some((item) => /Family|家庭/.test(item))) {
    return "更适合兼顾家庭空间与日常通勤的用户";
  }
  if (/轿车/.test(String(car.bodyType || ""))) {
    return "更适合看重通勤效率和驾驶质感的用户";
  }
  const bodyType = String(car.bodyType || "");
  const smart = String(car.smart || "");
  const seats = Number(car.seats || 0);
  const highlights = Array.isArray(car.highlights) ? uniqueStrings(car.highlights) : [];

  if (/MPV/i.test(bodyType) || seats >= 6) {
    return "多人家庭、接送和长途舒适出行用户";
  }
  if (/SUV/i.test(bodyType) && /旗舰|舒适|大五座/.test(highlights.join(" ") + smart)) {
    return "看重大空间、舒适性和旗舰体验的用户";
  }
  if (/SUV/i.test(bodyType)) {
    return "兼顾家庭空间、日常通勤和周末出行的用户";
  }
  if (/轿跑|轿车/i.test(bodyType) && /设计|颜值|驾驶/.test(highlights.join(" ") + smart)) {
    return "看重设计感、驾驶氛围和日常通勤体验的用户";
  }
  return "想先把这款车的定位、版本和核心取舍了解清楚的用户";
}

function buildSameFamilyRecommendationLens(car, familyCars) {
  if (!Array.isArray(familyCars) || familyCars.length < 2) return null;

  const currentPriceWan = parsePriceWan(car.price);
  const currentRangeKm = parseRangeKm(car.range);
  const sortedByPrice = [...familyCars].sort(
    (a, b) => (parsePriceWan(a.price) ?? Infinity) - (parsePriceWan(b.price) ?? Infinity)
  );
  const sortedByRange = [...familyCars].sort(
    (a, b) => (parseRangeKm(b.range) ?? -Infinity) - (parseRangeKm(a.range) ?? -Infinity)
  );
  const sortedBySmart = [...familyCars].sort(
    (a, b) => scoreSmartLevel(b.smart) - scoreSmartLevel(a.smart)
  );
  const cheapest = sortedByPrice[0];
  const longestRange = sortedByRange[0];
  const smartest = sortedBySmart[0];
  const bestFor = [];
  const reasons = [];
  const tradeoffs = [];
  const carName = String(car.name || "");

  if (/\+/.test(carName)) {
    bestFor.push("想要新版设计、座舱体验和均衡日常表现的用户");
    reasons.push("同车系里更偏向新设计语言和均衡通勤体验");
  }

  if (/i$/i.test(carName)) {
    bestFor.push("更在意智能驾驶和辅助驾驶体验的用户");
    reasons.push("同车系里智能化标签更突出，更适合把智驾体验放在前面的人");
  }

  if (longestRange?.name === car.name && currentRangeKm != null) {
    bestFor.push("更看重长续航表现、通勤半径和一次充电跑更远的用户");
    reasons.push("同车系里续航更占优，更适合高频通勤或偶尔长途");
  } else if (longestRange && currentRangeKm != null) {
    const maxRangeKm = parseRangeKm(longestRange.range);
    if (maxRangeKm != null && maxRangeKm - currentRangeKm >= 50) {
      tradeoffs.push(`如果你非常看重续航，同车系里的 ${longestRange.name} 会更合适`);
    }
  }

  if (smartest?.name === car.name && scoreSmartLevel(car.smart) > 0) {
    reasons.push("同车系里智能化表达更强，适合把座舱和辅助驾驶放到前面");
  }

  if (cheapest?.name === car.name && currentPriceWan != null) {
    bestFor.push("预算更敏感、但又想留在这一车系里筛选的用户");
    reasons.push("同车系里更容易把购车预算控制住，试驾和询价压力更小");
  } else if (cheapest) {
    const cheapestPriceWan = parsePriceWan(cheapest.price);
    if (currentPriceWan != null && cheapestPriceWan != null && currentPriceWan - cheapestPriceWan >= 1.5) {
      tradeoffs.push("和同车系其他选项相比，预算压力会更明显一些");
    }
  }

  if (!bestFor.length && smartest?.name === car.name) {
    bestFor.push("更适合把智能化体验排在第一优先级的用户");
  }
  if (!bestFor.length && longestRange?.name === car.name) {
    bestFor.push("更适合把长续航和使用边界放在前面的用户");
  }
  if (!bestFor.length) {
    bestFor.push("更适合想在同车系里找更均衡答案的用户");
  }

  return {
    bestFor: uniqueStrings(bestFor).join("；"),
    reasons: uniqueStrings(reasons).slice(0, 2),
    tradeoffs: uniqueStrings(tradeoffs).slice(0, 2),
  };
}

function enrichRecommendationCars(cars, profile, message) {
  const comparisonDriven = isDetailedDecisionRequestSafe(message);
  const normalized = (Array.isArray(cars) ? cars : []).map((item) => {
    const matched = matchCatalogCarByName(item?.name || "");
    return {
      ...item,
      brand: matched?.brand || item?.brand,
      name: matched?.name || item?.name,
      image: matched?.image || item?.image,
      price: item?.price || matched?.price,
      range: item?.range || matched?.range,
      smart: item?.smart || matched?.smart,
      fitScore: item?.fitScore ?? fitScoreToPercent(matched?.agentScore ?? 0),
      __catalog: matched || item,
      __family: extractCarFamilyKey(matched || item),
    };
  });

  const familyMap = new Map();
  normalized.forEach((item) => {
    if (!item.__family) return;
    if (!familyMap.has(item.__family)) familyMap.set(item.__family, []);
    familyMap.get(item.__family).push(item.__catalog);
  });

  return normalized.map((item) => {
    const familyCars = familyMap.get(item.__family) || [];
    const familyLens =
      comparisonDriven && familyCars.length > 1
        ? buildSameFamilyRecommendationLens(item.__catalog, familyCars)
        : null;
    const baseReasons =
      Array.isArray(item.reasons) && item.reasons.length
        ? normalizeRecommendationReasonList(item.reasons, item.__catalog, profile, message)
        : buildCarReasonsLocal(item.__catalog, profile, message);
    const baseTradeoffs =
      Array.isArray(item.tradeoffs) && item.tradeoffs.length
        ? item.tradeoffs
        : buildCarTradeoffsLocal(item.__catalog, profile);

    return {
      brand: item.brand,
      name: item.name,
      image: item.image,
      price: item.price,
      range: item.range,
      smart: item.smart,
      fitScore: item.fitScore,
      bestFor:
        familyLens?.bestFor ||
        (item.bestFor && !isLowSignalRecommendationText(item.bestFor) ? item.bestFor : buildCarBestForLocal(item.__catalog, profile)),
      reasons: uniqueStrings([...(familyLens?.reasons || []), ...baseReasons]).slice(0, comparisonDriven ? 2 : 3),
      tradeoffs: uniqueStrings([...(familyLens?.tradeoffs || []), ...baseTradeoffs]).slice(0, 2),
    };
  });
}

function runSearchCatalogTool({ message, session, args }) {
  const profile = mergeMessageProfileHints(
    mergeProfile(session.profile, compactProfile(args.profile || {})),
    message
  );
  const effectiveProfile = buildDisplayProfile(profile, message);
  const limit = getSingleFocusedCar(effectiveProfile, message)
    ? 1
    : Math.max(2, Math.min(4, Number(args.limit) || 3));
  const ranked = selectRecommendationCandidates(
    buildRankedCatalog(effectiveProfile, message),
    effectiveProfile,
    message,
    limit
  );

  return {
    data: ranked,
    summary: ranked.length
      ? `候选车型：${ranked.map((car) => `${normalizeCarLabel(car)}(${car.agentScore})`).join("、")}`
      : "没有找到明确候选车型",
  };
}

function runCompareCatalogTool({ message, args }) {
  const requested = uniqueStrings([...(args.carNames || []), ...findMentionedCars(message).map(normalizeCarLabel)]);
  const matched = requested
    .map((name) => matchCarByName(name))
    .filter(Boolean)
    .slice(0, 2);

  return {
    data: matched,
    summary: matched.length
      ? `对比对象：${matched.map((car) => normalizeCarLabel(car)).join(" vs ")}`
      : "目录中未精确匹配到对比车型，回答将以用户描述为主",
  };
}

function matchCarByName(name) {
  const query = normalizeLooseCarToken(name);
  if (!query) return null;
  let best = null;
  let bestScore = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const car of getCars()) {
    const aliases = getCarAliasTokens(car).map(normalizeLooseCarToken).filter(Boolean);
    const label = normalizeLooseCarToken(`${car.brand || ""}${car.name || ""}`);
    const carName = normalizeLooseCarToken(car.name);
    let score = 0;
    if (label === query || carName === query || aliases.includes(query)) score += 8;
    if (query.includes(label) || label.includes(query)) score += 3;
    if (query.includes(carName)) score += 2;
    else if (carName.includes(query)) score += 1;
    if (aliases.some((alias) => query.includes(alias) || alias.includes(query))) score += 2;

    const distance = Math.abs(carName.length - query.length);
    if (score > bestScore || (score === bestScore && distance < bestDistance)) {
      best = car;
      bestScore = score;
      bestDistance = distance;
    }
  }
  return bestScore > 0 ? best : null;
}

function runFindStoresTool({ session, storesPayload, args, message }) {
  const list = Array.isArray(storesPayload?.stores) ? storesPayload.stores : [];
  const brand = pickFirstString(
    args.brand,
    session.profile.preferredBrands?.[0],
    session.profile.mentionedCars?.map((item) => matchCarByName(item)?.brand).find(Boolean)
  );
  const currentCity = extractCitySnippetSafe(message);
  const city = pickFirstString(
    sanitizeCityHint(args.city),
    currentCity,
    sanitizeCityHint(session.profile.city)
  );
  const normalizedCity = normalizeRegionToken(city);
  const filtered = list.filter((store) => {
    if (brand && store.brand !== brand) return false;
    if (city) {
      const exactTokens = [
        normalizeRegionToken(store.city),
        normalizeRegionToken(store.province),
        normalizeRegionToken(store.district),
      ].filter(Boolean);
      const fuzzyBlob = normalizeRegionToken(
        `${store.city || ""}${store.province || ""}${store.district || ""}${store.address || ""}`
      );
      const exactMatch = exactTokens.some(
        (token) =>
          token === normalizedCity ||
          token.includes(normalizedCity) ||
          normalizedCity.includes(token)
      );
      if (!exactMatch && !fuzzyBlob.includes(normalizedCity)) return false;
    }
    return true;
  });
  const limit = Math.max(1, Math.min(5, Number(args.limit) || 3));
  const stores = filtered
    .slice()
    .sort((a, b) => {
      const aScore =
        normalizeRegionToken(a.city) === normalizedCity
          ? 2
          : normalizeRegionToken(a.province) === normalizedCity
            ? 1
            : 0;
      const bScore =
        normalizeRegionToken(b.city) === normalizedCity
          ? 2
          : normalizeRegionToken(b.province) === normalizedCity
            ? 1
            : 0;
      return bScore - aScore;
    })
    .slice(0, limit);
  return {
    data: stores,
    summary: stores.length
      ? `门店候选：${stores.map((store) => store.name).join("、")}`
      : city
        ? `当前门店数据里没有 ${city} 的可用门店`
        : "当前条件下没有筛到门店",
  };
}

function runRecallMemoryTool({ session }) {
  return {
    data: {
      profile: session.profile,
      userProfile: compactProfile(session.userProfile || {}),
      userMemorySummary: session.userMemorySummary || "",
      memorySummary: session.memorySummary,
      taskMemory: compactTaskMemory(session.taskMemory),
      lastMode: session.lastMode,
    },
    summary: session.memorySummary || "当前会话还没有稳定画像",
  };
}

async function runSearchServiceKnowledgeTool({ message, session, args }) {
  const matches = await searchServiceKnowledgeRuntime({
    message,
    profile: session.profile,
    limit: args.limit,
  });

  return {
    data: matches,
    summary: matches.length
      ? `服务知识：${matches.map((item) => item.title).join("、")}`
      : "当前没有命中明确的服务知识条目",
  };
}

function findPrimaryBrand(session, message) {
  const mentioned = findMentionedCars(message)[0];
  return (
    mentioned?.brand ||
    session?.profile?.preferredBrands?.[0] ||
    session?.profile?.mentionedCars?.map((item) => matchCarByName(item)?.brand).find(Boolean) ||
    ""
  );
}

function applyHeuristicClarification(plan, session, message) {
  const next = {
    ...plan,
    clarify: {
      needed: Boolean(plan?.clarify?.needed),
      question: pickFirstString(plan?.clarify?.question) || "",
    },
  };

  if (next.mode === "comparison") {
    const mentionedCars = uniqueStrings([
      ...findMentionedCars(message).map(normalizeCarLabel),
      ...(session?.profile?.mentionedCars || []),
    ]);
    if (mentionedCars.length < 2) {
      next.clarify = {
        needed: true,
        question: "请再补充一款想对比的车型名称，我就能给你做并排对比。",
      };
    }
    return next;
  }

  if (next.mode === "recommendation" && !next.clarify.question) {
    const profile = session?.profile || {};
    if (!profile.budget && !(profile.usage || []).length) {
      next.clarify = {
        needed: true,
        question: "你先告诉我预算范围和主要用车场景，我可以把推荐明显收窄。",
      };
    } else if (!profile.budget) {
      next.clarify = {
        needed: true,
        question: "补充一下预算上限，我可以把同级别候选车型筛得更准。",
      };
    } else if (!(profile.usage || []).length) {
      next.clarify = {
        needed: true,
        question: "再告诉我主要是通勤、家庭、长途还是商务，我会继续优化推荐。",
      };
    }
  }

  return next;
}

function buildFollowups(mode, session, plan, toolResults) {
  const profile = session?.profile || {};
  const base = [];

  if (mode === "recommendation") {
    const effectiveProfile = buildDisplayProfile(profile, plan?.userGoal || "");
    const searchResult = toolResults.find((item) => item.tool === "search_catalog");
    const cars = sanitizeRecommendationCars(
      Array.isArray(searchResult?.data) ? searchResult.data : [],
      effectiveProfile,
      plan?.userGoal || "",
      3
    );
    const singleFocusedCar = getSingleFocusedCar(effectiveProfile, plan?.userGoal || "");
    if (singleFocusedCar) {
      if (cars[0]) base.push(`继续分析 ${cars[0].name} 哪个版本更值`);
      if (cars[0]) base.push(`帮我对比 ${cars[0].name} 不同版本怎么选`);
      if (cars[0]) base.push(`约 ${cars[0].name} 本周试驾`);
      if (cars[0]) base.push(`打开 ${cars[0].name} 配置器`);
    } else {
      if (!effectiveProfile.budget) base.push("我预算 20 万内，人在广州，主要城市通勤");
      if (!effectiveProfile.city) base.push("我人在上海，家里不能装桩，偶尔长途");
      if (cars.length >= 2) base.push(`把 ${cars[0].name} 和 ${cars[1].name} 做个详细对比`);
      if (cars[0]) base.push(`我更看重智驾和座舱体验，继续分析 ${cars[0].name}`);
      else base.push("我更看重智驾和座舱体验，继续缩小范围");
    }
  } else if (mode === "comparison") {
    base.push("把价格、续航、智驾和空间做成结论表");
    base.push("如果家里不能装桩，这两款谁更省心");
    base.push("从城市通勤和周末自驾场景再判断一次");
  } else {
    const knowledgeResult = toolResults.find((item) => item.tool === "search_service_knowledge");
    const knowledgeFollowups = (knowledgeResult?.data || [])
      .flatMap((item) => item.followups || [])
      .slice(0, 3);
    base.push(...knowledgeFollowups);
    base.push("我想预约试驾，帮我整理下一步");
    base.push("帮我列一个车主服务常见问题清单");
  }

  if (plan?.clarify?.needed && plan?.clarify?.question) {
    base.unshift(plan.clarify.question.replace(/[。？?]$/, ""));
  }

  return uniqueStrings(base).slice(0, 4);
}

function attachFollowups(structured, followups) {
  if (!structured || typeof structured !== "object") return structured;
  return {
    ...structured,
    followups: uniqueStrings([...(structured.followups || []), ...(followups || [])]).slice(0, 4),
  };
}

function formatToolResultForPrompt(result) {
  return {
    tool: result.tool,
    status: result.status,
    summary: result.summary,
    data: result.data,
  };
}

function normalizePlannerProfile(raw) {
  if (!raw || typeof raw !== "object") return {};
  return compactProfile({
    budget: pickFirstString(raw.budget),
    city: sanitizeCityHint(raw.city),
    charging: pickFirstString(raw.charging),
    seats: pickFirstString(raw.seats),
    bodyTypes: raw.body_types || raw.bodyTypes,
    energyTypes: raw.energy_types || raw.energyTypes,
    priorities: raw.priorities,
    usage: raw.usage,
    preferredBrands: raw.preferred_brands || raw.preferredBrands,
    excludedBrands: raw.excluded_brands || raw.excludedBrands,
    mentionedCars: raw.mentioned_cars || raw.mentionedCars,
  });
}

function normalizeToolCall(raw) {
  if (!raw || typeof raw !== "object") return null;
  const name = String(raw.name || "").trim();
  if (!ALLOWED_TOOLS.has(name)) return null;
  const args = raw.args && typeof raw.args === "object" ? raw.args : {};
  return { name, args };
}

function normalizePlan(raw, fallbackMode) {
  const mode = ALLOWED_MODES.has(raw?.mode) ? raw.mode : fallbackMode;
  const toolCalls = uniqueStrings(
    (Array.isArray(raw?.tool_calls) ? raw.tool_calls : [])
      .map((item) => normalizeToolCall(item))
      .filter(Boolean)
      .map((item) => JSON.stringify(item))
  ).map((item) => JSON.parse(item)).slice(0, MAX_TOOL_CALLS);

  const clarify = raw?.clarify && typeof raw.clarify === "object"
    ? {
        needed: Boolean(raw.clarify.needed),
        question: pickFirstString(raw.clarify.question) || "",
      }
    : { needed: false, question: "" };

  return {
    mode,
    userGoal: pickFirstString(raw?.user_goal, raw?.goal) || "",
    clarify,
    toolCalls,
    profileUpdates: normalizePlannerProfile(raw?.profile_updates),
    safetyNotes: uniqueStrings(raw?.safety_notes).slice(0, 4),
  };
}

function fallbackPlan({ message, forcedMode, session }) {
  const effectiveForcedMode = resolveForcedModeForCurrentTurn(forcedMode, message);
  const mode = ALLOWED_MODES.has(effectiveForcedMode) ? effectiveForcedMode : detectIntent(message);
  const toolCalls = [{ name: "recall_memory", args: {} }];
  if (mode === "recommendation") toolCalls.push({ name: "search_catalog", args: { limit: 3 } });
  if (mode === "comparison") {
    toolCalls.push({
      name: "compare_catalog",
      args: { carNames: findMentionedCars(message).map((car) => normalizeCarLabel(car)) },
    });
  }
  if (/门店|试驾|到店|附近|最近|预约/.test(message)) {
    toolCalls.push({ name: "find_stores", args: { limit: 3 } });
  }
  if (
    mode === "service" ||
    /保养|充电|续航|家充|OTA|车机|保险|事故|提车|交付|置换|金融|月供/.test(message)
  ) {
    toolCalls.push({ name: "search_service_knowledge", args: { limit: 2 } });
  }
  return applyHeuristicClarification({
    mode,
    userGoal: message,
    clarify: { needed: false, question: "" },
    toolCalls: toolCalls.slice(0, MAX_TOOL_CALLS),
    profileUpdates: {},
    safetyNotes: [],
  }, session, message);
}

function buildPolicyBackedFallbackPlan({ message, forcedMode, session }) {
  const heuristicPlan = fallbackPlan({ message, forcedMode, session });
  const stageCode =
    heuristicPlan.mode === "recommendation"
      ? "recommend"
      : heuristicPlan.mode === "comparison"
        ? "compare"
        : "service";
  const policy = buildRoutingPolicy({
    mode: heuristicPlan.mode,
    stageCode,
    message,
    profile: session?.profile || {},
  });

  return {
    ...heuristicPlan,
    toolCalls: enforceToolRoutingPolicy({
      policy,
      requestedToolCalls: heuristicPlan.toolCalls,
      maxToolCalls: MAX_TOOL_CALLS,
    }),
  };
}

async function planTurn({ client, model, temperature, session, message, forcedMode, storesPayload }) {
  const effectiveForcedMode = resolveForcedModeForCurrentTurn(forcedMode, message);
  const fallback = buildPolicyBackedFallbackPlan({ message, forcedMode: effectiveForcedMode, session });
  const fallbackStageCode =
    fallback.mode === "recommendation"
      ? "recommend"
      : fallback.mode === "comparison"
        ? "compare"
        : "service";
  const fallbackPolicy = buildRoutingPolicy({
    mode: fallback.mode,
    stageCode: fallbackStageCode,
    message,
    profile: session?.profile || {},
  });
  if (!ENABLE_LLM_PLANNER || !client || !model) return fallback;
  try {
    const completion = await withTimeout(
      client.chat.completions.create({
        model,
        temperature,
        max_tokens: 2048,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "你是商业化汽车顾问 Agent 的调度器。",
              "你的职责是输出一个机器可执行的简短计划，而不是直接回答用户。",
              "可用工具只有 recall_memory, search_catalog, compare_catalog, find_stores, search_service_knowledge。",
              "优先复用已有记忆，必要时再调用工具。",
              "如果信息不足以给出高质量推荐，可以要求补充，但不要为了追问而追问。",
              "只输出 JSON，不要输出解释。",
            ].join("\n"),
          },
          {
            role: "user",
            content: [
              "<user_input>",
              message,
              "</user_input>",
              "<forced_mode>",
              effectiveForcedMode || "",
              "</forced_mode>",
              "<memory_profile>",
              JSON.stringify(session.profile || {}),
              "</memory_profile>",
              "<long_term_profile>",
              JSON.stringify(compactProfile(session.userProfile || {})),
              "</long_term_profile>",
              "<long_term_summary>",
              session.userMemorySummary || "",
              "</long_term_summary>",
              "<memory_summary>",
              session.memorySummary || "",
              "</memory_summary>",
              "<task_memory>",
              JSON.stringify(compactTaskMemory(session.taskMemory)),
              "</task_memory>",
              "<recent_messages>",
              JSON.stringify(
                recentMessagesForTurn(
                  session.messages,
                  ALLOWED_MODES.has(effectiveForcedMode) ? effectiveForcedMode : detectIntent(message),
                  message,
                  session.profile || {}
                )
              ),
              "</recent_messages>",
              "<store_meta>",
              JSON.stringify({
                cities: uniqueStrings((storesPayload?.stores || []).map((item) => item.city)).slice(0, 20),
                brands: uniqueStrings((storesPayload?.stores || []).map((item) => item.brand)),
              }),
              "</store_meta>",
              "JSON schema:",
              JSON.stringify({
                mode: "recommendation | comparison | service",
                user_goal: "one sentence",
                clarify: { needed: false, question: "" },
                profile_updates: {
                  budget: "",
                  city: "",
                  body_types: [],
                  energy_types: [],
                  priorities: [],
                  usage: [],
                  charging: "",
                  seats: "",
                  preferred_brands: [],
                  excluded_brands: [],
                  mentioned_cars: [],
                },
                tool_calls: [{ name: "search_catalog", args: { limit: 3 } }],
                safety_notes: [],
              }),
            ].join("\n"),
          },
        ],
      }),
      LLM_PLANNER_TIMEOUT_MS,
      "planner"
    );
    const raw = completion.choices[0]?.message?.content?.trim() || "{}";
    const parsed = safeParseJson(raw) || {};
    const normalizedPlan = normalizePlan(parsed, fallback.mode);
    if (ALLOWED_MODES.has(effectiveForcedMode)) {
      normalizedPlan.mode = effectiveForcedMode;
    }
    normalizedPlan.toolCalls = enforceToolRoutingPolicy({
      policy: fallbackPolicy,
      requestedToolCalls: normalizedPlan.toolCalls,
      maxToolCalls: MAX_TOOL_CALLS,
    });
    return applyHeuristicClarification(normalizedPlan, session, message);
  } catch {
    return fallback;
  }
}

function buildTrace(profile, plan, toolResults) {
  const trace = [];
  if (Object.keys(profile).length) {
    trace.push({
      type: "memory",
      status: "completed",
      title: "更新用户画像",
      detail: buildMemorySummarySafe(profile),
    });
  }
  trace.push({
    type: "plan",
    status: "completed",
    title: "规划本轮任务",
    detail: `${plan.mode} / ${plan.userGoal || "根据当前输入生成回答"}`,
  });
  for (const item of toolResults) {
    trace.push({
      type: "tool",
      status: item.status,
      title: `调用工具 ${item.tool}`,
      detail: item.summary,
    });
  }
  return trace.slice(0, 6);
}

function buildMissionChecklist(profile, mode, message, structured) {
  const mentionedCars = Array.isArray(profile?.mentionedCars) ? profile.mentionedCars : [];
  const hasCandidateFocus =
    mentionedCars.length > 0 ||
    Boolean(profile?.preferredBrands?.length) ||
    Boolean(profile?.bodyTypes?.length);
  const hasStoreAction =
    /试驾|到店|门店|预约/.test(String(message || "")) ||
    [...(structured?.next_steps || []), ...(structured?.followups || [])].some((item) =>
      /试驾|到店|门店|预约/.test(String(item || ""))
    );

  return [
    { label: "锁定预算边界", done: Boolean(profile?.budget) },
    { label: "明确主要用车场景", done: Boolean(profile?.usage?.length) },
    { label: "确认补能条件", done: Boolean(profile?.charging) },
    {
      label: mode === "comparison" || mentionedCars.length >= 2 ? "收敛对比车型" : "收敛候选车型",
      done:
        mode === "comparison" || mentionedCars.length >= 2
          ? mentionedCars.length >= 2
          : hasCandidateFocus,
    },
    {
      label: mode === "service" ? "形成可执行处理方案" : "推进到试驾或门店动作",
      done:
        mode === "service"
          ? Boolean(structured?.steps?.length || structured?.notes?.length)
          : hasStoreAction,
    },
  ];
}

function deriveAgentStatus({ mode, plan, message, structured, missingInfo }) {
  const hasActionConversion =
    /试驾|到店|门店|预约/.test(String(message || "")) ||
    [...(structured?.next_steps || []), ...(structured?.followups || [])].some((item) =>
      /试驾|到店|门店|预约/.test(String(item || ""))
    );

  if (plan?.clarify?.needed || missingInfo.length >= 3) {
    return {
      code: "waiting_user",
      label: "等待补充信息",
      reason: "还缺少关键条件，继续补充后才能把推荐或执行动作进一步收窄。",
    };
  }

  if (mode === "service") {
    return {
      code: "solution_ready",
      label: "方案已可执行",
      reason: "已经整理出处理步骤和升级条件，可以按步骤继续处理。",
    };
  }

  if (hasActionConversion) {
    return {
      code: "ready_to_convert",
      label: "可推进转化",
      reason: "当前信息已经足够推进到试驾、门店或预约动作。",
    };
  }

  if (mode === "comparison") {
    return {
      code: "decision_ready",
      label: "进入车型决策",
      reason: "候选车型已经收敛，可以继续围绕智驾、空间和补能做最终决策。",
    };
  }

  return {
    code: "profiling",
    label: "持续收集偏好",
    reason: "正在补齐预算、场景和补能条件，帮助后续推荐更贴近真实需求。",
  };
}

function deriveAgentStage(mode, profile, message) {
  if (/试驾|到店|门店|预约/.test(message)) return "试驾转化";
  if (/保养|充电|保险|事故|OTA|车机|提车|交付/.test(message) || mode === "service") {
    return "车主服务";
  }
  if ((profile?.mentionedCars || []).length >= 2 || mode === "comparison") return "车型决策";
  if (profile?.budget || (profile?.usage || []).length || mode === "recommendation") return "潜客筛选";
  return "需求澄清";
}

function inferMissingInfo(profile, mode, message) {
  const effectiveProfile = buildDisplayProfile(profile || {}, message);
  const missing = [];
  if (mode === "recommendation") {
    if (getSingleFocusedCar(effectiveProfile, message) && !hasDecisionSignals(effectiveProfile)) {
      return [];
    }
    if (!effectiveProfile?.budget) missing.push("预算上限");
    if (!(effectiveProfile?.usage || []).length) missing.push("主要用车场景");
    if (!effectiveProfile?.charging) missing.push("是否能装家充");
    if (!effectiveProfile?.city && /试驾|门店|预约|广州|上海|深圳|北京/.test(message)) missing.push("所在城市");
  } else if (mode === "comparison") {
    if ((effectiveProfile?.mentionedCars || []).length < 2 && findMentionedCars(message).length < 2) {
      missing.push("另一款待对比车型");
    }
    if (!(effectiveProfile?.usage || []).length) missing.push("最重要的比较场景");
  } else {
    if (!/保养|充电|保险|事故|OTA|车机|提车|交付|门店|试驾/.test(message)) {
      missing.push("更具体的问题场景");
    }
  }
  return missing;
}

function buildDecisionDrivers(profile) {
  const drivers = [];
  if (profile?.budget) drivers.push(`预算约束：${profile.budget}`);
  if ((profile?.usage || []).length) drivers.push(`核心场景：${profile.usage.join(" / ")}`);
  if ((profile?.priorities || []).length) drivers.push(`重点诉求：${profile.priorities.join(" / ")}`);
  if (profile?.charging) drivers.push(`补能条件：${profile.charging}`);
  if ((profile?.bodyTypes || []).length) drivers.push(`车型偏好：${profile.bodyTypes.join(" / ")}`);
  return drivers.slice(0, 4);
}

function fitScoreToPercent(score) {
  return Math.max(58, Math.min(96, Math.round(66 + score * 5)));
}

function buildCarStaticReasonsLocal(car) {
  const highlights = Array.isArray(car?.highlights) ? uniqueStrings(car.highlights) : [];
  if (highlights.length) return highlights.slice(0, 3);

  const reasons = [];
  const bodyType = String(car?.bodyType || "");
  const smart = String(car?.smart || "");
  const carRange = parseRangeKm(car?.range);
  const seats = Number(car?.seats || 0);

  if (/MPV/i.test(bodyType) || seats >= 6) reasons.push("多人出行和乘坐舒适性是这款车的核心卖点");
  if (/SUV/i.test(bodyType)) reasons.push("SUV 车身形态更强调空间、视野和日常实用性");
  if (/轿跑|轿车/i.test(bodyType)) reasons.push("轿车取向更偏向城市通勤效率和驾驶质感");
  if (/高|领先|旗舰|强/.test(smart)) reasons.push("智能座舱和辅助驾驶能力是它的重要看点");
  if (carRange != null && carRange >= 650) reasons.push("续航能力处在小鹏当前产品线的靠前水平");
  else if (carRange != null && carRange >= 580) reasons.push("续航表现在日常通勤加周末出行场景下比较从容");

  return uniqueStrings(reasons).slice(0, 3);
}

function isLowSignalRecommendationText(text) {
  return /当前输入的预算、场景或智能化诉求|当前需求下的重点候选|重点候选/.test(String(text || ""));
}

function normalizeRecommendationReasonList(reasons, car, profile, message) {
  const cleaned = uniqueStrings(reasons || []).filter((item) => !isLowSignalRecommendationText(item));
  if (cleaned.length) return cleaned.slice(0, 3);
  return buildCarReasonsLocal(car, profile, message);
}

function buildCarReasonsLocal(car, profile, message) {
  const reasons = [];
  const bodyType = String(car.bodyType || "");
  const smart = String(car.smart || "");
  const carRange = parseRangeKm(car.range);
  const budgetHint = parseBudgetTextSafe(profile?.budget);
  const priceWan = parsePriceWan(car.price);

  if ((profile?.bodyTypes || []).some((item) => /SUV/i.test(item)) && /SUV/i.test(bodyType)) {
    reasons.push("车身形式和你当前偏好的 SUV 方向一致");
  }
  if ((profile?.bodyTypes || []).some((item) => /轿车|Sedan/i.test(item)) && /轿车/.test(bodyType)) {
    reasons.push("轿车定位更贴近你当前的车身偏好");
  }
  if ((profile?.priorities || []).some((item) => /ADAS|智能驾驶/.test(item)) && /高|领先|强/.test(smart)) {
    reasons.push("智能驾驶和座舱能力在同价位里更有竞争力");
  }
  if ((profile?.priorities || []).some((item) => /Range|续航/.test(item)) && carRange != null && carRange >= 600) {
    reasons.push("续航表现对通勤加周末出行都更从容");
  }
  if ((profile?.usage || []).some((item) => /CityCommute|城市通勤/.test(item))) {
    reasons.push("城市通勤场景下，这类车更容易兼顾舒适和日常效率");
  }
  if (budgetHint?.maxWan != null && priceWan != null && priceWan <= budgetHint.maxWan + 1.5) {
    reasons.push("价格区间基本落在你当前预算附近，后续更适合深入比较");
  }
  if (car.brand === "小鹏" && /(智驾|智能化|座舱|语音)/i.test(message)) {
    reasons.push("如果你重视智能化体验，小鹏这条线值得放进重点试驾清单");
  }

  const staticReasons = buildCarStaticReasonsLocal(car);
  for (const item of staticReasons) {
    if (reasons.length >= 3) break;
    reasons.push(item);
  }

  return uniqueStrings(reasons).slice(0, 3);
}

function buildCarTradeoffsLocal(car, profile) {
  const tradeoffs = [];
  const budgetHint = parseBudgetTextSafe(profile?.budget);
  const priceWan = parsePriceWan(car.price);

  if (budgetHint?.maxWan != null && priceWan != null && priceWan > budgetHint.maxWan + 1.5) {
    tradeoffs.push("价格会略超你当前预算，需要重点确认终端权益或是否接受上探");
  }
  if (/因配置|以官网为准/.test(String(car.range || ""))) {
    tradeoffs.push("续航口径受配置差异影响较大，试驾前最好再核对具体版本");
  }
  if (/中高|主流/.test(String(car.smart || ""))) {
    tradeoffs.push("智能化能力不一定在同级最强，建议实测车机和辅助驾驶体验");
  }
  if ((profile?.charging || "").includes("受限") && /纯电/.test(String(car.bodyType || ""))) {
    tradeoffs.push("如果家充受限，需要额外考虑补能便利性");
  }
  return uniqueStrings(tradeoffs).slice(0, 2);
}

function buildRecommendationLocal(session, message, plan, toolResults) {
  const profile = session?.profile || {};
  const displayProfile = buildDisplayProfile(profile, message);
  const singleFocusedCar = getSingleFocusedCar(displayProfile, message);
  const searchResult = toolResults.find((item) => item.tool === "search_catalog");
  const rawCandidates = Array.isArray(searchResult?.data) && searchResult.data.length
    ? searchResult.data
    : selectRecommendationCandidates(buildRankedCatalog(profile, message), profile, message, 3);
  const candidates = selectRecommendationCandidates(rawCandidates, profile, message, 3);
  const stores = (toolResults.find((item) => item.tool === "find_stores")?.data || []).slice(0, 2);
  const missingInfo =
    singleFocusedCar && !hasDecisionSignals(displayProfile)
      ? []
      : inferMissingInfo(displayProfile, "recommendation", message);
  const decisionDrivers = buildDecisionDrivers(displayProfile);

  const comparisonDriven = isDetailedDecisionRequestSafe(message);
  const cars = enrichRecommendationCars(candidates.map((car) => ({
    brand: car.brand,
    name: car.name,
    price: car.price,
    range: car.range,
    smart: car.smart,
    fitScore: fitScoreToPercent(car.agentScore ?? 0),
    bestFor: (() => {
      if (/SUV/i.test(String(car.bodyType || "")) && (displayProfile?.usage || []).some((item) => /Family|家庭/.test(item))) {
        return "更适合兼顾家庭空间与日常通勤的用户";
      }
      if (/轿车/.test(String(car.bodyType || ""))) {
        return "更适合追求通勤效率和驾驶质感的用户";
      }
      return buildCarBestForLocal(car, displayProfile);
    })(),
    reasons: buildCarReasonsLocal(car, displayProfile, message),
    tradeoffs: buildCarTradeoffsLocal(car, displayProfile),
  })), displayProfile, message);

  const nextSteps = [];
  if (cars.length >= 2) nextSteps.push(`先把 ${cars[0].name} 和 ${cars[1].name} 做一次深度对比`);
  if (stores.length) nextSteps.push(`如果准备线下体验，可优先去 ${stores[0].name}`);
  if (missingInfo.length) nextSteps.push(`继续补充：${missingInfo.join("、")}`);
  if (singleFocusedCar && cars[0]) nextSteps.push(`继续确认 ${cars[0].name} 的版本、续航和智驾差异`);
  nextSteps.push(singleFocusedCar ? "确认目标版本后，再决定是否预约试驾和询价" : "确定 1-2 台重点候选后，再决定是否预约试驾和询价");

  return {
    intro: singleFocusedCar && !hasDecisionSignals(displayProfile)
      ? `这轮先按 ${cars[0]?.name || singleFocusedCar.name} 单车型讲解处理，重点看车型定位、版本差异、亮点和需要留意的取舍。`
      : missingInfo.length
      ? `我先按你已经给出的条件做第一轮筛选，同时把还缺的信息标出来，方便继续收窄。`
      : `我已经能基于你的预算、城市和用车场景给出一版更接近决策的候选清单。`,
    persona_summary: session.memorySummary || "当前画像还在逐步完善中。",
    decision_drivers: decisionDrivers,
    cars,
    compare_note: cars.length >= 2
      ? `${cars[0].name} 更适合优先做主选参考，${cars[1].name}${cars[1].brand === "小鹏" ? " 也值得作为智能化导向的备选" : " 可作为重要对照项"}。`
      : cars[0] && singleFocusedCar
        ? `这次先围绕 ${cars[0].name} 单车型展开，重点看定位、适合人群、核心优势和需要注意的取舍。`
        : "建议继续补充约束条件，我再把候选清单收窄。",
    missing_info: missingInfo,
    next_steps: uniqueStrings(nextSteps).slice(0, 4),
    final_one_liner: cars[0]
      ? `如果你现在就要继续推进，我建议先围绕 ${cars[0].brand} ${cars[0].name} 展开详细对比和试驾。`
      : "你继续补充条件，我可以把候选范围明显缩小。",
  };
}

function buildAbstractComparisonDimensions(message) {
  const text = String(message || "");
  if (/SUV/i.test(text) && /轿车|Sedan/i.test(text)) {
    return [
      { label: "空间/上下车便利", a: "SUV 更有优势", b: "轿车相对一般" },
      { label: "城市通勤灵活性", a: "视车身尺寸而定", b: "轿车通常更灵活" },
      { label: "长途舒适与稳定性", a: "坐姿高、视野好", b: "风阻更低、能耗更稳" },
      { label: "家用装载能力", a: "SUV 通常更强", b: "轿车后备厢更规整但扩展有限" },
    ];
  }
  return [];
}

function buildComparisonLocal(session, message, plan, toolResults) {
  const compareResult = toolResults.find((item) => item.tool === "compare_catalog");
  const cars = Array.isArray(compareResult?.data) ? compareResult.data.filter(Boolean) : [];
  const missingInfo = inferMissingInfo(session?.profile || {}, "comparison", message);
  const abstractDimensions = buildAbstractComparisonDimensions(message);

  if (cars.length < 2) {
    return {
      intro: abstractDimensions.length ? "我先按你给出的车身形态和用车场景做一版抽象对比。" : "这轮还不足以形成有效对比。",
      decision_focus: abstractDimensions.length
        ? ["先判断你更偏家用空间还是通勤效率", "再决定是否进入具体车型对比"]
        : ["请补全两款具体车型", "告诉我你的主要决策场景"],
      dimensions: abstractDimensions,
      conclusion: abstractDimensions.length
        ? "如果你更重视家用空间、装载和高坐姿，SUV 更稳；如果更在意城市通勤效率、能耗和操控感，轿车通常更合适。"
        : "你直接发两个明确车名，我就能从价格、空间、续航、智能化和用车成本给你做结论。",
      next_steps: abstractDimensions.length
        ? ["告诉我预算上限", "说明你更偏家用、通勤还是长途", "我再按这个方向给你收窄到具体车型"]
        : ["补充另一款车型", "说明你更看重家用、通勤还是长途"],
    };
  }

  const [a, b] = cars;
  const focus = buildDecisionDrivers(session?.profile || {});
  const nextSteps = [
    `如果你重视智驾和座舱，优先去试驾 ${a.brand} ${a.name} 与 ${b.brand} ${b.name}`,
    "把最在意的 2-3 个维度单独拎出来确认，不要一次比较过多信息",
  ];

  return {
    intro: `我把 ${a.brand} ${a.name} 和 ${b.brand} ${b.name} 按决策维度展开了，方便你直接进入取舍。`,
    carNames: [`${a.brand} ${a.name}`, `${b.brand} ${b.name}`],
    decision_focus: focus,
    dimensions: [
      { label: "价格", a: a.price, b: b.price },
      { label: "续航/能耗", a: a.range, b: b.range },
      { label: "智能化", a: a.smart, b: b.smart },
      { label: "车身形式", a: a.bodyType, b: b.bodyType },
    ],
    conclusion: `${a.brand} ${a.name} 更适合看重${/高|领先|强/.test(String(a.smart || "")) ? "智能化" : "综合均衡"}的一侧；${b.brand} ${b.name} 更适合作为${/SUV/i.test(String(b.bodyType || "")) ? "空间/家用" : "价格/风格"}取向的对照项。`,
    next_steps: uniqueStrings([...nextSteps, ...missingInfo.map((item) => `继续补充：${item}`)]).slice(0, 4),
  };
}

function buildServiceLocal(session, message, plan, toolResults) {
  const knowledgeResult = toolResults.find((item) => item.tool === "search_service_knowledge");
  const knowledge = Array.isArray(knowledgeResult?.data) ? knowledgeResult.data : [];
  const stores = (toolResults.find((item) => item.tool === "find_stores")?.data || []).slice(0, 2);
  const primary = knowledge[0];

  if (primary) {
    const nextSteps = [...(primary.followups || [])];
    if (stores.length) nextSteps.push(`如果需要线下处理，可优先联系 ${stores[0].name}`);
    return {
      title: primary.title,
      diagnosis: primary.summary,
      steps: primary.steps,
      notes: primary.notes,
      citations: Array.isArray(primary.citations) ? primary.citations : [],
      when_to_escalate: /事故|保险|维修|高压|故障/.test(message)
        ? ["涉及安全、高压系统或事故时，优先联系官方售后或道路救援"]
        : ["如果重复出现异常或影响正常驾驶，建议联系官方售后进一步检查"],
      next_steps: uniqueStrings(nextSteps).slice(0, 4),
      closing: "如果你告诉我更具体的车型、城市或异常现象，我可以继续把建议收窄。",
    };
  }

  return {
    title: "我先把下一步处理方式梳理出来",
    diagnosis: "当前问题还比较泛，我可以继续细化到购车、试驾或车主服务的具体场景。",
    steps: [
      "明确你现在处在购车前、试驾中还是已经提车后的阶段",
      "告诉我更具体的问题，例如保养、充电、保险、车机或门店",
      "如果需要线下动作，再补充所在城市，我可以继续帮你接到门店或试驾动作",
    ],
    notes: ["涉及价格、活动、保养政策或维修方案时，以品牌官方渠道为准。"],
    when_to_escalate: ["涉及事故、故障灯、高压系统或无法正常驾驶时，直接联系官方售后"],
    next_steps: ["我想预约试驾，人在广州", "帮我列一个冬季续航管理建议", "纯电车一年保养看哪些项目"],
    closing: "你继续补一条具体需求，我会按真实业务流程往下推进。",
  };
}

function buildEscalationStructured(message, routingPolicy) {
  const text = String(message || "");
  const dangerHints = [];

  if (/事故|碰撞|剐蹭/.test(text)) {
    dangerHints.push("车辆发生事故或碰撞后，先确保人身安全，再处理车辆。");
  }
  if (/高压|电池|充电/.test(text)) {
    dangerHints.push("涉及电池包、高压系统或充电异常时，不建议继续充电或强行继续使用车辆。");
  }
  if (/故障灯|无法驾驶|失控|刹车/.test(text)) {
    dangerHints.push("如果已经影响正常驾驶，不建议继续上路，应优先等待官方处置。");
  }

  return {
    title: "当前问题需要官方售后或人工接管",
    diagnosis: routingPolicy?.escalation?.reason || "当前问题存在安全或责任边界风险，不适合继续给出普通操作建议。",
    steps: [
      "先停止继续试车、继续驾驶或继续充电，优先确认人身与现场安全。",
      "尽快联系品牌官方售后、道路救援或事故处理热线，由官方渠道接管。",
      "准备好车型、所在城市、故障提示或受损位置，方便官方快速判断是否需要拖车或到店。 ",
    ],
    notes: uniqueStrings([
      ...dangerHints,
      "这类问题不应依赖泛化经验判断，后续处理请以官方检测结果为准。",
    ]),
    when_to_escalate: [
      "已经出现高压系统报警、电池包受损、冒烟、漏液、无法正常驾驶或事故责任判断时，立即走官方渠道",
    ],
    next_steps: [
      "告诉我车型、所在城市和当前故障提示，我可以帮你整理给官方的关键信息",
      "如果你现在需要到店或救援，我可以继续帮你整理下一步沟通要点",
    ],
    closing: "这类场景先不要追求在线结论，优先让官方售后或道路救援接管。",
  };
}

function buildAgentConfidence(profile, mode, toolResults) {
  let score = 0.45;
  if (profile?.budget) score += 0.12;
  if (profile?.city) score += 0.08;
  if ((profile?.usage || []).length) score += 0.08;
  if ((profile?.priorities || []).length) score += 0.08;
  if ((profile?.mentionedCars || []).length >= 2 && mode === "comparison") score += 0.12;
  if (toolResults.some((item) => item.tool === "search_catalog" && item.status === "completed")) score += 0.1;
  if (toolResults.some((item) => item.tool === "search_service_knowledge" && item.status === "completed")) score += 0.08;
  return Math.max(0.45, Math.min(0.95, Number(score.toFixed(2))));
}

function buildLocalStructured(mode, session, message, plan, toolResults) {
  if (mode === "recommendation") return buildRecommendationLocal(session, message, plan, toolResults);
  if (mode === "comparison") return buildComparisonLocal(session, message, plan, toolResults);
  return buildServiceLocal(session, message, plan, toolResults);
}

function fallbackRecommendationStructured(toolResults, session, message) {
  const profile = buildDisplayProfile(session?.profile || {}, message);
  const singleFocusedCar = getSingleFocusedCar(profile, message);
  const missingInfo =
    singleFocusedCar && !hasDecisionSignals(profile)
      ? []
      : inferMissingInfo(profile, "recommendation", message);
  const searchResult = toolResults.find((item) => item.tool === "search_catalog");
  const cars = sanitizeRecommendationCars(
    Array.isArray(searchResult?.data) ? searchResult.data : getCars().slice(0, 3),
    profile,
    message,
    3
  );
  const memorySummary = buildMemorySummarySafe(profile);
  return {
    intro: memorySummary
      ? `我先按已记录的画像为你筛了一轮车型，后续你补充预算或城市后还能继续收窄。`
      : "我先按当前问题筛了一轮候选车型，后续补充预算、城市或充电条件后还能继续细化。",
    cars: cars.slice(0, 3).map((car) => ({
      brand: car.brand,
      name: car.name,
      price: car.price,
      range: car.range,
      smart: car.smart,
      fitScore: fitScoreToPercent(car.agentScore ?? 0),
      bestFor: buildCarBestForLocal(car, profile),
      reasons: [
        `${car.bodyType || "新能源车型"}，和当前需求有一定匹配度`,
        "具体价格、权益和配置请以品牌官网和门店公示为准",
      ],
    })),
    persona_summary: buildMemorySummarySafe(profile) || undefined,
    compare_note: "建议从预算、补能条件、智能驾驶和空间诉求四个维度继续缩小范围。",
    final_one_liner: "如果你告诉我预算上限和所在城市，我可以继续把推荐收窄到 2-3 款。",
    followups: [
      "我预算 25 万左右，人在广州",
      "我家里能装桩，主要看城市通勤和周末自驾",
      "把其中两款做详细对比",
    ],
  };
}

function buildScopedRecommendationFallback(toolResults, session, message) {
  const profile = buildDisplayProfile(session?.profile || {}, message);
  const singleFocusedCar = getSingleFocusedCar(profile, message);
  const missingInfo =
    singleFocusedCar && !hasDecisionSignals(profile)
      ? []
      : inferMissingInfo(profile, "recommendation", message);
  const searchResult = toolResults.find((item) => item.tool === "search_catalog");
  const cars = sanitizeRecommendationCars(
    Array.isArray(searchResult?.data) && searchResult.data.length
      ? searchResult.data
      : buildFallbackRecommendationCandidates(profile, message, 3),
    profile,
    message,
    3
  ).map((car) => ({
    brand: car.brand,
    name: car.name,
    price: car.price,
    range: car.range,
    smart: car.smart,
    fitScore: fitScoreToPercent(car.agentScore ?? 0),
    bestFor: buildCarBestForLocal(car, profile),
    reasons: buildCarReasonsLocal(car, profile, message),
    tradeoffs: buildCarTradeoffsLocal(car, profile),
  }));

  return {
    intro:
      singleFocusedCar && !hasDecisionSignals(profile)
        ? `这轮先按 ${singleFocusedCar.name} 单车型讲解处理，重点看亮点、适合人群和需要留意的取舍。`
        : missingInfo.length
          ? "我先按你这轮已经给出的条件整理一版候选，同时把还缺的信息标出来，方便继续收窄。"
          : "我先按你这轮问题整理出更匹配的候选，后续补充条件后还能继续细化。",
    persona_summary: buildMemorySummarySafe(profile) || undefined,
    cars,
    compare_note:
      cars.length >= 2
        ? `${cars[0].name} 更适合先作为主选参考，${cars[1].name} 可以作为重点对照项继续细看。`
        : singleFocusedCar
          ? `这次先围绕 ${singleFocusedCar.name} 单车型展开，不再混入其他车系。`
          : "继续补充预算、场景或补能条件后，我可以把候选继续收窄。",
    missing_info: missingInfo,
    next_steps: uniqueStrings([
      singleFocusedCar
        ? `继续确认 ${singleFocusedCar.name} 的版本、续航和智驾差异`
        : cars.length >= 2
          ? `先把 ${cars[0].name} 和 ${cars[1].name} 做一次深入对比`
          : "",
      missingInfo.length ? `继续补充：${missingInfo.join("、")}` : "",
      cars[0] ? `如果准备线下体验，可以继续看 ${cars[0].name} 的试驾和门店` : "",
    ]).slice(0, 4),
    final_one_liner: cars[0]
      ? `如果你现在要继续推进，我建议先围绕 ${cars[0].name} 深挖版本差异，再决定是否预约试驾。`
      : "你继续补充条件，我可以把候选明显收窄。",
    followups: uniqueStrings([
      ...(singleFocusedCar
        ? [
            `继续分析 ${singleFocusedCar.name} 哪个版本更值`,
            `帮我比较 ${singleFocusedCar.name} 不同版本怎么选`,
          ]
        : []),
      ...(!singleFocusedCar && !profile.budget ? ["我的预算在 20 万左右"] : []),
      ...(!singleFocusedCar && !profile.usage?.length
        ? ["主要是城市通勤，周末偶尔带家人出游"]
        : []),
      ...(!singleFocusedCar && !profile.city ? ["我在天津，帮我看看更适合哪款"] : []),
      ...(cars.length >= 2 ? [`把 ${cars[0].name} 和 ${cars[1].name} 做个详细对比`] : []),
    ]).slice(0, 4),
  };
}

function fallbackComparisonStructured(toolResults, message) {
  const compareResult = toolResults.find((item) => item.tool === "compare_catalog");
  const cars = Array.isArray(compareResult?.data) ? compareResult.data : [];
  if (cars.length >= 2) {
    return {
      intro: "我先基于目录里的车型信息给你做一版对比。",
      carNames: [`${cars[0].brand} ${cars[0].name}`, `${cars[1].brand} ${cars[1].name}`],
      dimensions: [
        { label: "价格", a: cars[0].price, b: cars[1].price },
        { label: "续航/能耗", a: cars[0].range, b: cars[1].range },
        { label: "智能化", a: cars[0].smart, b: cars[1].smart },
        { label: "车身形式", a: cars[0].bodyType, b: cars[1].bodyType },
      ],
      conclusion: "如果你更看重具体场景，比如家用、通勤还是长途，我可以继续补一版更针对的结论。",
      followups: [
        "从家用和带娃场景再比一次",
        "如果没有家充，这两款谁更适合",
        "把智驾和座舱体验单独展开",
      ],
    };
  }
  const abstractDimensions = buildAbstractComparisonDimensions(message);
  if (abstractDimensions.length) {
    return {
      intro: "我先按车身形态和使用场景做一版抽象对比。",
      dimensions: abstractDimensions,
      conclusion: "家用、空间和装载优先看 SUV；通勤效率、能耗和操控感优先看轿车。",
      followups: [
        "我预算 20 万左右，主要城市通勤",
        "家里有小孩，周末会自驾",
        "按这个方向给我推荐两款具体车型",
      ],
    };
  }
  return {
    intro: "目前我还缺少完整的车型信息。",
    dimensions: [],
    conclusion: "你可以直接回复两款明确车型名称，我会按价格、续航、智能化和空间给你做并排对比。",
    followups: [
      "小鹏 G6 和小鹏 G9 怎么选",
      "小鹏 P7i 和小鹏 G6 对比一下",
    ],
  };
}

function fallbackServiceStructured(plan, toolResults) {
  const storeResult = toolResults.find((item) => item.tool === "find_stores");
  const stores = Array.isArray(storeResult?.data) ? storeResult.data : [];
  const knowledgeResult = toolResults.find((item) => item.tool === "search_service_knowledge");
  const knowledge = Array.isArray(knowledgeResult?.data) ? knowledgeResult.data : [];
  if (plan.clarify.needed && plan.clarify.question) {
    return {
      title: "继续处理前需要补充信息",
      steps: [plan.clarify.question],
      notes: ["直接回复这条消息即可，我会基于新信息继续执行。"],
      closing: "补充得越具体，后续推荐和门店匹配会越准确。",
      followups: [plan.clarify.question.replace(/[。？?]$/, "")],
    };
  }
  if (knowledge.length) {
    const primary = knowledge[0];
    return {
      title: primary.title,
      steps: primary.steps,
      notes: [...(primary.notes || []), "涉及官方活动、保养政策和维修方案时，请以品牌官方渠道为准。"],
      citations: Array.isArray(primary.citations) ? primary.citations : [],
      closing: primary.summary,
      followups: primary.followups || [],
    };
  }
  if (stores.length) {
    return {
      title: "已找到相关门店线索",
      steps: stores.map((store) => `${store.name}，${store.city}，${store.address}`),
      notes: ["门店信息请以品牌官网和实际电话确认结果为准。"],
      closing: "如果你要预约试驾，可以继续告诉我意向车型、城市和时间段。",
      followups: [
        "我想预约试驾，帮我整理下一步",
        "我人在广州，帮我推荐近一点的门店",
      ],
    };
  }
  return {
    title: "已整理下一步建议",
    steps: [
      "补充预算、车型偏好或城市信息",
      "如果要到店，优先告诉我所在城市",
      "如果要对比车型，直接给出两个明确车名",
    ],
    notes: ["重要价格、权益、库存和活动信息请以官方渠道为准。"],
    closing: "你继续发需求，我会按当前画像接着往下做。",
    followups: [
      "我想预约试驾，人在上海",
      "帮我列一个冬季续航管理建议",
      "纯电车保养主要看什么",
    ],
  };
}

function matchCatalogCarByName(name) {
  const normalized = normalizeText(name);
  if (!normalized) return null;
  return (
    getCars().find((car) => normalizeText(`${car.brand || ""}${car.name || ""}`) === normalized) ||
    getCars().find((car) => normalizeText(car.name) === normalized) ||
    getCars().find((car) => normalized.includes(normalizeText(car.name)) || normalizeText(car.name).includes(normalized)) ||
    null
  );
}

function sanitizeRecommendationCars(cars, profile, message, limit = 3) {
  const effectiveProfile = buildDisplayProfile(profile, message);
  const focusedCarNames = new Set(getFocusedMentionedCars(effectiveProfile, message).map((car) => car.name).filter(Boolean));
  const currentTurnMentionedCarNames = uniqueStrings(
    findMentionedCars(message).map((car) => car.name).filter(Boolean)
  );
  const singleFocusedCar = getSingleFocusedCar(effectiveProfile, message);
  const rankedFallback = selectRecommendationCandidates(
    buildRankedCatalog(effectiveProfile || {}, message),
    effectiveProfile || {},
    message,
    limit
  );
  const budgetHint = parseBudgetTextSafe(effectiveProfile?.budget);
  const wantsSuv = (effectiveProfile?.bodyTypes || []).some((item) => /SUV/i.test(String(item || "")));
  const wantsSedan = (effectiveProfile?.bodyTypes || []).some((item) =>
    /轿车|Sedan/i.test(String(item || ""))
  );
  const wantsMpv = (effectiveProfile?.bodyTypes || []).some((item) => /MPV/i.test(String(item || "")));
  const normalizedLimit = Math.max(1, Math.min(4, Number(limit) || 3));
  const forcedSingleCarNames = singleFocusedCar?.name ? new Set([singleFocusedCar.name]) : null;
  const forcedCurrentTurnCarNames =
    currentTurnMentionedCarNames.length >= 2 ? new Set(currentTurnMentionedCarNames) : null;
  const allowedCarNames =
    forcedSingleCarNames ||
    forcedCurrentTurnCarNames ||
    new Set(rankedFallback.map((car) => car.name).filter(Boolean));
  const selected = [];
  const used = new Set();

  for (const item of Array.isArray(cars) ? cars : []) {
    const matched = matchCatalogCarByName(item?.name || "");
    if (!matched || matched.brand !== "小鹏") continue;
    const matchedBodyType = String(matched.bodyType || "");
    if (wantsSuv && !/SUV/i.test(matchedBodyType)) continue;
    if (wantsSedan && !/轿车/i.test(matchedBodyType)) continue;
    if (wantsMpv && !/MPV|六座|七座/i.test(matchedBodyType)) continue;
    if (allowedCarNames.size && !allowedCarNames.has(matched.name)) continue;
    const priceWan = parsePriceWan(matched.price);
    if (budgetHint && priceWan != null && !focusedCarNames.has(matched.name)) {
      const lowerBound = budgetHint.minWan != null ? Math.max(0, budgetHint.minWan - 0.8) : -Infinity;
      const upperBound = budgetHint.maxWan != null ? budgetHint.maxWan + 1.2 : Infinity;
      if (priceWan < lowerBound || priceWan > upperBound) continue;
    }
    if (used.has(matched.name)) continue;
    selected.push({
      brand: matched.brand,
      name: matched.name,
      image: matched.image,
      price: item?.price || matched.price,
      range: item?.range || matched.range,
      smart: item?.smart || matched.smart,
      fitScore: item?.fitScore,
      bestFor: item?.bestFor,
      reasons: Array.isArray(item?.reasons) && item.reasons.length ? item.reasons : buildCarReasonsLocal(matched, effectiveProfile || {}, message),
      tradeoffs:
        Array.isArray(item?.tradeoffs) && item.tradeoffs.length
          ? item.tradeoffs
          : buildCarTradeoffsLocal(matched, effectiveProfile || {}),
    });
    used.add(matched.name);
  }

  for (const car of rankedFallback) {
    if (selected.length >= normalizedLimit) break;
    const fallbackBodyType = String(car.bodyType || "");
    if (wantsSuv && !/SUV/i.test(fallbackBodyType)) continue;
    if (wantsSedan && !/轿车/i.test(fallbackBodyType)) continue;
    if (wantsMpv && !/MPV|六座|七座/i.test(fallbackBodyType)) continue;
    if (allowedCarNames.size && !allowedCarNames.has(car.name)) continue;
    if (used.has(car.name)) continue;
    selected.push({
      brand: car.brand,
      name: car.name,
      image: car.image,
      price: car.price,
      range: car.range,
      smart: car.smart,
      fitScore: fitScoreToPercent(car.agentScore ?? 0),
      bestFor: /SUV/i.test(String(car.bodyType || ""))
        ? "更适合兼顾空间、通勤和周末出行"
        : "更适合看重设计感和城市通勤效率",
      reasons: buildCarReasonsLocal(car, effectiveProfile || {}, message),
      tradeoffs: buildCarTradeoffsLocal(car, effectiveProfile || {}),
    });
    used.add(car.name);
  }

  if (!selected.length) {
    const emergencyFallback = buildFallbackRecommendationCandidates(
      effectiveProfile || {},
      "",
      normalizedLimit
    );
    for (const car of emergencyFallback) {
      if (selected.length >= normalizedLimit) break;
      if (used.has(car.name)) continue;
      selected.push({
        brand: car.brand,
        name: car.name,
        image: car.image,
        price: car.price,
        range: car.range,
        smart: car.smart,
        fitScore: fitScoreToPercent(car.agentScore ?? 0),
        bestFor: buildCarBestForLocal(car, effectiveProfile || {}),
        reasons: buildCarReasonsLocal(car, effectiveProfile || {}, ""),
        tradeoffs: buildCarTradeoffsLocal(car, effectiveProfile || {}),
      });
      used.add(car.name);
    }
  }

  if (!selected.length && singleFocusedCar) {
    const matched = matchCatalogCarByName(singleFocusedCar.name);
    if (matched) {
      selected.push({
        brand: matched.brand,
        name: matched.name,
        image: matched.image,
        price: matched.price,
        range: matched.range,
        smart: matched.smart,
        fitScore: fitScoreToPercent(matched.agentScore ?? 0),
        bestFor: buildCarBestForLocal(matched, effectiveProfile || {}),
        reasons: buildCarReasonsLocal(matched, effectiveProfile || {}, message),
        tradeoffs: buildCarTradeoffsLocal(matched, effectiveProfile || {}),
      });
    }
  }

  return enrichRecommendationCars(
    selected.slice(0, forcedSingleCarNames ? 1 : normalizedLimit),
    effectiveProfile || {},
    message
  );
}

function sanitizeRecommendationTextList(items, cars) {
  const allowedNames = new Set((cars || []).map((car) => car.name).filter(Boolean));
  return uniqueStrings(items || []).filter((item) => {
    const mentioned = findMentionedCars(String(item || "")).map((car) => car.name);
    if (!mentioned.length) return true;
    return mentioned.every((name) => allowedNames.has(name));
  });
}

function buildRecommendationNextStepsSafe(cars, profile, message = "") {
  const missingInfo =
    cars.length === 1 && !hasDecisionSignals(profile || {})
      ? []
      : inferMissingInfo(profile || {}, "recommendation", message);
  const steps = [];
  if (cars.length >= 2) steps.push(`先把 ${cars[0].name} 和 ${cars[1].name} 做一次深度对比`);
  if (cars[0]) steps.push(`继续确认 ${cars[0].name} 的版本、续航和智驾差异`);
  if (missingInfo.length) steps.push(`继续补充：${missingInfo.join("、")}`);
  steps.push(cars.length === 1 ? "确认目标版本后，再决定是否预约试驾和询价" : "确定 1-2 台重点候选后，再决定是否预约试驾和询价");
  return uniqueStrings(steps).slice(0, 4);
}

function buildRecommendationFollowupsSafe(cars, profile) {
  const followups = [];
  if (!profile?.budget) followups.push("我预算 20 万内，主要城市通勤");
  if (!profile?.city) followups.push("我人在上海，家里不能装桩");
  if (cars.length >= 2) followups.push(`把 ${cars[0].name} 和 ${cars[1].name} 详细对比`);
  if (cars[0]) followups.push(`继续分析 ${cars[0].name} 哪个版本更值`);
  return uniqueStrings(followups).slice(0, 4);
}

function buildFallbackRecommendationCandidates(profile, message, limit = 3) {
  return selectRecommendationCandidates(
    buildRankedCatalog(profile || {}, message),
    profile || {},
    message,
    limit
  );
}

function looksLikeServiceKnowledgeLeak(text) {
  return /(?:^|\n)#\s+[^\n]+\n(?:\n)?-\s*(?:\u9636\u6bb5|stage)\s*:|##\s*(?:\u6458\u8981|\u5173\u952e\u8bcd|\u64cd\u4f5c\u5efa\u8bae)/iu.test(
    String(text || "")
  );
}

function isServiceStructuredPayload(structured) {
  if (!structured || typeof structured !== "object") return false;
  const cars = Array.isArray(structured.cars) ? structured.cars.filter(Boolean) : [];
  if (cars.length) return false;

  return Boolean(
    (Array.isArray(structured.steps) && structured.steps.length) ||
      (Array.isArray(structured.notes) && structured.notes.length) ||
      (typeof structured.title === "string" && structured.title.trim()) ||
      (typeof structured.diagnosis === "string" && structured.diagnosis.trim())
  );
}

function hasExploratoryRecommendationIntentForRecovery(text) {
  return /(?:推荐|帮我推荐|几款|哪几款|值得|重点试驾|适合我|帮我选|预算|通勤|家用|周末|出游|小鹏车型)/u.test(
    String(text || "")
  );
}

function shouldRecoverRecommendationTurn(message, mode, structured, reply, expectedMode = "") {
  const hasExploratoryRecommendation = hasExploratoryRecommendationIntentForRecovery(message);
  if (hasServiceGuidanceIntent(message) && !hasExploratoryRecommendation) {
    return false;
  }

  const hasRecommendationIntent =
    expectedMode === "recommendation" ||
    mode === "recommendation" ||
    detectIntent(message) === "recommendation" ||
    hasExploratoryRecommendation;
  if (!hasRecommendationIntent) return false;
  if (mode !== "recommendation") return true;

  const cars = Array.isArray(structured?.cars) ? structured.cars.filter(Boolean) : [];
  if (!cars.length) return true;

  return isServiceStructuredPayload(structured) || looksLikeServiceKnowledgeLeak(reply);
}

function recoverRecommendationTurn({ message, profile, structured, reply, toolResults }) {
  const fallbackStructured = buildScopedRecommendationFallback(
    toolResults,
    { profile: profile || {} },
    message
  );
  const merged =
    structured && typeof structured === "object" && Array.isArray(structured.cars) && structured.cars.length
      ? { ...fallbackStructured, ...structured }
      : fallbackStructured;
  const nextStructured = ensureRecommendationStructuredV2(
    merged,
    reply,
    profile || {},
    message
  );

  return {
    mode: "recommendation",
    structured: nextStructured,
    reply: renderReply("recommendation", nextStructured, reply),
  };
}

function ensureRecommendationStructured(structured, rawText, profile = {}, message = "") {
  const effectiveProfile = buildDisplayProfile(profile, message, rawText);
  const comparisonDriven = isDetailedDecisionRequestSafe(message);
  const singleFocusedCar = getSingleFocusedCar(effectiveProfile, message);
  if (structured && Array.isArray(structured.cars) && structured.cars.length) {
    const cars = sanitizeRecommendationCars(structured.cars, effectiveProfile, message, 3);
    const nextSteps = uniqueStrings([
      ...sanitizeRecommendationTextList(structured.next_steps, cars),
      ...buildRecommendationNextStepsSafe(cars, effectiveProfile, message),
      singleFocusedCar && cars[0] ? `继续确认 ${cars[0].name} 的版本、续航和智驾差异` : "",
    ]).slice(0, 4);
    const followups = uniqueStrings([
      ...sanitizeRecommendationTextList(structured.followups, cars),
      ...(singleFocusedCar
        ? [
            cars[0] ? `继续分析 ${cars[0].name} 哪个版本更值` : "",
            cars[0] ? `帮我对比 ${cars[0].name} 不同版本怎么选` : "",
            cars[0] ? `约 ${cars[0].name} 本周试驾` : "",
          ]
        : buildRecommendationFollowupsSafe(cars, effectiveProfile)),
    ]).slice(0, 4);
    return {
      ...structured,
      cars: singleFocusedCar ? cars.slice(0, 1) : cars,
      compare_note:
        comparisonDriven && cars.length >= 2
          ? cars
              .slice(0, 3)
              .map((car) => `${car.name} 更适合${String(car.bestFor || "").replace(/^更适合/, "")}`)
              .join("；")
          : cars[0] && singleFocusedCar
            ? `这次先围绕 ${cars[0].name} 单车型展开，重点看定位、适合人群、核心优势和需要注意的取舍。`
          : structured.compare_note,
      next_steps: nextSteps,
      followups,
    };
  }
  const rawSnippet = String(rawText || "").slice(0, 180);
  return {
    intro: rawSnippet && !rawSnippet.startsWith("{")
      ? rawSnippet
      : "我先给你一版可继续收窄的初筛推荐，具体以品牌官网和门店信息为准。",
    cars: sanitizeRecommendationCars(
      buildFallbackRecommendationCandidates(effectiveProfile, message, 3),
      effectiveProfile,
      message,
      3
    ).map((car) => ({
      brand: car.brand,
      name: car.name,
      image: car.image,
      price: car.price,
      range: car.range,
      smart: car.smart,
      reasons: car.reasons,
      tradeoffs: car.tradeoffs,
    })),
    compare_note: "建议进一步补充预算、城市和补能条件。",
    final_one_liner: "你继续补充约束条件，我可以继续把范围收窄。",
    followups: [
      "我预算 20 万左右，主要城市通勤",
      "我人在广州，家里不能装桩",
      "继续比较其中两款",
    ],
  };
}

function ensureRecommendationStructuredV2(structured, rawText, profile = {}, message = "") {
  const effectiveProfile = buildDisplayProfile(profile, message, rawText);
  const comparisonDriven = isDetailedDecisionRequestSafe(message);
  const singleFocusedCar = getSingleFocusedCar(effectiveProfile, message);
  const externalCarLabel = extractExternalCarLabel(message);
  if (structured && Array.isArray(structured.cars) && structured.cars.length) {
    const cars = sanitizeRecommendationCars(structured.cars, effectiveProfile, message, 3);
    const fallbackCars = sanitizeRecommendationCars(
      buildRankedCatalog(effectiveProfile || {}, message),
      effectiveProfile,
      message,
      3
    );
    const displayCars = cars.length ? cars : fallbackCars;
    const nextSteps = uniqueStrings([
      ...sanitizeRecommendationTextList(structured.next_steps, displayCars),
      ...buildRecommendationNextStepsSafe(displayCars, effectiveProfile, message),
      singleFocusedCar && displayCars[0] ? `继续确认 ${displayCars[0].name} 的版本、续航和智驾差异` : "",
    ]).slice(0, 4);
    const followups = uniqueStrings([
      ...sanitizeRecommendationTextList(structured.followups, displayCars),
      ...(singleFocusedCar
        ? [
            displayCars[0] ? `继续分析 ${displayCars[0].name} 哪个版本更值` : "",
            displayCars[0] ? `帮我比较 ${displayCars[0].name} 不同版本怎么选` : "",
            displayCars[0] ? `约 ${displayCars[0].name} 本周试驾` : "",
          ]
        : buildRecommendationFollowupsSafe(displayCars, effectiveProfile)),
    ]).slice(0, 4);
    const compareNote = externalCarLabel
      ? `如果你重点在看 ${externalCarLabel}，建议把预算、空间、智能化和补能便利性一起看；它的最新价格、配置和交付信息请以对应品牌官方发布为准，我这边继续给你收敛到可直接试驾的小鹏候选。`
      : comparisonDriven && displayCars.length >= 2
        ? displayCars
            .slice(0, 3)
            .map((car) => `${car.name} 更适合${String(car.bestFor || "").replace(/^更适合/, "")}`)
            .join("；")
        : displayCars[0] && singleFocusedCar
          ? `这次先围绕 ${displayCars[0].name} 单车型展开，重点看定位、适合人群、核心优势和需要留意的取舍。`
          : structured.compare_note;

    return {
      ...structured,
      intro: externalCarLabel
        ? `目前 ${externalCarLabel} 不在小鹏车型目录里，我先给你一个简要判断，再把话题拉回到更接近它定位的小鹏车型。`
        : structured.intro,
      cars: singleFocusedCar ? displayCars.slice(0, 1) : displayCars,
      compare_note: compareNote,
      next_steps: nextSteps,
      final_one_liner: externalCarLabel
        ? `如果你想继续往下聊，我建议直接拿 ${externalCarLabel} 去对照 G6、G7 或 G9 的预算带和智能化取向。`
        : structured.final_one_liner,
      followups: externalCarLabel
        ? uniqueStrings([
            `把 ${externalCarLabel} 和 G6 放在一起看落地价与续航`,
            `如果更看重城区智能化，继续比较 G7 和 ${externalCarLabel}`,
            `告诉我你的预算和是否能装家充，我帮你缩到 1-2 台小鹏`,
            ...followups,
          ]).slice(0, 4)
        : followups,
    };
  }

  const rawSnippet = String(rawText || "").slice(0, 180);
  return {
    intro: externalCarLabel
      ? `目前 ${externalCarLabel} 不在小鹏车型目录里，我先给你一个简要判断，再把话题拉回到更接近它定位的小鹏车型。`
      : rawSnippet && !rawSnippet.startsWith("{")
        ? rawSnippet
        : "我先给你一版可继续收窄的初筛建议，具体以品牌官网和门店信息为准。",
    cars: sanitizeRecommendationCars(
      buildFallbackRecommendationCandidates(effectiveProfile, message, 3),
      effectiveProfile,
      message,
      3
    ).map((car) => ({
      brand: car.brand,
      name: car.name,
      image: car.image,
      price: car.price,
      range: car.range,
      smart: car.smart,
      reasons: car.reasons,
      tradeoffs: car.tradeoffs,
    })),
    compare_note: externalCarLabel
      ? `如果你愿意，我可以继续按 ${externalCarLabel} 的预算带、空间取向和智能化预期，把小鹏候选收敛到 1-2 台。`
      : "建议进一步补充预算、城市和补能条件。",
    final_one_liner: externalCarLabel
      ? `如果你想继续往下聊，我建议直接拿 ${externalCarLabel} 去对照 G6、G7 或 G9 的预算带和智能化取向。`
      : "你继续补充约束条件，我可以继续把范围收窄。",
    followups: externalCarLabel
      ? [
          `把 ${externalCarLabel} 和 G6 放在一起看落地价与续航`,
          `如果更看重城区智能化，继续比较 G7 和 ${externalCarLabel}`,
          "告诉我你的预算和是否能装家充，我帮你缩到 1-2 台小鹏",
        ]
      : [
          "我的预算 20 万左右，主要城市通勤",
          "我人在广州，家里不能装桩",
          "继续比较其中两款",
        ],
  };
}

function conciseList(items, max = 2) {
  return uniqueStrings(items || []).slice(0, max);
}

function joinAsSentence(items, fallback = "") {
  const list = conciseList(items, 2);
  if (!list.length) return fallback;
  return list.join("，");
}

function renderReply(mode, structured, rawText) {
  if (mode === "recommendation" && structured) {
    const lines = [];
    const headline = structured.final_one_liner || structured.intro;
    if (headline) lines.push(headline, "");

    if (Array.isArray(structured.cars)) {
      for (const car of structured.cars.slice(0, 2)) {
        const title = [car.brand, car.name].filter(Boolean).join(" ") || car.name || "车型";
        const meta = [car.price ? `价格 ${car.price}` : "", car.range ? `续航 ${car.range}` : ""]
          .filter(Boolean)
          .join(" | ");

        lines.push(`**${title}**${car.fitScore ? `（匹配度 ${car.fitScore}%）` : ""}`);
        if (meta) lines.push(meta);
        if (car.smart) lines.push(`智能化：${car.smart}`);
        if (car.bestFor) lines.push(`更适合：${car.bestFor}`);

        const reasonsSummary = joinAsSentence(car.reasons);
        if (reasonsSummary) lines.push(`推荐理由：${reasonsSummary}`);

        const tradeoffSummary = joinAsSentence(car.tradeoffs);
        if (tradeoffSummary) lines.push(`需要留意：${tradeoffSummary}`);

        lines.push("");
      }
    }

    if (structured.compare_note) lines.push(`补充建议：${structured.compare_note}`, "");

    if (Array.isArray(structured.next_steps) && structured.next_steps.length) {
      lines.push("下一步建议：");
      conciseList(structured.next_steps, 2).forEach((item, index) =>
        lines.push(`${index + 1}. ${item}`)
      );
    }
    return lines.join("\n").trim() || rawText;
  }

  if (mode === "comparison" && structured) {
    const lines = [];
    if (structured.conclusion) {
      lines.push(structured.conclusion, "");
    } else if (structured.intro) {
      lines.push(structured.intro, "");
    }

    if (Array.isArray(structured.dimensions) && structured.dimensions.length) {
      lines.push("**重点差异**");
      for (const dimension of structured.dimensions.slice(0, 4)) {
        lines.push(`- **${dimension.label}**：A — ${dimension.a || "—"}；B — ${dimension.b || "—"}`);
      }
      lines.push("");
    }
    if (Array.isArray(structured.next_steps) && structured.next_steps.length) {
      lines.push("**下一步建议**");
      conciseList(structured.next_steps, 2).forEach((item, index) => lines.push(`${index + 1}. ${item}`));
    }
    return lines.join("\n").trim() || rawText;
  }

  if (mode === "service" && structured) {
    const lines = [];
    if (structured.title) lines.push(`**${structured.title}**`);
    if (structured.diagnosis) lines.push(structured.diagnosis, "");
    if (Array.isArray(structured.steps) && structured.steps.length) {
      lines.push("**处理建议**");
      structured.steps.slice(0, 3).forEach((step, index) => lines.push(`${index + 1}. ${step}`));
      lines.push("");
    }
    if (Array.isArray(structured.notes) && structured.notes.length) {
      lines.push("**注意事项**");
      conciseList(structured.notes, 3).forEach((note) => lines.push(`- ${note}`));
      lines.push("");
    }
    if (Array.isArray(structured.when_to_escalate) && structured.when_to_escalate.length) {
      lines.push("**建议尽快联系官方/到店的情况**");
      conciseList(structured.when_to_escalate, 2).forEach((item) => lines.push(`- ${item}`));
      lines.push("");
    }
    if (Array.isArray(structured.next_steps) && structured.next_steps.length) {
      lines.push("**下一步建议**");
      conciseList(structured.next_steps, 2).forEach((item, index) => lines.push(`${index + 1}. ${item}`));
      lines.push("");
    }
    if (structured.closing) lines.push(structured.closing);
    return lines.join("\n").trim() || rawText;
  }

  return rawText;
}

async function synthesizeAnswer({
  client,
  model,
  temperature,
  mode,
  message,
  session,
  plan,
  toolResults,
  stageCode,
  routingPolicy,
  onStep,
}) {
  if (stageCode === "handoff" || routingPolicy?.escalation?.needed) {
    const structured = attachFollowups(
      buildEscalationStructured(message, routingPolicy),
      buildFollowups(mode, session, plan, toolResults)
    );
    return {
      structured,
      reply: renderReply(mode, structured, "当前问题需要人工升级"),
      source: "local",
    };
  }

  const localStructured = buildLocalStructured(mode, session, message, plan, toolResults);
  const fallbackStructured =
    mode === "recommendation"
      ? { ...buildScopedRecommendationFallback(toolResults, session, message), ...localStructured }
      : mode === "comparison"
        ? { ...fallbackComparisonStructured(toolResults, message), ...localStructured }
        : { ...fallbackServiceStructured(plan, toolResults), ...localStructured };
  let fallbackWithFollowups = attachFollowups(
    fallbackStructured,
    buildFollowups(mode, session, plan, toolResults)
  );
  if (mode === "recommendation") {
    fallbackWithFollowups = ensureRecommendationStructuredV2(
      fallbackWithFollowups,
      "",
      session.profile,
      message
    );
  }

  if (!client || !model) {
    return {
      structured: fallbackWithFollowups,
      reply: renderReply(mode, fallbackWithFollowups, "当前为本地兜底模式。"),
      source: "local",
    };
  }

  try {
    const focusedCars = getFocusedMentionedCars(session.profile, message).map((car) => car.name).filter(Boolean);
    emitAgentStep(onStep, {
      type: "think",
      thought:
        focusedCars.length === 1
          ? `已拿到 ${focusedCars[0]} 的关键信息，正在组织正式答复`
          : "已拿到本轮所需信息，正在组织正式答复",
    });
    const completion = await withTimeout(
      client.chat.completions.create({
        model,
        temperature,
        max_tokens: 4096,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              systemPromptForMode(mode),
              "",
              "你正在商业化汽车顾问 Agent 运行时中工作。",
              "你必须优先依据工具结果和记忆画像回答。",
              "未知的事实要明确说不知道，不要编造价格、门店、权益、库存、配置和政策。",
              "不要泄露内部推理，只输出最终 JSON。",
            ].join("\n"),
          },
          {
            role: "user",
            content: [
              "<user_input>",
              message,
              "</user_input>",
              "<memory_profile>",
              JSON.stringify(session.profile || {}),
              "</memory_profile>",
              "<long_term_profile>",
              JSON.stringify(compactProfile(session.userProfile || {})),
              "</long_term_profile>",
              "<long_term_summary>",
              session.userMemorySummary || "",
              "</long_term_summary>",
              "<memory_summary>",
              session.memorySummary || "",
              "</memory_summary>",
              "<task_memory>",
              JSON.stringify(compactTaskMemory(session.taskMemory)),
              "</task_memory>",
              "<plan>",
              JSON.stringify({
                goal: plan.userGoal,
                safetyNotes: plan.safetyNotes,
              }),
              "</plan>",
              "<tool_results>",
              JSON.stringify(toolResults.map(formatToolResultForPrompt)),
              "</tool_results>",
              "<recent_messages>",
              JSON.stringify(recentMessagesForTurn(session.messages, mode, message, session.profile || {})),
              "</recent_messages>",
            ].join("\n"),
          },
        ],
      }),
      LLM_SYNTHESIS_TIMEOUT_MS,
      "answer_synthesis"
    );

    const raw = completion.choices[0]?.message?.content?.trim() || "{}";
    const parsedStructured = safeParseJson(raw);
    const hasParsedStructured = Boolean(parsedStructured);
    let structured = parsedStructured;
    if (!structured) {
      structured =
        mode === "recommendation"
          ? buildScopedRecommendationFallback(toolResults, session, message)
          : mode === "comparison"
            ? fallbackComparisonStructured(toolResults, message)
            : fallbackServiceStructured(plan, toolResults);
    }

    if (mode === "recommendation") {
      structured = ensureRecommendationStructuredV2(
        hasParsedStructured
          ? { ...localStructured, ...structured }
          : { ...structured, ...localStructured },
        raw,
        session.profile,
        message
      );
    }
    if (mode === "comparison" || mode === "service") {
      structured = hasParsedStructured
        ? { ...localStructured, ...structured }
        : { ...structured, ...localStructured };
    }

    structured = attachFollowups(structured, buildFollowups(mode, session, plan, toolResults));

    return {
      structured,
      reply: renderReply(mode, structured, raw),
      source: "llm",
    };
  } catch {
    return {
      structured: fallbackWithFollowups,
      reply: renderReply(mode, fallbackWithFollowups, "服务暂时繁忙，请稍后重试。"),
      source: "local",
    };
  }
}

function summarizePublicAgentContext(profile, message) {
  const currentTurnProfile = compactProfile(extractProfileFromTextSafe(message, catalogBrands()));
  const focusedCars = getFocusedMentionedCars(currentTurnProfile, message).map((car) => car.name).filter(Boolean);
  const currentBudget = currentTurnProfile?.budget || extractBudgetSnippet(message);
  const currentCity = currentTurnProfile?.city || extractCitySnippetSafe(message);
  const parts = [];

  if (focusedCars.length === 1) {
    parts.push(`识别到你这轮重点在 ${focusedCars[0]}`);
  } else if (focusedCars.length > 1) {
    parts.push(`识别到你提到了 ${focusedCars.join("、")}`);
  }

  if (currentBudget) parts.push(`预算线索：${currentBudget}`);
  if (currentCity) parts.push(`城市：${currentCity}`);

  const hasScenarioHint = Boolean(
    (currentTurnProfile?.usage || []).length ||
      (currentTurnProfile?.bodyTypes || []).length ||
      (currentTurnProfile?.priorities || []).length
  );
  if (!currentBudget && !currentCity && !hasScenarioHint) {
    parts.push("这轮没有给出明确的预算、城市或车型线索，先按当前问题本身展开");
  }

  return parts.join("；");
}

function describePublicModeStep(mode, profile, message) {
  const publicProfile = compactProfile(extractProfileFromTextSafe(message, catalogBrands()));
  if (mode === "recommendation") {
    if (isSingleCarDeepDiveRequest(publicProfile, message)) {
      const focusedCar = getFocusedMentionedCars(publicProfile, message)[0];
      return `已按单车型讲解处理，先围绕 ${focusedCar?.name || "当前车型"} 整理亮点、适合人群和取舍`;
    }
    return "已按车型推荐处理，开始筛选更匹配的候选";
  }
  if (mode === "comparison") return "已按车型对比处理，开始整理关键差异";
  if (mode === "service") return "已按用车服务处理，开始检索相关知识和步骤";
  return `已识别为 ${mode} 任务，开始准备所需数据`;
}

function describePublicToolAction(toolName, profile, message) {
  const publicProfile = compactProfile(extractProfileFromTextSafe(message, catalogBrands()));
  const focusedCars = getFocusedMentionedCars(publicProfile, message).map((car) => car.name).filter(Boolean);

  if (toolName === "recall_memory") return "正在检查当前会话里是否已有可复用线索";
  if (toolName === "search_catalog") {
    if (focusedCars.length === 1) return `正在读取 ${focusedCars[0]} 的车型资料、版本和亮点`;
    if (focusedCars.length > 1) return `正在读取 ${focusedCars.join("、")} 的车型资料和差异`;
    return "正在筛选符合条件的车型资料";
  }
  if (toolName === "compare_catalog") {
    return focusedCars.length ? `正在拉取 ${focusedCars.join("、")} 的对比信息` : "正在拉取车型对比信息";
  }
  if (toolName === "find_stores") return "正在匹配离你更近的门店";
  if (toolName === "search_service_knowledge") return "正在检索相关服务知识和处理方案";
  return `正在调用 ${toolName}`;
}

function describePublicToolObservation(toolName, result, profile, message) {
  const publicProfile = compactProfile(extractProfileFromTextSafe(message, catalogBrands()));
  const focusedCars = getFocusedMentionedCars(publicProfile, message).map((car) => car.name).filter(Boolean);

  if (toolName === "search_catalog") {
    if (focusedCars.length === 1) return `已检索到 ${focusedCars[0]} 的相关资料，正在核对关键信息`;
    return "已检索到可参考的车型资料，正在判断哪些信息与当前问题最相关";
  }
  if (toolName === "compare_catalog") {
    if (focusedCars.length >= 2) {
      return `已拿到 ${focusedCars.slice(0, 2).join(" 和 ")} 的对比资料，正在整理差异点`;
    }
    return "已检索到可参考的对比资料，正在核对是否匹配当前问题";
  }
  if (toolName === "find_stores") {
    const names = Array.isArray(result?.data) ? result.data.map((store) => store?.name).filter(Boolean).slice(0, 2) : [];
    if (names.length === 0 && result?.summary) return result.summary;
    return names.length ? `已匹配到门店：${names.join("、")}` : "已完成门店匹配";
  }
  if (toolName === "search_service_knowledge") {
    const titles = Array.isArray(result?.data) ? result.data.map((item) => item?.title).filter(Boolean).slice(0, 2) : [];
    return titles.length ? `已命中服务知识：${titles.join("、")}` : "已检索到相关服务知识";
  }
  if (toolName === "recall_memory") return "已读取当前会话里已有的条件线索";
  return result?.summary || `${toolName} 已完成`;
}

async function runAgentTurn({
  client,
  model,
  temperature,
  session,
  message,
  forcedMode,
  storesPayload,
  onStep,
  suppressCompletionStep = false,
}) {
  const turnStartedAt = Date.now();
  session.lastActiveAt = new Date().toISOString();
  const brands = uniqueStrings(getCars().map((car) => car.brand));
  session.userProfile = compactProfile(session.userProfile || {});
  session.userMemorySummary =
    session.userMemorySummary || buildMemorySummarySafe(session.userProfile || {});
  session.taskMemory = compactTaskMemory(session.taskMemory);
  session.profile = mergeProfile(session.userProfile || {}, session.profile || {});
  const effectiveForcedMode = resolveForcedModeForCurrentTurn(forcedMode, message);
  const requestedMode = ALLOWED_MODES.has(effectiveForcedMode) ? effectiveForcedMode : detectIntent(message);
  const heuristicProfile = extractProfileFromTextSafe(message, brands);
  session.profile = mergeProfile(session.profile, heuristicProfile);
  session.memorySummary = buildMemorySummarySafe(session.profile);
  const shouldHydrateTaskContext = /试驾|预约|门店|到店/.test(
    String(message || "")
  ) || hasAdvisorFollowupSignal(message);
  const taskProfileHints = shouldHydrateTaskContext
    ? buildTaskMemoryProfileHints(session.taskMemory)
    : {};
  let turnProfile = mergeProfile(
    buildTurnScopedProfile(session.profile, requestedMode, message),
    taskProfileHints
  );
  let turnMemorySummary = buildMemorySummarySafe(turnProfile);
  let turnSession = {
    ...session,
    profile: turnProfile,
    memorySummary: turnMemorySummary,
  };
  const publicContextSummary = summarizePublicAgentContext(turnProfile, message);
  emitAgentStep(onStep, {
    type: "think",
    thought: publicContextSummary || "正在理解你的需求重点",
  });

  const planningStartedAt = Date.now();
  const plan = await planTurn({
    client,
    model,
    temperature,
    session: turnSession,
    message,
    forcedMode: requestedMode,
    storesPayload,
  });
  const planningDurationMs = Date.now() - planningStartedAt;
  emitAgentStep(onStep, {
    type: "think",
    thought: describePublicModeStep(plan.mode, turnProfile, message),
  });

  session.profile = mergeProfile(session.profile, plan.profileUpdates);
  session.memorySummary = buildMemorySummarySafe(session.profile);
  turnProfile = mergeProfile(
    buildTurnScopedProfile(session.profile, plan.mode, message),
    taskProfileHints
  );
  turnMemorySummary = buildMemorySummarySafe(turnProfile);
  turnSession = {
    ...session,
    profile: turnProfile,
    memorySummary: turnMemorySummary,
  };
  plan.displayGoal = message;
  plan.userGoal = message;
  let stageCode = deriveAgentStageCodeForCommercial({
    mode: plan.mode,
    profile: turnProfile,
    message,
  });
  let routingPolicy = buildRoutingPolicy({
    mode: plan.mode,
    stageCode,
    message,
    profile: turnProfile,
  });
  if (routingPolicy.escalation?.needed) {
    stageCode = routingPolicy.escalation.stageCode;
    routingPolicy = buildRoutingPolicy({
      mode: plan.mode,
      stageCode,
      message,
      profile: turnProfile,
    });
  }

  const toolResults = [];
  for (const toolCall of plan.toolCalls) {
    try {
      emitAgentStep(onStep, {
        type: "act",
        action: describePublicToolAction(toolCall.name, turnProfile, message),
      });
      let result;
      if (toolCall.name === "recall_memory") {
        result = runRecallMemoryTool({ session: turnSession });
      } else if (toolCall.name === "search_catalog") {
        result = runSearchCatalogTool({ message, session: turnSession, args: toolCall.args || {} });
      } else if (toolCall.name === "compare_catalog") {
        result = runCompareCatalogTool({ message, args: toolCall.args || {} });
      } else if (toolCall.name === "find_stores") {
        result = runFindStoresTool({
          session: turnSession,
          storesPayload,
          args: toolCall.args || {},
          message,
        });
      } else if (toolCall.name === "search_service_knowledge") {
        result = await runSearchServiceKnowledgeTool({
          message,
          session: turnSession,
          args: toolCall.args || {},
        });
      }

      if (result) {
        toolResults.push({
          tool: toolCall.name,
          status: "completed",
          summary: result.summary,
          data: result.data,
        });
        emitAgentStep(onStep, {
          type: "observe",
          observation: describePublicToolObservation(toolCall.name, result, turnProfile, message),
        });
      }
    } catch (error) {
      const failureType =
        toolCall.name === "search_service_knowledge"
          ? "retrieval_miss"
          : "tool_timeout";
      const fallback = resolveDeterministicFallback({
        failureType,
        toolName: toolCall.name,
        policy: routingPolicy,
      });
      toolResults.push({
        tool: toolCall.name,
        status: "failed",
        summary: fallback.summary,
        data: null,
      });
      emitAgentStep(onStep, {
        type: "observe",
        observation: fallback.summary || `${toolCall.name} 未完成，已切换兜底方案`,
      });
    }
  }

  const plannedMode = plan.mode;
  const synthesisStartedAt = Date.now();
  const { structured, reply, source } = await synthesizeAnswer({
    client,
    model,
    temperature,
    mode: plannedMode,
    message,
    session: turnSession,
    plan,
    toolResults,
    stageCode,
    routingPolicy,
    onStep,
  });
  const synthesisDurationMs = Date.now() - synthesisStartedAt;
  const totalDurationMs = Date.now() - turnStartedAt;
  if (!suppressCompletionStep) {
    emitAgentStep(onStep, {
      type: "observe",
      observation: "正式答复已整理完成，准备返回页面",
    });
  }

  let mode = plannedMode;
  let finalStructured = structured;
  let finalReply = reply;
  if (shouldRecoverRecommendationTurn(message, mode, finalStructured, finalReply, plannedMode)) {
    const recovered = recoverRecommendationTurn({
      message,
      profile: turnProfile,
      structured: finalStructured,
      reply: finalReply,
      toolResults,
    });
    mode = recovered.mode;
    finalStructured = recovered.structured;
    finalReply = recovered.reply;
    stageCode = deriveAgentStageCodeForCommercial({
      mode,
      profile: turnProfile,
      message,
    });
  }

  session.lastMode = mode;
  session.turns = [...session.turns, {
    at: new Date().toISOString(),
    mode,
    goal: message,
  }].slice(-20);
  session.lastActiveAt = new Date().toISOString();

  const missingInfo = inferMissingInfo(turnProfile, mode, message);
  const nextActions = uniqueStrings([
    ...(plan?.clarify?.needed && plan?.clarify?.question ? [plan.clarify.question] : []),
    ...(finalStructured?.next_steps || []),
    ...(finalStructured?.followups || []),
  ]).slice(0, 4);
  const status = deriveSharedAgentStatus({
    stageCode,
    message,
    nextActions,
    missingInfo,
    clarifyNeeded: Boolean(plan?.clarify?.needed),
    solutionReady: mode === "service",
  });
  session.taskMemory = deriveTaskMemory({
    previousTaskMemory: session.taskMemory,
    profile: turnProfile,
    mode,
    message,
    plan,
    structured: finalStructured,
    status: status.code,
  });
  routingPolicy = buildRoutingPolicy({
    mode,
    stageCode,
    message,
    profile: turnProfile,
    structured: finalStructured,
    nextActions,
  });
  const executionMode =
    source === "llm"
      ? "LLM 增强"
      : client && model
        ? "本地极速兜底"
        : "纯本地模式";
  const trace = [
    ...buildTrace(turnProfile, plan, toolResults),
    {
      type: "memory",
      status: "completed",
      title: "更新任务记忆",
      detail:
        session.taskMemory?.focusedCar && session.taskMemory?.activeTaskType
          ? `${session.taskMemory.activeTaskType} / ${session.taskMemory.focusedCar}`
          : session.taskMemory?.activeTaskType || "已刷新当前任务状态",
    },
    {
      type: "plan",
      status: "completed",
      title: source === "llm" ? "生成最终方案" : "切换本地兜底",
      detail:
        source === "llm"
          ? "已用 LLM 对结构化结果进行了最终组织和表达。"
          : "为保证稳定响应，当前答案使用本地规则与知识底座生成。",
    },
  ].slice(0, 7);

  session.messages = trimSessionMessages(
    [
      ...(Array.isArray(session.messages) ? session.messages : []),
      { role: "user", content: message, mode },
      { role: "assistant", content: finalReply, mode },
    ],
    24
  );

  return {
    reply: finalReply,
    mode,
    structured: finalStructured,
    agent: buildAgentPayload({
      stageCode,
      confidence: buildAgentConfidence(turnProfile, mode, toolResults),
      status: status.code,
      statusLabel: status.label,
      statusReason: status.reason,
      executionMode,
      responseSource: source,
      goal: message,
      memorySummary: turnMemorySummary,
      profile: compactProfile(turnProfile),
      missingInfo,
      blockers: status.code === "waiting_user" ? missingInfo : [],
      checklist: buildMissionChecklist(turnProfile, mode, message, finalStructured),
      nextActions,
      toolCalls: toolResults.map((item) => item.tool),
      toolsUsed: toolResults.map((item) => item.tool),
      timingMs: {
        planning: planningDurationMs,
        synthesis: synthesisDurationMs,
        total: totalDurationMs,
      },
      trace,
      transition: routingPolicy.transition,
      routing: {
        requiredDataSource: routingPolicy.requiredDataSource,
        allowedTools: routingPolicy.allowedTools,
        preferredTools: routingPolicy.preferredTools,
        escalation: routingPolicy.escalation,
      },
      fallback: routingPolicy.deterministicFallbacks,
    }),
  };
}

module.exports = {
  createSessionState,
  trimSessionMessages,
  runAgentTurn,
};
