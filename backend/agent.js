const {
  recommendationPrompt,
  comparisonPrompt,
  servicePrompt,
} = require("./prompts");
const { readCatalogPayload } = require("./businessData");

function getCars() {
  return readCatalogPayload().items;
}

function hasGenericCarMention(message) {
  return /(?:[a-z]{1,6}\s*\d+(?:\+|i)?|[\u4e00-\u9fa5]{1,6}\s*[a-z]{1,6}\s*\d+(?:\+|i)?)/i.test(
    String(message || "")
  );
}

function hasSingleCarExplainIntent(message) {
  return /(讲讲|说说|介绍|详解|详细讲|仔细讲|分析|优缺点|版本|配置|怎么样|如何|值不值得|值得买吗)/.test(
    String(message || "")
  );
}

/**
 * @param {string} message
 * @returns {'recommendation'|'comparison'|'service'}
 */
function detectIntent(message) {
  const m = String(message || "").trim();
  if (!m) return "service";
  const lower = m.toLowerCase();
  const comparisonIntentSafe =
    /\bvs\b|\u5bf9\u6bd4|\u6bd4\u8f83|pk|\u8fd8\u662f|\u54ea\u4e2a\u597d|\u9009\u54ea|\u5dee\u522b|\u533a\u522b/i.test(lower) ||
    /(\u548c|\u8ddf|\u4e0e).*(\u6bd4|\u5bf9\u6bd4|\u6bd4\u8f83|\u600e\u4e48\u9009|\u5982\u4f55\u9009|\u7ea0\u7ed3)/.test(m) ||
    ((/\bvs\b|\u548c|\u8ddf|\u4e0e|\u5bf9\u6bd4|\u6bd4\u8f83|pk/i.test(m) &&
      /[A-Za-z0-9\u4e00-\u9fa5]+/.test(m)) &&
      /(\u600e\u4e48\u9009|\u63a8\u8350|\u66f4\u9002\u5408)/.test(m));
  if (comparisonIntentSafe) {
    return "comparison";
  }
  const hasKnownCarMention =
    /\b(?:g6|g7|g9|x9|p7\+?|p7i|m[o0]3|mona\s*m[o0]3)\b/i.test(lower) ||
    /G6|G7|G9|X9|P7\+|P7i|M03|MONA\s*M03/.test(m);
  if ((hasKnownCarMention || hasGenericCarMention(m)) && hasSingleCarExplainIntent(m)) {
    return "recommendation";
  }
  if (
    /\u63a8\u8350|\u4e70\u8f66|\u9009\u8f66|\u8d2d\u8f66|\u9884\u7b97|\u9002\u5408\u6211|\u5e2e\u6211\u9009|\u503c\u5f97\u4e70|\u8f66\u578b|\u901a\u52e4|\u5bb6\u7528|SUV|\u8f7f\u8f66|MPV/i.test(m)
  ) {
    return "recommendation";
  }
  const hasTwoCarsSafe =
    /\bvs\b|和|跟|与|对比|比较|pk/i.test(m) &&
    /[A-Za-z0-9\u4e00-\u9fa5]+/.test(m);
  if (
    /\bvs\b|对比|比较|pk|还是|哪个好|选哪|差别|区别/i.test(lower) ||
    /(和|跟|与).*(比|对比|比较|怎么选|如何选|纠结)/.test(m) ||
    (hasTwoCarsSafe && /(怎么选|推荐|更适合)/.test(m))
  ) {
    return "comparison";
  }
  if (
    /推荐|买车|选车|购车|预算|适合我|帮我选|值得买|车型|通勤|家用|SUV|轿车|MPV/i.test(m)
  ) {
    return "recommendation";
  }
  const hasTwoCars = /和|跟|vs|VS/.test(m);
  if (
    /\bvs\b|对比|比较|pk|还是|哪个好|选哪个|差别|区别/.test(lower) ||
    /和.+比|跟.+比|怎么选|如何选|纠结/.test(m) ||
    (hasTwoCars && /选|推荐|更适合/.test(m))
  ) {
    return "comparison";
  }
  if (
    /推荐|买车|选车|购车|预算|适合我|帮我选|值得买|车型/.test(m)
  ) {
    return "recommendation";
  }
  return "service";
}

function systemPromptForMode(mode) {
  const cars = getCars();
  if (mode === "recommendation") return recommendationPrompt(cars);
  if (mode === "comparison") return comparisonPrompt(cars);
  return servicePrompt();
}

function safeParseJson(text) {
  const raw = String(text || "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

module.exports = {
  getCars,
  detectIntent,
  systemPromptForMode,
  safeParseJson,
};
