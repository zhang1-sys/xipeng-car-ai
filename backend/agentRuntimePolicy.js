const SERVICE_RETRIEVAL_RE =
  /保养|充电|续航|家充|补能|OTA|车机|保险|事故|提车|交付|售后|维修|维保|故障|能耗|政策|服务|热线/i;
const CONVERSION_RE = /试驾|到店|门店|预约|顾问|联系销售|热线|回电|留资/i;
const CONFIGURE_RE = /配置|选配|版本|颜色|内饰|套件|选装|配置单/i;
const HIGH_RISK_ESCALATION_RE =
  /事故|高压|起火|冒烟|无法驾驶|故障灯|刹车|失控|安全气囊|严重异响|漏液|碰撞|召回|赔偿|投诉|法律|律师|电池包|电池受损|电池破损|底盘受损|底部磕碰|托底|挤压变形|继续充电|还能不能充电/i;

const FALLBACK_LIBRARY = {
  llm_timeout: {
    title: "LLM 超时 fallback",
    summary: "切换到本地规则与已知业务数据，继续输出可执行结果。",
    userHint: "模型暂时繁忙，当前结果已回退到本地规则与业务数据。",
  },
  tool_timeout: {
    title: "tool timeout fallback",
    summary: "保留当前业务阶段，改用本地兜底或引导用户补充必要信息。",
    userHint: "工具暂时超时，先给出不依赖该工具的下一步建议。",
  },
  retrieval_miss: {
    title: "retrieval miss fallback",
    summary: "未命中服务知识时，不编造答案，改为澄清、升级或引导官方渠道。",
    userHint: "当前没有命中明确服务知识，建议补充车型、城市或问题现象，必要时走官方渠道。",
  },
  structured_data_unavailable: {
    title: "structured data unavailable fallback",
    summary: "结构化真相不可用时，不输出确定性价格、配置、门店承诺，转为澄清或人工升级。",
    userHint: "当前缺少可靠结构化数据，涉及价格、配置、门店时请以官方渠道为准。",
  },
  policy_blocked: {
    title: "policy blocked",
    summary: "工具调用不符合当前业务边界，已被策略层拦截。",
    userHint: "当前问题不应使用该工具，已切换为更稳妥的处理路径。",
  },
};

function uniqueStrings(list) {
  return [...new Set((Array.isArray(list) ? list : []).map((item) => String(item || "").trim()).filter(Boolean))];
}

function hasPattern(pattern, values) {
  return values.some((value) => pattern.test(String(value || "")));
}

function hasConversionIntent(message, nextActions = []) {
  return hasPattern(CONVERSION_RE, [message, ...(nextActions || [])]);
}

function hasEscalationRisk(message) {
  return HIGH_RISK_ESCALATION_RE.test(String(message || ""));
}

function buildRoutingPolicy({ mode, stageCode, message, profile, structured, configState, nextActions }) {
  const normalizedMode = String(mode || "");
  const effectiveStage = String(stageCode || "");
  const text = String(message || "");
  const conversionIntent = hasConversionIntent(text, nextActions);
  const escalationRisk = hasEscalationRisk(text);
  const hasServiceQuery = SERVICE_RETRIEVAL_RE.test(text);
  const hasConfiguratorIntent =
    effectiveStage === "configure" ||
    normalizedMode === "configurator" ||
    CONFIGURE_RE.test(text) ||
    Boolean(configState?.selectedModel);
  const allowedTools = ["recall_memory"];
  const preferredTools = ["recall_memory"];
  let requiredDataSource = "hybrid";
  let escalation = null;

  if (effectiveStage === "service" || normalizedMode === "service" || hasServiceQuery) {
    allowedTools.push("search_service_knowledge", "find_stores");
    preferredTools.push("search_service_knowledge");
    requiredDataSource = "retrieval";
  }

  if (effectiveStage === "recommend" || normalizedMode === "recommendation") {
    allowedTools.push("search_catalog", "find_stores");
    preferredTools.push("search_catalog");
    requiredDataSource = "structured";
  }

  if (effectiveStage === "compare" || normalizedMode === "comparison") {
    allowedTools.push("compare_catalog", "find_stores");
    preferredTools.push("compare_catalog");
    requiredDataSource = "structured";
  }

  if (hasConfiguratorIntent) {
    allowedTools.push("config_state_engine");
    preferredTools.push("config_state_engine");
    requiredDataSource = "structured";
  }

  if (conversionIntent) {
    if (!allowedTools.includes("find_stores")) allowedTools.push("find_stores");
    preferredTools.push("find_stores");
  }

  if (escalationRisk) {
    escalation = {
      needed: true,
      stageCode: "handoff",
      reason: "问题涉及事故、安全、法律或高压等高风险场景，需要优先转官方渠道或人工接管。",
      action: "official_service_or_hotline",
    };
  } else if (normalizedMode === "service" && /门店|热线|售后|人工/.test(text)) {
    escalation = {
      needed: true,
      stageCode: "handoff",
      reason: "用户明确要求线下或人工继续处理，当前应切换到门店或热线引导。",
      action: "store_or_hotline",
    };
  }

  const cars = Array.isArray(structured?.cars) ? structured.cars : [];
  const dimensions = Array.isArray(structured?.dimensions) ? structured.dimensions : [];
  const serviceSteps = Array.isArray(structured?.steps) ? structured.steps : [];
  const configReady =
    Boolean(configState?.done) ||
    Boolean(structured?.summary_text) ||
    Boolean(structured?.estimatedPrice) ||
    Boolean(structured?.model && structured?.variant);

  let nextStageCandidates = [];
  let transitionReady = false;
  let transitionReason = "继续当前阶段收集或执行。";

  if (escalation?.needed) {
    nextStageCandidates = ["handoff"];
    transitionReady = true;
    transitionReason = escalation.reason;
  } else if (effectiveStage === "discover") {
    if (hasConfiguratorIntent) {
      nextStageCandidates = ["configure"];
      transitionReady = true;
      transitionReason = "用户已进入车型、版本或配置表达，可直接进入配置流程。";
    } else if (normalizedMode === "comparison") {
      nextStageCandidates = ["compare"];
      transitionReady = true;
      transitionReason = "用户当前目标明确为车型对比。";
    } else if (normalizedMode === "recommendation") {
      nextStageCandidates = ["recommend"];
      transitionReady = true;
      transitionReason = "用户当前目标明确为购车推荐。";
    } else {
      nextStageCandidates = ["service"];
      transitionReady = true;
      transitionReason = "当前问题更像服务咨询，应进入服务阶段。";
    }
  } else if (effectiveStage === "recommend") {
    if (cars.length >= 2) {
      nextStageCandidates = conversionIntent ? ["compare", "convert"] : ["compare", "configure"];
      transitionReady = true;
      transitionReason = "推荐结果已收敛到可决策候选，可以进入对比或配置。";
    } else if (cars.length === 1) {
      nextStageCandidates = conversionIntent ? ["convert"] : ["configure"];
      transitionReady = true;
      transitionReason = "已有明确主推车型，可以直接进入配置或转化。";
    } else {
      nextStageCandidates = ["recommend"];
      transitionReason = "候选车型仍不足，需要继续收窄推荐。";
    }
  } else if (effectiveStage === "compare") {
    if (dimensions.length > 0) {
      nextStageCandidates = conversionIntent ? ["convert"] : ["configure", "convert"];
      transitionReady = true;
      transitionReason = "对比维度已形成，可以继续配置或推进试驾。";
    } else {
      nextStageCandidates = ["compare"];
      transitionReason = "对比信息仍不足，需要继续补齐车型或决策维度。";
    }
  } else if (effectiveStage === "configure") {
    if (configReady) {
      nextStageCandidates = ["convert"];
      transitionReady = true;
      transitionReason = "配置单已形成，下一步应推进试驾、到店或顾问跟进。";
    } else {
      nextStageCandidates = ["configure"];
      transitionReason = "配置尚未完成，需要继续补齐版本、颜色或套件。";
    }
  } else if (effectiveStage === "service") {
    if (serviceSteps.length > 0) {
      nextStageCandidates = escalation?.needed
        ? ["handoff"]
        : conversionIntent
          ? ["convert", "handoff"]
          : ["service", "handoff"];
      transitionReady = true;
      transitionReason = escalation?.needed
        ? escalation.reason
        : conversionIntent
          ? "服务问题已形成可执行方案，且用户有线下意图，可引导门店或热线。"
          : "服务问题已形成可执行方案，必要时可升级到门店或热线。";
    } else {
      nextStageCandidates = ["service"];
      transitionReason = "服务知识未充分命中，需要继续检索、澄清或升级。";
    }
  } else if (effectiveStage === "convert") {
    nextStageCandidates = escalation?.needed ? ["handoff"] : ["convert", "handoff"];
    transitionReady = true;
    transitionReason = escalation?.needed ? escalation.reason : "当前应继续推进预约、到店或人工承接。";
  } else if (effectiveStage === "handoff") {
    nextStageCandidates = ["handoff"];
    transitionReady = true;
    transitionReason = escalation?.reason || "当前问题需要人工或官方渠道继续处理。";
  }

  return {
    requiredDataSource,
    allowedTools: uniqueStrings(allowedTools),
    preferredTools: uniqueStrings(preferredTools),
    escalation,
    transition: {
      nextStageCandidates,
      ready: transitionReady,
      reason: transitionReason,
    },
    deterministicFallbacks: FALLBACK_LIBRARY,
  };
}

function enforceToolRoutingPolicy({ policy, requestedToolCalls, maxToolCalls = 3 }) {
  const requested = Array.isArray(requestedToolCalls) ? requestedToolCalls : [];
  const allowed = new Set(policy?.allowedTools || []);
  const sanitized = [];

  for (const toolCall of requested) {
    const name = String(toolCall?.name || "").trim();
    if (!name || !allowed.has(name)) continue;
    sanitized.push({
      name,
      args: toolCall?.args && typeof toolCall.args === "object" ? toolCall.args : {},
    });
  }

  for (const preferred of policy?.preferredTools || []) {
    if (!sanitized.some((item) => item.name === preferred)) {
      sanitized.unshift({ name: preferred, args: {} });
    }
  }

  return uniqueStrings(sanitized.map((item) => JSON.stringify(item)))
    .map((item) => JSON.parse(item))
    .slice(0, maxToolCalls);
}

function resolveDeterministicFallback({ failureType, toolName, policy }) {
  const key = FALLBACK_LIBRARY[failureType] ? failureType : "tool_timeout";
  const fallback = FALLBACK_LIBRARY[key];
  const escalationReason = policy?.escalation?.needed ? ` ${policy.escalation.reason}` : "";
  return {
    key,
    title: fallback.title,
    summary: `${fallback.summary}${toolName ? ` 工具=${toolName}。` : ""}${escalationReason}`.trim(),
    userHint: `${fallback.userHint}${escalationReason}`.trim(),
  };
}

module.exports = {
  buildRoutingPolicy,
  enforceToolRoutingPolicy,
  hasConversionIntent,
  hasEscalationRisk,
  resolveDeterministicFallback,
};
