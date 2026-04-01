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
  return /(?:[a-z]{1,6}\s*\d+(?:\+|i)?|[\u4e00-\u9fa5]{1,8}\s*[a-z]{1,6}\s*\d+(?:\+|i)?)/i.test(
    String(message || "")
  );
}

function hasSingleCarExplainIntent(message) {
  return /(?:\u8bb2\u8bb2|\u8bf4\u8bf4|\u4ecb\u7ecd|\u8be6\u89e3|\u8be6\u7ec6\u8bb2|\u4ed4\u7ec6\u8bb2|\u5206\u6790|\u4f18\u7f3a\u70b9|\u7248\u672c|\u914d\u7f6e|\u600e\u4e48\u6837|\u5982\u4f55|\u503c\u4e0d\u503c\u5f97|\u503c\u5f97\u4e70\u5417)/i.test(
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
    /\bvs\b|\u5bf9\u6bd4|\u6bd4\u8f83|pk|\u8fd8\u662f|\u54ea\u4e2a\u597d|\u9009\u54ea|\u5dee\u522b|\u533a\u522b/i.test(
      lower
    ) ||
    /(\u548c|\u8ddf|\u4e0e).*(\u6bd4|\u5bf9\u6bd4|\u6bd4\u8f83|\u600e\u4e48\u9009|\u5982\u4f55\u9009|\u7ea0\u7ed3)/.test(
      m
    ) ||
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
    /\u63a8\u8350|\u4e70\u8f66|\u9009\u8f66|\u8d2d\u8f66|\u9884\u7b97|\u9002\u5408\u6211|\u5e2e\u6211\u9009|\u503c\u5f97\u4e70|\u8f66\u578b|\u901a\u52e4|\u5bb6\u7528|SUV|\u8f7f\u8f66|MPV/i.test(
      m
    )
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
