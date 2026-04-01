const {
  buildAgentPayload: buildRuntimeAgentPayload,
  deriveAgentStageCodeForConfigurator,
} = require("./agentRuntimeContract");
const { buildRoutingPolicy } = require("./agentRuntimePolicy");
const { readConfiguratorPayload } = require("./businessData");

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[()（）\-_/·.,，。:：]/g, "");
}

function sanitizeConfiguratorNote(value) {
  return String(value || "")
    .replace(/^\s*(?:\d+|[一二三四五六七八九十百]+)[.、:：)\]]\s*/u, "")
    .replace(/^\s*[-•·*]+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeConfiguratorNotes(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(sanitizeConfiguratorNote).filter(Boolean))];
}

function createEmptyConfigState() {
  return {
    selectedModel: null,
    selectedVariant: null,
    selectedColor: null,
    selectedInterior: null,
    selectedPackages: [],
    done: false,
  };
}

function getConfiguratorDataset() {
  const payload = readConfiguratorPayload() || {};
  const models = Array.isArray(payload.models) ? payload.models : [];
  const modelMap = {};
  const modelOrder = [];

  for (const item of models) {
    const key = String(item?.key || item?.displayName || "").trim();
    if (!key) continue;
    modelOrder.push(key);
    modelMap[key] = {
      key,
      brand: item?.brand || payload?.meta?.brand || "小鹏",
      displayName: item?.displayName || key,
      source_url: item?.source_url || payload?.meta?.source_url || null,
      fetched_at: item?.fetched_at || payload?.meta?.fetched_at || null,
      version: item?.version || payload?.meta?.version || null,
      variants: Array.isArray(item?.variants) ? item.variants : [],
      colors: Array.isArray(item?.colors) ? item.colors : [],
      interiors: Array.isArray(item?.interiors) ? item.interiors : [],
      packages: Array.isArray(item?.packages) ? item.packages : [],
      notes: sanitizeConfiguratorNotes(item?.notes),
      restrictionNotes: sanitizeConfiguratorNotes(item?.restrictionNotes),
      constraints: item?.constraints || {},
    };
  }

  return {
    meta: payload?.meta || {},
    modelMap,
    modelOrder,
  };
}

function getModelOrder() {
  return getConfiguratorDataset().modelOrder;
}

function getCarConfigs() {
  return getConfiguratorDataset().modelMap;
}

function getCarConfig(modelName) {
  const normalizedModel = normalizeText(modelName);
  const { modelMap, modelOrder } = getConfiguratorDataset();
  const key = modelOrder.find((item) => normalizedModel.includes(normalizeText(item)));
  return key ? modelMap[key] : null;
}

function isOptionAvailableForVariant(option, selectedVariant) {
  const availableVariants = Array.isArray(option?.availableVariants) ? option.availableVariants : [];
  if (!selectedVariant || !availableVariants.length) return true;
  return availableVariants.includes(selectedVariant);
}

function getAvailableColors(config, state) {
  return (config?.colors || []).filter((item) => isOptionAvailableForVariant(item, state?.selectedVariant));
}

function getAvailableInteriors(config, state) {
  const variantFiltered = (config?.interiors || []).filter((item) =>
    isOptionAvailableForVariant(item, state?.selectedVariant)
  );
  const selectedColor = (config?.colors || []).find((item) => item.name === state?.selectedColor);
  const allowedInteriors = Array.isArray(selectedColor?.allowedInteriors) ? selectedColor.allowedInteriors : [];
  if (!allowedInteriors.length) return variantFiltered;
  const allowedSet = new Set(allowedInteriors);
  return variantFiltered.filter((item) => allowedSet.has(item.name));
}

function getAvailablePackages(config, state) {
  return (config?.packages || []).filter((item) => isOptionAvailableForVariant(item, state?.selectedVariant));
}

function findPackage(config, packageName) {
  return (config?.packages || []).find((item) => item.name === packageName) || null;
}

function getConfigCapabilities(config) {
  return {
    hasColors: Boolean(config?.colors?.length),
    hasInteriors: Boolean(config?.interiors?.length),
    hasPackages: Boolean(config?.packages?.length),
  };
}

function noteMentionsAll(line, parts) {
  const normalizedLine = normalizeText(line);
  return parts.every((part) => normalizedLine.includes(normalizeText(part)));
}

function getActiveRestrictionNotes(config, state) {
  if (!config) return [];
  const notes = new Set();
  const restrictionNotes = Array.isArray(config.restrictionNotes) ? config.restrictionNotes : [];

  const selectedColor = (config.colors || []).find((item) => item.name === state.selectedColor);
  if (selectedColor?.allowedInteriors?.length) {
    const matched = restrictionNotes.find((line) => noteMentionsAll(line, [selectedColor.name, ...selectedColor.allowedInteriors]));
    if (matched) notes.add(matched);
  }

  for (const packageName of state.selectedPackages || []) {
    const pack = findPackage(config, packageName);
    for (const conflictName of pack?.conflictsWith || []) {
      const matched = restrictionNotes.find((line) => noteMentionsAll(line, [packageName, conflictName]));
      if (matched) notes.add(matched);
    }
  }

  return sanitizeConfiguratorNotes([...notes]);
}

function enforceStateConstraints(state, config) {
  if (!config) return state;

  const availableColors = getAvailableColors(config, state);
  if (state.selectedColor && !availableColors.some((item) => item.name === state.selectedColor)) {
    state.selectedColor = null;
    state.selectedInterior = null;
  }

  const availableInteriors = getAvailableInteriors(config, state);
  if (state.selectedInterior && !availableInteriors.some((item) => item.name === state.selectedInterior)) {
    state.selectedInterior = null;
  }

  const availablePackageNames = new Set(getAvailablePackages(config, state).map((item) => item.name));
  state.selectedPackages = (state.selectedPackages || []).filter((item) => availablePackageNames.has(item));

  const resolvedPackages = [];
  for (const packageName of state.selectedPackages) {
    const pack = findPackage(config, packageName);
    if (!pack) continue;
    const hasConflict = (pack.conflictsWith || []).some((item) => resolvedPackages.includes(item));
    if (!hasConflict) {
      resolvedPackages.push(packageName);
    }
  }
  state.selectedPackages = resolvedPackages;

  return state;
}

function hasConfiguratorIntent(text) {
  return /配置|选配|版本|颜色|内饰|套件|配置单|帮我选/i.test(String(text || ""));
}

function inferModelFromMessage(message) {
  const text = normalizeText(message);
  const { modelMap, modelOrder } = getConfiguratorDataset();
  const key = modelOrder.find((item) => {
    if (text.includes(normalizeText(item))) return true;
    const displayName = modelMap[item]?.displayName || item;
    return text.includes(normalizeText(displayName));
  });
  return key ? modelMap[key].displayName : null;
}

function findOption(options, message) {
  const normalizedMessage = normalizeText(message);
  return options.find((option) => normalizedMessage.includes(normalizeText(option.name))) || null;
}

function shouldAutoRecommend(message) {
  return /推荐|帮我选|默认|你来定|合适就行|直接给方案/i.test(String(message || ""));
}

function resetDownstreamState(state) {
  state.selectedVariant = null;
  state.selectedColor = null;
  state.selectedInterior = null;
  state.selectedPackages = [];
  state.done = false;
}

function applyStepBack(state, message) {
  const text = String(message || "");
  if (/换一款车型|重新选车型|回到车型/i.test(text)) {
    return createEmptyConfigState();
  }
  if (/换一个版本|重新选版本|回到版本/i.test(text)) {
    return {
      ...state,
      selectedVariant: null,
      selectedColor: null,
      selectedInterior: null,
      selectedPackages: [],
      done: false,
    };
  }
  if (/换外观颜色|换颜色|重新选外观|回到外观/i.test(text)) {
    return {
      ...state,
      selectedColor: null,
      selectedInterior: null,
      selectedPackages: [],
      done: false,
    };
  }
  if (/换内饰颜色|换内饰|重新选内饰|回到内饰/i.test(text)) {
    return {
      ...state,
      selectedInterior: null,
      selectedPackages: [],
      done: false,
    };
  }
  if (/重新选择套件|重选套件|回到套件/i.test(text)) {
    return {
      ...state,
      selectedPackages: [],
      done: false,
    };
  }
  return null;
}

function pickRecommendedVariant(config, message) {
  const text = String(message || "");
  if (/性能|四驱|提速|激烈驾驶/i.test(text)) {
    return config.variants.find((item) => /四驱|performance/i.test(item.name)) || config.variants[0];
  }
  if (/智驾|通勤|长续航|续航/i.test(text)) {
    return (
      config.variants.find((item) => /max|长续航|702|755/i.test(String(item.name || "").toLowerCase())) ||
      config.variants[0]
    );
  }
  return config.variants[0];
}

function pickRecommendedPackages(config, message) {
  const text = String(message || "");
  const availablePackages = getAvailablePackages(config, {});
  const packages = [];
  const smartPack = availablePackages.find((item) => /智驾|智能升级/i.test(item.name));
  const comfortPack = availablePackages.find((item) => /舒享|豪华|座椅|零重力/i.test(item.name));

  if (/智驾|辅助驾驶|通勤/i.test(text) && smartPack) {
    packages.push(smartPack.name);
  }
  if (/家庭|舒适|长途|带娃/i.test(text) && comfortPack) {
    packages.push(comfortPack.name);
  }

  return packages;
}

function updateConfigStateFromMessage(state, message) {
  const nextState = {
    ...state,
    selectedPackages: Array.isArray(state.selectedPackages) ? [...state.selectedPackages] : [],
  };
  const steppedBackState = applyStepBack(nextState, message);
  if (steppedBackState) {
    return steppedBackState;
  }
  const inferredModel = inferModelFromMessage(message);
  if (inferredModel && inferredModel !== nextState.selectedModel) {
    nextState.selectedModel = inferredModel;
    resetDownstreamState(nextState);
  }

  const config = getCarConfig(nextState.selectedModel);
  if (!config) {
    return nextState;
  }

  const variant = findOption(config.variants, message);
  if (variant && variant.name !== nextState.selectedVariant) {
    nextState.selectedVariant = variant.name;
    nextState.selectedColor = null;
    nextState.selectedInterior = null;
    nextState.selectedPackages = [];
    nextState.done = false;
  }

  const color = findOption(getAvailableColors(config, nextState), message);
  if (color) nextState.selectedColor = color.name;

  const interior = findOption(getAvailableInteriors(config, nextState), message);
  if (interior) nextState.selectedInterior = interior.name;

  for (const pack of getAvailablePackages(config, nextState)) {
    if (normalizeText(message).includes(normalizeText(pack.name))) {
      if (/(不要|取消|移除|去掉)/.test(String(message || ""))) {
        nextState.selectedPackages = nextState.selectedPackages.filter((item) => item !== pack.name);
      } else if (!nextState.selectedPackages.includes(pack.name)) {
        nextState.selectedPackages = nextState.selectedPackages.filter(
          (item) => !(pack.conflictsWith || []).includes(item)
        );
        nextState.selectedPackages.push(pack.name);
      }
    }
  }

  if (shouldAutoRecommend(message)) {
    if (!nextState.selectedVariant) nextState.selectedVariant = pickRecommendedVariant(config, message)?.name || null;
    if (!nextState.selectedColor) nextState.selectedColor = getAvailableColors(config, nextState)[0]?.name || null;
    if (!nextState.selectedInterior) {
      nextState.selectedInterior = getAvailableInteriors(config, nextState)[0]?.name || null;
    }
    if (!nextState.selectedPackages.length) nextState.selectedPackages = pickRecommendedPackages(config, message);
  }

  nextState.selectedPackages = [...new Set(nextState.selectedPackages)];
  return enforceStateConstraints(nextState, config);
}

function getConfiguratorStage(configState) {
  if (!configState) return "profiling";
  const config = getCarConfig(configState.selectedModel);
  const capability = getConfigCapabilities(config);
  if (configState.done) return "completed";
  if (configState.selectedPackages?.length) return "package_selection";
  if (capability.hasPackages && (!capability.hasInteriors || configState.selectedInterior)) {
    return "package_selection";
  }
  if (capability.hasInteriors && configState.selectedInterior) return "interior_selection";
  if (configState.selectedColor) return "color_selection";
  if (configState.selectedVariant) return "variant_selection";
  if (configState.selectedModel) return "model_selection";
  return "profiling";
}

function stageLabel(stage) {
  const labels = {
    profiling: "需求确认",
    model_selection: "车型确认",
    variant_selection: "版本选择",
    color_selection: "外观颜色",
    interior_selection: "内饰选择",
    package_selection: "套件选择",
    completed: "配置完成",
  };
  return labels[stage] || "配置中";
}

function buildChecklist(state) {
  const config = getCarConfig(state.selectedModel);
  const capability = getConfigCapabilities(config);
  const hasModel = Boolean(state.selectedModel);
  return [
    { label: "确定车型", done: Boolean(state.selectedModel) },
    { label: "确定版本", done: Boolean(state.selectedVariant) },
    { label: "确定外观颜色", done: hasModel && (!capability.hasColors || Boolean(state.selectedColor)) },
    { label: "确定内饰颜色", done: hasModel && (!capability.hasInteriors || Boolean(state.selectedInterior)) },
    {
      label: "确定选装包",
      done: hasModel && (!capability.hasPackages || Boolean(state.selectedPackages?.length) || Boolean(state.done)),
    },
    { label: "生成配置单", done: Boolean(state.done) },
  ];
}

function formatPrice(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return "待确认";
  return `${value.toFixed(2)} 万元左右`;
}

function calculateEstimatedPrice(state) {
  const config = getCarConfig(state.selectedModel);
  if (!config) return null;

  const variant = config.variants.find((item) => item.name === state.selectedVariant);
  if (!variant) return null;

  const colorPremium = config.colors.find((item) => item.name === state.selectedColor)?.premium || 0;
  const interiorPremium = config.interiors.find((item) => item.name === state.selectedInterior)?.premium || 0;
  const packagePremium = (state.selectedPackages || []).reduce((total, name) => {
    const pack = config.packages.find((item) => item.name === name);
    return total + (pack?.price || 0);
  }, 0);

  return variant.price + colorPremium + interiorPremium + packagePremium;
}

function buildChoices(state) {
  const dataset = getConfiguratorDataset();
  const models = dataset.modelOrder.map((key) => dataset.modelMap[key]);
  const config = getCarConfig(state.selectedModel);
  const availableColors = getAvailableColors(config, state);
  const availableInteriors = getAvailableInteriors(config, state);
  const availablePackages = getAvailablePackages(config, state);
  const activeRestrictionNotes = getActiveRestrictionNotes(config, state);

  return {
    models: models.map((item) => ({
      key: item.key,
      name: item.displayName,
      brand: item.brand || dataset.meta?.brand || "小鹏",
      sourceUrl: item.source_url || dataset.meta?.source_url || null,
      fetchedAt: item.fetched_at || dataset.meta?.fetched_at || null,
      version: item.version || dataset.meta?.version || null,
      variants: Array.isArray(item.variants) ? item.variants.length : 0,
      colors: Array.isArray(item.colors) ? item.colors.length : 0,
      interiors: Array.isArray(item.interiors) ? item.interiors.length : 0,
      packages: Array.isArray(item.packages) ? item.packages.length : 0,
      highlight: item.variants?.[0]?.highlight || null,
      basePrice: item.variants?.[0]?.price ?? null,
    })),
    variants: (config?.variants || []).map((item) => ({
      name: item.name,
      price: item.price ?? null,
      highlight: item.highlight || null,
    })),
    colors: availableColors.map((item) => ({
      name: item.name,
      premium: item.premium ?? 0,
      availableVariants: Array.isArray(item.availableVariants) ? item.availableVariants : undefined,
      allowedInteriors: Array.isArray(item.allowedInteriors) ? item.allowedInteriors : undefined,
    })),
    interiors: availableInteriors.map((item) => ({
      name: item.name,
      premium: item.premium ?? 0,
      availableVariants: Array.isArray(item.availableVariants) ? item.availableVariants : undefined,
    })),
    packages: availablePackages.map((item) => ({
      name: item.name,
      price: item.price ?? 0,
      desc: item.desc || null,
      items: Array.isArray(item.items) ? item.items : undefined,
      availableVariants: Array.isArray(item.availableVariants) ? item.availableVariants : undefined,
      conflictsWith: Array.isArray(item.conflictsWith) ? item.conflictsWith : undefined,
    })),
    notes: config?.notes || [],
    restrictionNotes: config?.restrictionNotes || [],
    activeRestrictionNotes,
  };
}

function buildConfigSummary(state) {
  const config = getCarConfig(state.selectedModel);
  if (!config) return null;

  const estimatedPrice = calculateEstimatedPrice(state);
  const activeRestrictionNotes = getActiveRestrictionNotes(config, state);
  return {
    model: state.selectedModel,
    variant: state.selectedVariant,
    exteriorColor: state.selectedColor,
    interiorColor: state.selectedInterior,
    packages: state.selectedPackages || [],
    notes: config.notes || [],
    restrictionNotes: config.restrictionNotes || [],
    activeRestrictionNotes,
    estimatedPrice: formatPrice(estimatedPrice),
    estimatedPriceNote: "公开网页抓取快照整理，实际价格和配置请以官网、门店和交付中心最新信息为准",
    sourceUrl: config.source_url || null,
    fetchedAt: config.fetched_at || null,
    version: config.version || null,
    summary_text: [
      `已为你整理出一份可继续推进的 ${state.selectedModel} 配置建议：`,
      "",
      `- 车型：${state.selectedModel}`,
      `- 版本：${state.selectedVariant}`,
      `- 外观：${state.selectedColor}`,
      `- 内饰：${state.selectedInterior}`,
      `- 套件：${state.selectedPackages.length ? state.selectedPackages.join("、") : "暂未加装"}`,
      `- 预估价格：${formatPrice(estimatedPrice)}`,
      activeRestrictionNotes.length ? `- 当前限制：${activeRestrictionNotes.join(" / ")}` : null,
      config.source_url ? `- 数据来源：${config.source_url}` : null,
      config.fetched_at ? `- 快照时间：${config.fetched_at}` : null,
      "",
      "如果你愿意，我下一步可以直接帮你推进到试驾预约或门店顾问沟通。",
      "",
      "说明：本配置基于公开网页抓取快照整理，仅用于演示；实际请以官网和门店最新信息为准。",
    ].filter(Boolean).join("\n"),
  };
}

function buildNextPrompt(state, message) {
  const { modelMap } = getConfiguratorDataset();
  const modelOrder = getModelOrder();

  if (!state.selectedModel) {
    const modelOptions = modelOrder.map((item) => modelMap[item].displayName).join("、");
    return {
      reply: `我们先把车型定下来。你现在想优先配置哪一款？可选：${modelOptions}。如果你还没想好，也可以直接告诉我“按预算和场景推荐一款”。`,
      nextActions: modelOrder.slice(0, 4).map((item) => `我想看看 ${modelMap[item].displayName}`),
      missingInfo: ["目标车型"],
    };
  }

  const config = getCarConfig(state.selectedModel);
  if (!config) {
    return {
      reply: "我先没识别到对应的车型配置规则。你可以直接说想配置 G6、G9、X9、MONA M03、G7、P7+ 或全新小鹏 P7。",
      nextActions: modelOrder.slice(0, 4).map((item) => `我想配置 ${modelMap[item].displayName}`),
      missingInfo: ["目标车型"],
    };
  }
  const capability = getConfigCapabilities(config);
  const availableColors = getAvailableColors(config, state);
  const availableInteriors = getAvailableInteriors(config, state);
  const availablePackages = getAvailablePackages(config, state);
  const activeRestrictionNotes = getActiveRestrictionNotes(config, state);

  if (!state.selectedVariant) {
    const recommended = pickRecommendedVariant(config, message);
    const lines = config.variants.map((item) =>
      `- ${item.name}：${formatPrice(item.price)}${item.highlight ? `，${item.highlight}` : ""}`
    );
    return {
      reply: [
        `车型先定为 ${state.selectedModel}。下一步建议把版本定下来。`,
        "",
        ...lines,
        "",
        recommended ? `如果你想让我先给一个默认方案，我会优先推荐「${recommended.name}」。` : null,
        config.source_url ? `本页数据来源：${config.source_url}` : null,
      ].filter(Boolean).join("\n"),
      nextActions: config.variants.slice(0, 3).map((item) => `选 ${item.name}`),
      missingInfo: ["目标版本"],
    };
  }

  if (capability.hasColors && !state.selectedColor) {
    return {
      reply: [
        `版本先定为 ${state.selectedVariant}。接下来选外观颜色。`,
        "",
        ...availableColors.map((item) => `- ${item.name}${item.premium ? `：加价 ${item.premium} 万元左右` : "：标准色"}`),
        "",
        "如果你不纠结，我可以直接先按标准色给你出一版配置单。",
      ].join("\n"),
      nextActions: availableColors.slice(0, 4).map((item) => `外观选 ${item.name}`),
      missingInfo: ["外观颜色"],
    };
  }

  if (capability.hasInteriors && !state.selectedInterior) {
    return {
      reply: [
        `外观先定为 ${state.selectedColor}。下一步我们把内饰颜色定下来。`,
        "",
        ...availableInteriors.map((item) => `- ${item.name}${item.premium ? `：加价 ${item.premium} 万元左右` : ""}`),
        "",
        ...activeRestrictionNotes.map((item) => `- 限制提示：${item}`),
      ].filter(Boolean).join("\n"),
      nextActions: availableInteriors.slice(0, 3).map((item) => `内饰选 ${item.name}`),
      missingInfo: ["内饰颜色"],
    };
  }

  if (capability.hasPackages && !state.selectedPackages.length && !/(先不加装|不加装|不要套件|不选套件)/i.test(String(message || ""))) {
    return {
      reply: [
        `目前这台 ${state.selectedModel} 已经有基础配置了。最后一步建议确认要不要加装套件。`,
        "",
        ...availablePackages.map((item) => `- ${item.name}：${formatPrice(item.price)}${item.desc ? `，${item.desc}` : ""}`),
        "",
        ...activeRestrictionNotes.map((item) => `- 限制提示：${item}`),
        "",
        "如果你想要一版更稳妥的默认方案，我可以直接给你推荐适合当前场景的套件组合。",
      ].filter(Boolean).join("\n"),
      nextActions: [...availablePackages.slice(0, 2).map((item) => `加上 ${item.name}`), "先不加装，直接出配置单"],
      missingInfo: ["套件选择"],
    };
  }

  state.done = true;
  const summary = buildConfigSummary(state);
  return {
    reply: summary?.summary_text || "已完成配置整理。",
    nextActions: ["帮我预约试驾", "帮我找最近门店", "再比较一下别的版本"],
    missingInfo: [],
    configSummary: summary,
  };
}

function shouldCompleteConfig(state, message) {
  const config = getCarConfig(state.selectedModel);
  const capability = getConfigCapabilities(config);
  if (!state.selectedModel || !state.selectedVariant) {
    return false;
  }
  if (capability.hasColors && !state.selectedColor) return false;
  if (capability.hasInteriors && !state.selectedInterior) return false;
  if (/生成配置单|确认配置|就这样|完成配置|出配置单|先这样/i.test(String(message || ""))) {
    return true;
  }
  if (/先不加装|不加装|不要套件|不选套件/i.test(String(message || ""))) {
    return true;
  }
  if (!capability.hasPackages) {
    return true;
  }
  return Boolean(state.selectedPackages?.length);
}

function buildAgentPayload({ state, stage, message, durationMs, nextActions, missingInfo }) {
  const checklist = buildChecklist(state);
  const completedSteps = checklist.filter((item) => item.done).length;
  const confidence = checklist.length ? completedSteps / checklist.length : 0;
  const completed = stage === "completed";
  const stageCode = deriveAgentStageCodeForConfigurator({
    internalStage: stage,
    state,
    completed,
  });
  const routingPolicy = buildRoutingPolicy({
    mode: "configurator",
    stageCode,
    message,
    configState: state,
    nextActions,
  });
  return buildRuntimeAgentPayload({
    stageCode,
    confidence: Number(confidence.toFixed(2)),
    status: completed ? "ready_to_convert" : "waiting_user",
    statusLabel: completed ? "可推进转化" : "等待补齐配置",
    statusReason: completed
      ? "配置单已经具备继续推进到试驾、门店或顾问沟通的条件。"
      : `当前处于${stageLabel(stage)}阶段，还需要继续补齐配置选择。`,
    executionMode: "配置器状态机",
    responseSource: "local",
    goal: message,
    memorySummary: [
      state.selectedModel ? `车型 ${state.selectedModel}` : null,
      state.selectedVariant ? `版本 ${state.selectedVariant}` : null,
      state.selectedColor ? `外观 ${state.selectedColor}` : null,
      state.selectedInterior ? `内饰 ${state.selectedInterior}` : null,
      state.selectedPackages?.length ? `套件 ${state.selectedPackages.join("、")}` : null,
    ].filter(Boolean).join("；"),
    profile: {
      mentionedCars: state.selectedModel ? [state.selectedModel] : [],
    },
    missingInfo,
    blockers: completed ? [] : missingInfo,
    checklist,
    nextActions,
    toolCalls: ["config_snapshot_engine"],
    toolsUsed: ["config_snapshot_engine"],
    timingMs: {
      planning: 0,
      synthesis: durationMs,
      total: durationMs,
    },
    trace: [
      {
        type: "plan",
        status: "completed",
        title: "配置器推进",
        detail: `当前阶段：${stageLabel(stage)}`,
      },
      {
        type: "tool",
        status: "completed",
        title: "公开快照配置数据",
        detail: "按车型、版本、颜色、内饰和套件的公开快照逐步推进配置。",
      },
    ],
    transition: routingPolicy.transition,
    routing: {
      requiredDataSource: routingPolicy.requiredDataSource,
      allowedTools: routingPolicy.allowedTools,
      preferredTools: routingPolicy.preferredTools,
      escalation: routingPolicy.escalation,
    },
    fallback: routingPolicy.deterministicFallbacks,
  });
}

function buildReply(state, message) {
  const stage = getConfiguratorStage(state);
  const next = buildNextPrompt(state, message);
  return {
    stage: state.done ? "completed" : stage,
    reply: next.reply,
    nextActions: next.nextActions || [],
    missingInfo: next.missingInfo || [],
    configSummary: next.configSummary || null,
  };
}

async function runConfiguratorTurn({ message, session }) {
  const startMs = Date.now();
  const modelOrder = getModelOrder();
  const modelMap = getCarConfigs();

  if (!session.configState) {
    session.configState = createEmptyConfigState();
  }

  if (!hasConfiguratorIntent(message) && !session.configState.selectedModel) {
    return {
      reply:
        "可以。我可以按车型、版本、颜色、内饰和套件一步步帮你完成配置。你先告诉我想配置哪一款当前在售/展示的小鹏车型，比如 G6、G9、X9、MONA M03、G7、P7+ 或全新小鹏 P7。",
      mode: "configurator",
      configSummary: null,
      configState: session.configState,
      stage: "profiling",
      config: session.configState,
      choices: buildChoices(session.configState),
      agent: buildAgentPayload({
        state: session.configState,
        stage: "profiling",
        message,
        durationMs: Date.now() - startMs,
        nextActions: modelOrder.slice(0, 4).map((item) => `我想配置 ${modelMap[item].displayName}`),
        missingInfo: ["目标车型"],
      }),
      durationMs: Date.now() - startMs,
    };
  }

  session.configState = updateConfigStateFromMessage(session.configState, message);
  if (shouldCompleteConfig(session.configState, message)) {
    session.configState.done = true;
  }

  const result = buildReply(session.configState, message);
  const durationMs = Date.now() - startMs;
  const finalStage = result.stage || getConfiguratorStage(session.configState);
  const configSummary = result.configSummary || (session.configState.done ? buildConfigSummary(session.configState) : null);
  const agent = buildAgentPayload({
    state: session.configState,
    stage: finalStage,
    message,
    durationMs,
    nextActions: result.nextActions,
    missingInfo: result.missingInfo,
  });

  return {
    reply: configSummary?.summary_text || result.reply,
    mode: "configurator",
    configSummary,
    configState: session.configState,
    stage: finalStage,
    config: configSummary || session.configState,
    choices: buildChoices(session.configState),
    agent,
    durationMs,
  };
}

async function runConfiguratorStream({ message, session, onToken, onDone }) {
  const result = await runConfiguratorTurn({ message, session });
  const chunks = String(result.reply || "").match(/.{1,24}/g) || [String(result.reply || "")];
  for (const chunk of chunks) onToken(chunk);
  onDone({ configSummary: result.configSummary, agent: result.agent });
}

module.exports = {
  runConfiguratorTurn,
  runConfiguratorStream,
  getCarConfig,
  getCarConfigs,
  getConfiguratorStage,
};
