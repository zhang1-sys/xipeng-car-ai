import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const models = [
  { key: "G6", url: "https://www.xiaopeng.com/g6_2026/configuration.html", fallbackName: "\u5c0f\u9e4f G6" },
  { key: "G9", url: "https://www.xiaopeng.com/g9_2026/configuration.html", fallbackName: "\u5c0f\u9e4f G9" },
  { key: "X9", url: "https://www.xiaopeng.com/x9_2026/configuration.html", fallbackName: "\u5c0f\u9e4f X9" },
  { key: "MONA M03", url: "https://www.xiaopeng.com/m03/configuration.html", fallbackName: "\u5c0f\u9e4f MONA M03" },
  { key: "G7", url: "https://www.xiaopeng.com/g7_2026/configuration.html", fallbackName: "\u5c0f\u9e4f G7" },
  { key: "P7+", url: "https://www.xiaopeng.com/p7_plus_2026/configuration.html", fallbackName: "\u5c0f\u9e4f P7+" },
  { key: "P7", url: "https://www.xiaopeng.com/p7n/configuration.html", fallbackName: "\u5168\u65b0\u5c0f\u9e4f P7" },
];

const THEME_SECTION_NAMES = ["\u4e3b\u9898\u9009\u88c5", "\u4e2a\u6027\u5316"];
const PACKAGE_SECTION = "\u9009\u88c5\u5305";
const EXTERIOR_TITLE_REGEX = /\u5916\u89c2|\u5916\u89c2\u989c\u8272|\u8f66\u8eab\u989c\u8272/;
const INTERIOR_TITLE_REGEX = /\u5ea7\u8231|\u5185\u9970|\u5185\u9970\u989c\u8272|\u5185\u9970\u4e3b\u9898/;
const REMARK_LINE = "\u5907\u6ce8\uff1a";
const DISPLAY_RULE_LINE = /\u6807\u51c6\u914d\u7f6e|\u9009\u88c5\u914d\u7f6e|\u65e0\u6b64\u914d\u7f6e/;
const RESTRICTION_NOTE_REGEX = /\u4ec5\u53ef\u9009|\u4e0d\u53ef\u9009|\u53ea\u53ef\u9009\u5176\u4e00|\u642d\u914d\u5173\u7cfb/;
const COLOR_INTERIOR_REGEX = /([^；。]+?)\u5916\u89c2\u8272\u4ec5\u53ef\u9009([^；。]+?)(?:\u5ea7\u8231\u4e3b\u9898|\u5185\u9970\u989c\u8272|\u5185\u9970\u4e3b\u9898)/g;
const EXCLUSIVE_PACKAGE_REGEX = /([^；。]+?)\u4e0e([^；。]+?)\uff0c?\s*\u53ea\u53ef\u9009\u5176\u4e00/g;
const PRICE_REGEX = /\u552e\u4ef7\uff1a(?:[\uffe5¥])?([\d,]+)|[\uffe5¥]([\d,]+)/;

function cleanHtmlText(value) {
  return String(value ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<sup.*?<\/sup>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();
}

function priceToWan(value) {
  const n = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round((n / 10000) * 100) / 100 : null;
}

function getVariantAvailability(variantNames, rowValues = []) {
  return variantNames.filter((_, index) => {
    const value = String(rowValues[index] ?? "");
    return value && value !== "-";
  });
}

function parsePriceFromLabel(label) {
  const match = cleanHtmlText(label).match(PRICE_REGEX);
  return match ? priceToWan(match[1] || match[2]) ?? 0 : 0;
}

function normalizeDisplayName(edition, fallbackName) {
  if (!edition) return fallbackName;
  const normalized = String(edition).replace(/^\d{4}\u6b3e/, "").trim();
  if (!normalized) return fallbackName;
  if (!normalized.includes("\u5c0f\u9e4f") && String(fallbackName || "").includes("\u5c0f\u9e4f")) {
    return fallbackName;
  }
  return normalized;
}

function stripRulePrefix(value) {
  return cleanHtmlText(value).replace(/^\d+[.、]\s*/, "").trim();
}

function stripFootnoteSuffix(value) {
  return String(value || "").replace(/[¹²³⁴⁵⁶⁷⁸⁹⁰]+$/g, "").trim();
}

function normalizeComparableName(value) {
  return stripFootnoteSuffix(stripRulePrefix(value))
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[()（）\-_/·.,，；:：]/g, "");
}

function splitInteriorNames(value) {
  return stripRulePrefix(value)
    .split(/[、,，/]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePriceFromRowValues(rowValues = []) {
  const prices = rowValues
    .map((value) => {
      const match = cleanHtmlText(value).match(PRICE_REGEX);
      return match ? priceToWan(match[1] || match[2]) : null;
    })
    .filter((value) => typeof value === "number");

  if (!prices.length) return 0;
  return Math.max(...prices);
}

function parseThemeSection(section, variantNames) {
  const colors = [];
  const interiors = [];
  let bucket = "";

  for (const row of section?.data ?? []) {
    if (row.extraClass === "mini-title") {
      const title = cleanHtmlText(row.name);
      if (EXTERIOR_TITLE_REGEX.test(title)) {
        bucket = "color";
      } else if (INTERIOR_TITLE_REGEX.test(title)) {
        bucket = "interior";
      } else {
        bucket = "";
      }
      continue;
    }

    const item = {
      name: cleanHtmlText(row.name),
      premium: 0,
      availableVariants: getVariantAvailability(variantNames, row.data),
    };

    if (bucket === "color") colors.push(item);
    if (bucket === "interior") interiors.push(item);
  }

  return { colors, interiors };
}

function parsePackageSection(section, variantNames) {
  const packages = [];
  let current = null;

  for (const row of section?.data ?? []) {
    if (row.extraClass === "mini-title") {
      if (current) packages.push(current);
      const label = cleanHtmlText(row.name);
      current = {
        name: stripFootnoteSuffix(
          label.replace(/（\u552e\u4ef7\uff1a(?:[\uffe5¥])?[\d,]+(?:\u5143)?）/g, "").trim()
        ),
        price: parsePriceFromLabel(label),
        desc: null,
        items: [],
        availableVariants: [],
        conflictsWith: [],
      };
      continue;
    }

    if (!current) continue;

    const line = cleanHtmlText(row.name);
    if (line) current.items.push(line);
    if (!current.price) {
      current.price = parsePriceFromRowValues(row.data);
    }

    for (const variant of getVariantAvailability(variantNames, row.data)) {
      if (!current.availableVariants.includes(variant)) {
        current.availableVariants.push(variant);
      }
    }
  }

  if (current) packages.push(current);

  for (const item of packages) {
    if (item.items.length) {
      item.desc = item.items.join("；");
    }
  }

  return packages;
}

function parseNotesAndConstraints(tips, packages) {
  const notes = cleanHtmlText(tips)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line !== REMARK_LINE)
    .filter((line) => !DISPLAY_RULE_LINE.test(line));

  const restrictionNotes = [];
  const exteriorInterior = [];
  const packageExclusiveGroups = [];
  const packageMap = new Map(packages.map((item) => [normalizeComparableName(item.name), item]));

  for (const line of notes) {
    let matchedRestriction = false;

    for (const colorMatch of line.matchAll(COLOR_INTERIOR_REGEX)) {
      matchedRestriction = true;
      restrictionNotes.push(line);
      exteriorInterior.push({
        color: stripRulePrefix(colorMatch[1]),
        allowedInteriors: splitInteriorNames(colorMatch[2]),
        note: line,
      });
    }

    for (const packageMatch of line.matchAll(EXCLUSIVE_PACKAGE_REGEX)) {
      matchedRestriction = true;
      const leftRaw = stripRulePrefix(packageMatch[1]);
      const rightRaw = stripRulePrefix(packageMatch[2]);
      const left = packageMap.get(normalizeComparableName(leftRaw))?.name || leftRaw;
      const right = packageMap.get(normalizeComparableName(rightRaw))?.name || rightRaw;
      restrictionNotes.push(line);
      packageExclusiveGroups.push([left, right]);
      const leftItem = packageMap.get(normalizeComparableName(left));
      const rightItem = packageMap.get(normalizeComparableName(right));
      if (leftItem && !leftItem.conflictsWith.includes(right)) {
        leftItem.conflictsWith.push(right);
      }
      if (rightItem && !rightItem.conflictsWith.includes(left)) {
        rightItem.conflictsWith.push(left);
      }
    }

    if (!matchedRestriction && RESTRICTION_NOTE_REGEX.test(line)) {
      restrictionNotes.push(line);
    }
  }

  return {
    notes,
    restrictionNotes: [...new Set(restrictionNotes)],
    constraints: {
      exteriorInterior,
      packageExclusiveGroups,
    },
  };
}

async function fetchInitialState(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status}`);
  }
  const html = await res.text();
  const match = html.match(/window\.__INITIAL_STATE__= (.*?);<\/script>/s);
  if (!match) {
    throw new Error(`INITIAL_STATE not found for ${url}`);
  }
  return JSON.parse(match[1]);
}

async function buildModelSnapshot(model) {
  const state = await fetchInitialState(model.url);
  const config = Array.isArray(state.configdata) ? state.configdata[0] : state.configdata;
  if (!config?.carType?.data || !config?.priceConfig?.data) {
    throw new Error(`Unsupported configuration payload for ${model.key}`);
  }
  const variantNames = config.carType.data.map((item) => String(item));
  const themeSection = config.data.find((item) =>
    THEME_SECTION_NAMES.some((sectionName) => String(item.name).includes(sectionName))
  );
  const packageSection = config.data.find((item) => String(item.name).includes(PACKAGE_SECTION));

  const theme = parseThemeSection(themeSection, variantNames);
  const packages = parsePackageSection(packageSection, variantNames);
  const ruleData = parseNotesAndConstraints(config.tips, packages);

  for (const rule of ruleData.constraints.exteriorInterior) {
    const color = theme.colors.find((item) => item.name === rule.color);
    if (color) {
      color.allowedInteriors = [...rule.allowedInteriors];
    }
  }

  return {
    key: model.key,
    brand: "\u5c0f\u9e4f",
    displayName: normalizeDisplayName(config.edition, model.fallbackName),
    source_url: model.url,
    fetched_at: new Date().toISOString(),
    version: new Date().toISOString().slice(0, 10),
    variants: config.carType.data.map((name, index) => ({
      name: String(name),
      price: priceToWan(config.priceConfig.data[index]),
      highlight: null,
    })),
    colors: theme.colors,
    interiors: theme.interiors,
    packages,
    notes: ruleData.notes,
    restrictionNotes: ruleData.restrictionNotes,
    constraints: ruleData.constraints,
  };
}

async function main() {
  const outputPath = path.resolve(process.cwd(), process.argv[2] || "configurator-snapshot.json");
  const snapshot = {
    meta: {
      brand: "\u5c0f\u9e4f",
      version: new Date().toISOString().slice(0, 10),
      fetched_at: new Date().toISOString(),
      source_url: "https://www.xiaopeng.com/",
      disclaimer:
        "\u672c\u6570\u636e\u4e3a\u5b98\u7f51\u516c\u5f00\u53c2\u6570\u914d\u7f6e\u9875\u6293\u53d6\u6574\u7406\u7684\u672c\u5730\u5feb\u7167\uff0c\u7528\u4e8e\u914d\u7f6e\u5668\u6f14\u793a\u3002\u4ef7\u683c\u3001\u914d\u7f6e\u3001\u9650\u5236\u89c4\u5219\u4e0e\u4ea4\u4ed8\u4fe1\u606f\u8bf7\u4ee5\u5c0f\u9e4f\u5b98\u7f51\u548c\u95e8\u5e97\u6700\u65b0\u4fe1\u606f\u4e3a\u51c6\u3002",
    },
    models: [],
  };

  for (const model of models) {
    snapshot.models.push(await buildModelSnapshot(model));
  }

  await fs.writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  console.log(`Wrote ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
