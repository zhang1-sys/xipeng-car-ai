/**
 * agentTools.js
 * 从 commercialAgent.js 提取的共享工具函数，供 reactAgent.js 使用
 */
const { searchServiceKnowledgeRuntime } = require("./serviceKnowledge");
const { getCars } = require("./agent");

// ─── 工具函数 ────────────────────────────────────────────────

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

function normalizeText(s) {
  return String(s || "").toLowerCase().replace(/[\s\-_·]/g, "");
}

function normalizeCarLabel(car) {
  if (!car) return "";
  if (typeof car === "string") return car;
  return `${car.brand || ""} ${car.name || ""}`.trim();
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
    if (score > bestScore) { best = car; bestScore = score; }
  }
  return bestScore > 0 ? best : null;
}

function runSearchCatalogTool({ message, session, args }) {
  const query = normalizeText(args.query || message || "");
  const limit = Math.max(1, Math.min(5, Number(args.limit) || 3));
  const profile = session.profile || {};

  // 从 args 中读取显式过滤条件
  const maxBudget = args.maxBudget ? parseFloat(args.maxBudget) : null;
  const minBudget = args.minBudget ? parseFloat(args.minBudget) : null;
  const filterEnergy = args.energyType ? String(args.energyType) : null;
  const filterSeats = args.seats ? parseInt(args.seats, 10) : null;
  const filterBodyType = args.bodyType ? String(args.bodyType) : null;

  const scored = getCars().map((car) => {
    let score = 0;
    const label = normalizeText(`${car.brand}${car.name}`);
    if (query && (label.includes(query) || query.includes(label))) score += 4;

    // 使用结构化 priceMin 字段
    const priceMin = typeof car.priceMin === 'number' ? car.priceMin : (() => {
      const m = String(car.price || "").match(/(\d+(?:\.\d+)?)/);
      return m ? parseFloat(m[1]) : null;
    })();

    // 预算硬过滤
    if (maxBudget !== null && priceMin !== null && priceMin > maxBudget + 2) return { ...car, _score: -99 };
    if (minBudget !== null && priceMin !== null && priceMin < minBudget - 2) return { ...car, _score: -99 };

    // 能源类型硬过滤
    if (filterEnergy && !String(car.energyType || car.bodyType || "").includes(filterEnergy)) return { ...car, _score: -99 };
    // 座位数硬过滤
    if (filterSeats && car.seats && car.seats < filterSeats) return { ...car, _score: -99 };
    // 车型类别硬过滤
    if (filterBodyType && !String(car.bodyType || "").includes(filterBodyType)) return { ...car, _score: -99 };

    // 预算软评分
    if (profile.budget && priceMin !== null) {
      const budgetMatch = String(profile.budget).match(/(\d+(?:\.\d+)?)/);
      if (budgetMatch) {
        const budget = parseFloat(budgetMatch[1]);
        if (priceMin <= budget) score += 3;
        else if (priceMin <= budget + 3) score += 1;
      }
    }

    // 车身类型匹配
    if ((profile.bodyTypes || []).some((t) => String(car.bodyType || "").includes(t))) score += 2;
    // 能源类型匹配
    if ((profile.energyTypes || []).some((t) => String(car.energyType || car.bodyType || "").includes(t))) score += 2;
    // 座位数匹配
    if (profile.seats && car.seats && car.seats >= parseInt(String(profile.seats), 10)) score += 1;

    return { ...car, _score: score };
  });

  const results = scored
    .filter((c) => c._score >= 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, limit)
    .map(({ _score, ...car }) => car);

  return {
    data: results,
    summary: results.length
      ? `找到 ${results.length} 款车型：${results.map((c) => `${c.brand} ${c.name}`).join("、")}`
      : "未找到匹配车型",
  };
}

function runCompareCatalogTool({ message, session, args }) {
  function uniqueStrings(arr) {
    return [...new Set((arr || []).filter(Boolean))];
  }
  function findMentionedCars(msg) {
    return getCars().filter((car) => {
      const label = `${car.brand}${car.name}`;
      return String(msg || "").includes(car.brand) || String(msg || "").includes(car.name) || String(msg || "").includes(label);
    });
  }

  const requested = uniqueStrings([...(args.cars || []), ...findMentionedCars(message).map(normalizeCarLabel)]);
  const matched = requested
    .map((name) => matchCarByName(name))
    .filter(Boolean)
    .slice(0, 3);

  return {
    data: matched,
    summary: matched.length
      ? `对比对象：${matched.map((car) => normalizeCarLabel(car)).join(" vs ")}`
      : "目录中未精确匹配到对比车型",
  };
}

function runFindStoresTool({ session, storesPayload, args }) {
  function pickFirstString(...vals) {
    for (const v of vals) {
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "";
  }

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
      ? `门店候选：${stores.map((s) => s.name).join("、")}`
      : "当前条件下没有筛到门店",
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

// ─── 画像工具 ────────────────────────────────────────────────

function extractProfileFromTextSafe(message, brands) {
  const text = String(message || "");
  const profile = {};

  const budget = text.match(/(\d+(?:\.\d+)?\s*(?:万|w)(?:\s*(?:到|-\s*|~|左右|以内|以下|以上|起))?[^，。；\n]*)/i);
  if (budget) profile.budget = budget[1].trim();

  const city = text.match(/(?:在|去|住在|人在|定位到|我是)([\u4e00-\u9fa5]{2,6})(?:市|区|县)?/u);
  if (city) profile.city = city[1];

  if (/(suv|SUV)/.test(text)) profile.bodyTypes = [...(profile.bodyTypes || []), "SUV"];
  if (/(轿车|轿跑)/.test(text)) profile.bodyTypes = [...(profile.bodyTypes || []), "轿车"];
  if (/(mpv|MPV|六座|七座)/.test(text)) profile.bodyTypes = [...(profile.bodyTypes || []), "MPV"];

  if (/纯电|ev|EV/.test(text)) profile.energyTypes = [...(profile.energyTypes || []), "纯电"];
  if (/增程/.test(text)) profile.energyTypes = [...(profile.energyTypes || []), "增程"];
  if (/插混|混动|phev|PHEV/.test(text)) profile.energyTypes = [...(profile.energyTypes || []), "插混"];

  if (brands) {
    const mentioned = brands.filter((b) => text.includes(b));
    if (mentioned.length) profile.preferredBrands = mentioned;
  }

  return profile;
}

function mergeProfile(base, updates) {
  const merged = { ...base };
  for (const [k, v] of Object.entries(updates)) {
    if (Array.isArray(v)) {
      merged[k] = [...new Set([...(merged[k] || []), ...v])];
    } else if (v !== undefined && v !== null && v !== "") {
      merged[k] = v;
    }
  }
  return merged;
}

function buildMemorySummarySafe(profile) {
  if (!profile || !Object.keys(profile).length) return "";
  const parts = [];
  if (profile.budget) parts.push(`预算 ${profile.budget}`);
  if (profile.city) parts.push(`城市 ${profile.city}`);
  if ((profile.bodyTypes || []).length) parts.push(`偏好车型 ${profile.bodyTypes.join("/")}`);
  if ((profile.energyTypes || []).length) parts.push(`能源偏好 ${profile.energyTypes.join("/")}`);
  if ((profile.preferredBrands || []).length) parts.push(`关注品牌 ${profile.preferredBrands.join("/")}`);
  return parts.join("；");
}

function compactProfile(profile) {
  if (!profile) return {};
  const result = {};
  for (const [k, v] of Object.entries(profile)) {
    if (Array.isArray(v) && v.length === 0) continue;
    if (v === null || v === undefined || v === "") continue;
    result[k] = v;
  }
  return result;
}

module.exports = {
  runRecallMemoryTool,
  runSearchCatalogTool,
  runCompareCatalogTool,
  runFindStoresTool,
  runSearchServiceKnowledgeTool,
  extractProfileFromTextSafe,
  mergeProfile,
  buildMemorySummarySafe,
  compactProfile,
  matchCarByName,
  normalizeCarLabel,
};
