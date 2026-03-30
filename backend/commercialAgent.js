const {
  detectIntent,
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
const LLM_TIMEOUT_MS = Math.max(1000, Number(process.env.LLM_TIMEOUT_MS || 30000));
const ENABLE_LLM_PLANNER = process.env.AGENT_USE_LLM_PLANNER === "true";

function createSessionState() {
  const now = new Date().toISOString();
  return {
    createdAt: now,
    lastActiveAt: now,
    messages: [],
    profile: {},
    memorySummary: "",
    lastMode: "service",
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
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function uniqueStrings(list) {
  return [...new Set((Array.isArray(list) ? list : []).map((item) => String(item || "").trim()).filter(Boolean))];
}

function pickFirstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function parseBudgetText(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const matches = [...raw.matchAll(/(\d+(?:\.\d+)?)\s*(?:万|w)/gi)].map((m) => Number(m[1]));
  if (!matches.length) return null;
  if (/(以内|以下|不超过|最多|封顶)/.test(raw)) {
    return { minWan: null, maxWan: Math.max(...matches), raw };
  }
  if (/(以上|起步|起码|至少)/.test(raw)) {
    return { minWan: Math.min(...matches), maxWan: null, raw };
  }
  return {
    minWan: matches.length >= 2 ? Math.min(...matches) : null,
    maxWan: Math.max(...matches),
    raw,
  };
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

function parseBudgetTextSafe(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const matches = [...raw.matchAll(/(\d+(?:\.\d+)?)\s*(?:\u4e07|w)/gi)].map((m) => Number(m[1]));
  if (!matches.length) return null;
  if (/(\u4ee5\u5185|\u5185|\u4ee5\u4e0b|\u4e0d\u8d85\u8fc7|\u6700\u591a|\u5c01\u9876)/.test(raw)) {
    return { minWan: null, maxWan: Math.max(...matches), raw };
  }
  if (/(\u4ee5\u4e0a|\u8d77\u6b65|\u8d77\u7801|\u81f3\u5c11)/.test(raw)) {
    return { minWan: Math.min(...matches), maxWan: null, raw };
  }
  return {
    minWan: matches.length >= 2 ? Math.min(...matches) : null,
    maxWan: Math.max(...matches),
    raw,
  };
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
  const budget = text.match(/(\d+(?:\.\d+)?\s*(?:\u4e07|w)(?:\s*(?:\u4ee5\u5185|\u5185|\u4ee5\u4e0b|\u4ee5\u4e0a|\u5de6\u53f3|\u4e0a\u4e0b|\u8d77))?)/i);
  const city = text.match(/(?:\u5728|\u53bb|\u4f4f\u5728|\u4eba\u5728|\u5b9a\u4f4d\u5230|\u6211\u662f)([\u4e00-\u9fa5]{2,6})(?:\u5e02|\u533a|\u53bf)?/u);
  if (budget) profile.budget = budget[1].trim();
  if (city) profile.city = city[1];
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

function extractProfileFromText(message, brands) {
  const text = String(message || "");
  const lower = text.toLowerCase();
  const profile = {};

  const budget = text.match(/(\d+(?:\.\d+)?\s*(?:万|w)(?:\s*(?:到|-\s*|~|左右|以内|以下|以上|起))?[^，。；\n]*)/i);
  if (budget) profile.budget = budget[1].trim();

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

function findMentionedCars(text) {
  const normalized = normalizeText(text);
  return getCars().filter((car) => {
    const label = normalizeText(`${car.brand || ""}${car.name || ""}`);
    const name = normalizeText(car.name);
    return (label && normalized.includes(label)) || (name && normalized.includes(name));
  });
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

function selectRecommendationCandidates(rankedCars, profile, message, limit = 3) {
  const normalizedLimit = Math.max(2, Math.min(4, Number(limit) || 3));
  const xpengCars = rankedCars.filter((car) => car.brand === "小鹏");
  const lockedBrand = userLockedBrand(profile, message);
  if (lockedBrand === "小鹏") {
    return xpengCars.slice(0, normalizedLimit);
  }

  return xpengCars.slice(0, normalizedLimit);
}

function runSearchCatalogTool({ message, session, args }) {
  const profile = mergeProfile(session.profile, compactProfile(args.profile || {}));
  const limit = Math.max(2, Math.min(4, Number(args.limit) || 3));
  const ranked = selectRecommendationCandidates(buildRankedCatalog(profile, message), profile, message, limit);

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
  const query = normalizeText(name);
  if (!query) return null;
  let best = null;
  let bestScore = -1;
  for (const car of getCars()) {
    const label = normalizeText(`${car.brand || ""}${car.name || ""}`);
    const carName = normalizeText(car.name);
    let score = 0;
    if (label === query || carName === query) score += 5;
    if (query.includes(label) || label.includes(query)) score += 3;
    if (query.includes(carName) || carName.includes(query)) score += 2;
    if (score > bestScore) {
      best = car;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : null;
}

function runFindStoresTool({ session, storesPayload, args }) {
  const list = Array.isArray(storesPayload?.stores) ? storesPayload.stores : [];
  const brand = pickFirstString(
    args.brand,
    session.profile.preferredBrands?.[0],
    session.profile.mentionedCars?.map((item) => matchCarByName(item)?.brand).find(Boolean)
  );
  const city = pickFirstString(args.city, session.profile.city);
  const filtered = list.filter((store) => {
    if (brand && store.brand !== brand) return false;
    if (city) {
      const blob = `${store.city || ""}${store.province || ""}${store.address || ""}`;
      if (!blob.includes(city)) return false;
    }
    return true;
  });
  const limit = Math.max(1, Math.min(5, Number(args.limit) || 3));
  const stores = filtered.slice(0, limit);
  return {
    data: stores,
    summary: stores.length
      ? `门店候选：${stores.map((store) => store.name).join("、")}`
      : "当前条件下没有筛到门店",
  };
}

function runRecallMemoryTool({ session }) {
  return {
    data: {
      profile: session.profile,
      memorySummary: session.memorySummary,
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
    if (!profile.budget) base.push("我预算 20 万内，人在广州，主要城市通勤");
    if (!profile.city) base.push("我人在上海，家里不能装桩，偶尔长途");
    base.push("把小鹏 G6 和小鹏 G9 做个详细对比");
    base.push("我更看重智驾和座舱体验，继续缩小范围");
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
    city: pickFirstString(raw.city),
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
  const mode = ALLOWED_MODES.has(forcedMode) ? forcedMode : detectIntent(message);
  const toolCalls = [{ name: "recall_memory", args: {} }];
  if (mode === "recommendation") toolCalls.push({ name: "search_catalog", args: { limit: 3 } });
  if (mode === "comparison") {
    toolCalls.push({
      name: "compare_catalog",
      args: { carNames: findMentionedCars(message).map((car) => normalizeCarLabel(car)) },
    });
  }
  if (/门店|试驾|到店|城市/.test(message)) toolCalls.push({ name: "find_stores", args: { limit: 3 } });
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
  const fallback = buildPolicyBackedFallbackPlan({ message, forcedMode, session });
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
              forcedMode || "",
              "</forced_mode>",
              "<memory_profile>",
              JSON.stringify(session.profile || {}),
              "</memory_profile>",
              "<memory_summary>",
              session.memorySummary || "",
              "</memory_summary>",
              "<recent_messages>",
              JSON.stringify(recentMessagesForModel(session.messages)),
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
      LLM_TIMEOUT_MS,
      "planner"
    );
    const raw = completion.choices[0]?.message?.content?.trim() || "{}";
    const parsed = safeParseJson(raw) || {};
    const normalizedPlan = normalizePlan(parsed, fallback.mode);
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
  const missing = [];
  if (mode === "recommendation") {
    if (!profile?.budget) missing.push("预算上限");
    if (!(profile?.usage || []).length) missing.push("主要用车场景");
    if (!profile?.charging) missing.push("是否能装家充");
    if (!profile?.city && /试驾|门店|预约|广州|上海|深圳|北京/.test(message)) missing.push("所在城市");
  } else if (mode === "comparison") {
    if ((profile?.mentionedCars || []).length < 2 && findMentionedCars(message).length < 2) {
      missing.push("另一款待对比车型");
    }
    if (!(profile?.usage || []).length) missing.push("最重要的比较场景");
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

  if (!reasons.length) {
    reasons.push("和你当前输入的预算、场景或智能化诉求存在匹配点");
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
  const searchResult = toolResults.find((item) => item.tool === "search_catalog");
  const rawCandidates = Array.isArray(searchResult?.data) && searchResult.data.length
    ? searchResult.data
    : selectRecommendationCandidates(buildRankedCatalog(profile, message), profile, message, 3);
  const candidates = selectRecommendationCandidates(rawCandidates, profile, message, 3);
  const stores = (toolResults.find((item) => item.tool === "find_stores")?.data || []).slice(0, 2);
  const missingInfo = inferMissingInfo(profile, "recommendation", message);
  const decisionDrivers = buildDecisionDrivers(profile);

  const cars = candidates.map((car) => ({
    brand: car.brand,
    name: car.name,
    price: car.price,
    range: car.range,
    smart: car.smart,
    fitScore: fitScoreToPercent(car.agentScore ?? 0),
    bestFor: (() => {
      if (/SUV/i.test(String(car.bodyType || "")) && (profile?.usage || []).some((item) => /Family|家庭/.test(item))) {
        return "更适合兼顾家庭空间与日常通勤的用户";
      }
      if (/轿车/.test(String(car.bodyType || ""))) {
        return "更适合追求通勤效率和驾驶质感的用户";
      }
      return "更适合作为你当前需求下的重点候选";
    })(),
    reasons: buildCarReasonsLocal(car, profile, message),
    tradeoffs: buildCarTradeoffsLocal(car, profile),
  }));

  const nextSteps = [];
  if (cars.length >= 2) nextSteps.push(`先把 ${cars[0].name} 和 ${cars[1].name} 做一次深度对比`);
  if (stores.length) nextSteps.push(`如果准备线下体验，可优先去 ${stores[0].name}`);
  if (missingInfo.length) nextSteps.push(`继续补充：${missingInfo.join("、")}`);
  nextSteps.push("确定 1-2 台重点候选后，再决定是否预约试驾和询价");

  return {
    intro: missingInfo.length
      ? `我先按你已经给出的条件做第一轮筛选，同时把还缺的信息标出来，方便继续收窄。`
      : `我已经能基于你的预算、城市和用车场景给出一版更接近决策的候选清单。`,
    persona_summary: session.memorySummary || "当前画像还在逐步完善中。",
    decision_drivers: decisionDrivers,
    cars,
    compare_note: cars.length >= 2
      ? `${cars[0].name} 更适合优先做主选参考，${cars[1].name}${cars[1].brand === "小鹏" ? " 也值得作为智能化导向的备选" : " 可作为重要对照项"}。`
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

function fallbackRecommendationStructured(toolResults, memorySummary) {
  const searchResult = toolResults.find((item) => item.tool === "search_catalog");
  const cars = Array.isArray(searchResult?.data) ? searchResult.data : getCars().slice(0, 3);
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
      reasons: [
        `${car.bodyType || "新能源车型"}，和当前需求有一定匹配度`,
        "具体价格、权益和配置请以品牌官网和门店公示为准",
      ],
    })),
    compare_note: "建议从预算、补能条件、智能驾驶和空间诉求四个维度继续缩小范围。",
    final_one_liner: "如果你告诉我预算上限和所在城市，我可以继续把推荐收窄到 2-3 款。",
    followups: [
      "我预算 25 万左右，人在广州",
      "我家里能装桩，主要看城市通勤和周末自驾",
      "把其中两款做详细对比",
    ],
  };
}

function fallbackComparisonStructured(toolResults, message) {
  const compareResult = toolResults.find((item) => item.tool === "compare_catalog");
  const cars = Array.isArray(compareResult?.data) ? compareResult.data : [];
  if (cars.length >= 2) {
    return {
      intro: "我先基于目录里的车型信息给你做一版对比。",
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

function ensureRecommendationStructured(structured, rawText) {
  if (structured && Array.isArray(structured.cars) && structured.cars.length) {
    return structured;
  }
  const rawSnippet = String(rawText || "").slice(0, 180);
  return {
    intro: rawSnippet && !rawSnippet.startsWith("{")
      ? rawSnippet
      : "我先给你一版可继续收窄的初筛推荐，具体以品牌官网和门店信息为准。",
    cars: getCars().slice(0, 3).map((car) => ({
      brand: car.brand,
      name: car.name,
      price: car.price,
      range: car.range,
      smart: car.smart,
      reasons: [
        `${car.bodyType || "新能源车型"}，可作为当前需求的参考样本`,
        "价格、续航和权益可能动态变化，请以下单和官网公示为准",
      ],
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

function renderReply(mode, structured, rawText) {
  if (mode === "recommendation" && structured) {
    const lines = [];
    if (structured.intro) lines.push(structured.intro, "");
    if (structured.persona_summary) lines.push(`**Agent 理解**`, structured.persona_summary, "");
    if (Array.isArray(structured.decision_drivers) && structured.decision_drivers.length) {
      lines.push("**当前判断依据**");
      structured.decision_drivers.forEach((item) => lines.push(`- ${item}`));
      lines.push("");
    }
    if (Array.isArray(structured.cars)) {
      for (const car of structured.cars) {
        const title = [car.brand, car.name].filter(Boolean).join(" ") || car.name || "车型";
        lines.push(`**${title}**${car.fitScore ? `（匹配度 ${car.fitScore}%）` : ""}`);
        if (car.price) lines.push(`- 价格：${car.price}`);
        if (car.range) lines.push(`- 续航：${car.range}`);
        if (car.smart) lines.push(`- 智能化：${car.smart}`);
        if (car.bestFor) lines.push(`- 更适合：${car.bestFor}`);
        if (Array.isArray(car.reasons) && car.reasons.length) {
          lines.push("推荐理由：");
          for (const reason of car.reasons) lines.push(`- ${reason}`);
        }
        if (Array.isArray(car.tradeoffs) && car.tradeoffs.length) {
          lines.push("需要注意：");
          for (const item of car.tradeoffs) lines.push(`- ${item}`);
        }
        lines.push("");
      }
    }
    if (structured.compare_note) lines.push("**对比建议**", structured.compare_note, "");
    if (Array.isArray(structured.missing_info) && structured.missing_info.length) {
      lines.push("**还缺哪些信息**");
      structured.missing_info.forEach((item) => lines.push(`- ${item}`));
      lines.push("");
    }
    if (Array.isArray(structured.next_steps) && structured.next_steps.length) {
      lines.push("**建议下一步**");
      structured.next_steps.forEach((item, index) => lines.push(`${index + 1}. ${item}`));
      lines.push("");
    }
    if (structured.final_one_liner) lines.push("**总结**", structured.final_one_liner);
    return lines.join("\n").trim() || rawText;
  }

  if (mode === "comparison" && structured) {
    const lines = [];
    if (structured.intro) lines.push(structured.intro, "");
    if (Array.isArray(structured.decision_focus) && structured.decision_focus.length) {
      lines.push("**比较重点**");
      structured.decision_focus.forEach((item) => lines.push(`- ${item}`));
      lines.push("");
    }
    if (Array.isArray(structured.dimensions) && structured.dimensions.length) {
      lines.push("**维度对比**");
      for (const dimension of structured.dimensions) {
        lines.push(`- **${dimension.label}**：A — ${dimension.a || "—"}；B — ${dimension.b || "—"}`);
      }
      lines.push("");
    }
    if (Array.isArray(structured.next_steps) && structured.next_steps.length) {
      lines.push("**建议下一步**");
      structured.next_steps.forEach((item, index) => lines.push(`${index + 1}. ${item}`));
      lines.push("");
    }
    if (structured.conclusion) lines.push("**推荐结论**", structured.conclusion);
    return lines.join("\n").trim() || rawText;
  }

  if (mode === "service" && structured) {
    const lines = [];
    if (structured.title) lines.push(`**${structured.title}**`, "");
    if (structured.diagnosis) lines.push(structured.diagnosis, "");
    if (Array.isArray(structured.steps) && structured.steps.length) {
      lines.push("**操作步骤**");
      structured.steps.forEach((step, index) => lines.push(`${index + 1}. ${step}`));
      lines.push("");
    }
    if (Array.isArray(structured.notes) && structured.notes.length) {
      lines.push("**注意事项**");
      structured.notes.forEach((note) => lines.push(`- ${note}`));
      lines.push("");
    }
    if (Array.isArray(structured.when_to_escalate) && structured.when_to_escalate.length) {
      lines.push("**建议尽快联系官方/到店的情况**");
      structured.when_to_escalate.forEach((item) => lines.push(`- ${item}`));
      lines.push("");
    }
    if (Array.isArray(structured.next_steps) && structured.next_steps.length) {
      lines.push("**建议下一步**");
      structured.next_steps.forEach((item, index) => lines.push(`${index + 1}. ${item}`));
      lines.push("");
    }
    if (Array.isArray(structured.citations) && structured.citations.length) {
      lines.push("**参考来源**");
      structured.citations.forEach((citation) => {
        const title = citation?.title || "知识条目";
        const uri = citation?.sourceUri || "local";
        const similarity =
          typeof citation?.similarity === "number" ? `（相似度 ${citation.similarity.toFixed(3)}）` : "";
        lines.push(`- ${title} | ${uri}${similarity}`);
      });
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
      ? { ...fallbackRecommendationStructured(toolResults, session.memorySummary), ...localStructured }
      : mode === "comparison"
        ? { ...fallbackComparisonStructured(toolResults, message), ...localStructured }
        : { ...fallbackServiceStructured(plan, toolResults), ...localStructured };
  const fallbackWithFollowups = attachFollowups(
    fallbackStructured,
    buildFollowups(mode, session, plan, toolResults)
  );

  if (!client || !model) {
    return {
      structured: fallbackWithFollowups,
      reply: renderReply(mode, fallbackWithFollowups, "当前为本地兜底模式。"),
      source: "local",
    };
  }

  try {
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
              "<memory_summary>",
              session.memorySummary || "",
              "</memory_summary>",
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
              JSON.stringify(recentMessagesForModel(session.messages)),
              "</recent_messages>",
            ].join("\n"),
          },
        ],
      }),
      LLM_TIMEOUT_MS,
      "answer_synthesis"
    );

    const raw = completion.choices[0]?.message?.content?.trim() || "{}";
    let structured = safeParseJson(raw);
    if (!structured) {
      structured =
        mode === "recommendation"
          ? fallbackRecommendationStructured(toolResults, session.memorySummary)
          : mode === "comparison"
            ? fallbackComparisonStructured(toolResults, message)
            : fallbackServiceStructured(plan, toolResults);
    }

    if (mode === "recommendation") {
      structured = ensureRecommendationStructured({ ...localStructured, ...structured }, raw);
    }
    if (mode === "comparison" || mode === "service") {
      structured = { ...localStructured, ...structured };
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

async function runAgentTurn({
  client,
  model,
  temperature,
  session,
  message,
  forcedMode,
  storesPayload,
}) {
  const turnStartedAt = Date.now();
  session.lastActiveAt = new Date().toISOString();
  const brands = uniqueStrings(getCars().map((car) => car.brand));
  const heuristicProfile = extractProfileFromTextSafe(message, brands);
  session.profile = mergeProfile(session.profile, heuristicProfile);
  session.memorySummary = buildMemorySummarySafe(session.profile);

  const planningStartedAt = Date.now();
  const plan = await planTurn({
    client,
    model,
    temperature,
    session,
    message,
    forcedMode,
    storesPayload,
  });
  const planningDurationMs = Date.now() - planningStartedAt;

  session.profile = mergeProfile(session.profile, plan.profileUpdates);
  session.memorySummary = buildMemorySummarySafe(session.profile);
  plan.displayGoal = message;
  plan.userGoal = message;
  let stageCode = deriveAgentStageCodeForCommercial({
    mode: plan.mode,
    profile: session.profile,
    message,
  });
  let routingPolicy = buildRoutingPolicy({
    mode: plan.mode,
    stageCode,
    message,
    profile: session.profile,
  });
  if (routingPolicy.escalation?.needed) {
    stageCode = routingPolicy.escalation.stageCode;
    routingPolicy = buildRoutingPolicy({
      mode: plan.mode,
      stageCode,
      message,
      profile: session.profile,
    });
  }

  const toolResults = [];
  for (const toolCall of plan.toolCalls) {
    try {
      let result;
      if (toolCall.name === "recall_memory") {
        result = runRecallMemoryTool({ session });
      } else if (toolCall.name === "search_catalog") {
        result = runSearchCatalogTool({ message, session, args: toolCall.args || {} });
      } else if (toolCall.name === "compare_catalog") {
        result = runCompareCatalogTool({ message, args: toolCall.args || {} });
      } else if (toolCall.name === "find_stores") {
        result = runFindStoresTool({ session, storesPayload, args: toolCall.args || {} });
      } else if (toolCall.name === "search_service_knowledge") {
        result = await runSearchServiceKnowledgeTool({
          message,
          session,
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
    }
  }

  const mode = plan.mode;
  const synthesisStartedAt = Date.now();
  const { structured, reply, source } = await synthesizeAnswer({
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
  });
  const synthesisDurationMs = Date.now() - synthesisStartedAt;
  const totalDurationMs = Date.now() - turnStartedAt;

  session.lastMode = mode;
  session.turns = [...session.turns, {
    at: new Date().toISOString(),
    mode,
    goal: message,
  }].slice(-20);
  session.lastActiveAt = new Date().toISOString();

  const missingInfo = inferMissingInfo(session.profile, mode, message);
  const nextActions = uniqueStrings([
    ...(plan?.clarify?.needed && plan?.clarify?.question ? [plan.clarify.question] : []),
    ...(structured?.next_steps || []),
    ...(structured?.followups || []),
  ]).slice(0, 4);
  const status = deriveSharedAgentStatus({
    stageCode,
    message,
    nextActions,
    missingInfo,
    clarifyNeeded: Boolean(plan?.clarify?.needed),
    solutionReady: mode === "service",
  });
  routingPolicy = buildRoutingPolicy({
    mode,
    stageCode,
    message,
    profile: session.profile,
    structured,
    nextActions,
  });
  const executionMode =
    source === "llm"
      ? "LLM 增强"
      : client && model
        ? "本地极速兜底"
        : "纯本地模式";
  const trace = [
    ...buildTrace(session.profile, plan, toolResults),
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

  return {
    reply,
    mode,
    structured,
    agent: buildAgentPayload({
      stageCode,
      confidence: buildAgentConfidence(session.profile, mode, toolResults),
      status: status.code,
      statusLabel: status.label,
      statusReason: status.reason,
      executionMode,
      responseSource: source,
      goal: message,
      memorySummary: session.memorySummary,
      profile: compactProfile(session.profile),
      missingInfo,
      blockers: status.code === "waiting_user" ? missingInfo : [],
      checklist: buildMissionChecklist(session.profile, mode, message, structured),
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
