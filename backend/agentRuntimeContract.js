const STAGE_ORDER = [
  "discover",
  "recommend",
  "compare",
  "configure",
  "convert",
  "service",
  "handoff",
];

const STAGE_LABELS = {
  discover: "需求澄清",
  recommend: "候选筛选",
  compare: "车型决策",
  configure: "配置方案",
  convert: "试驾转化",
  service: "车主服务",
  handoff: "人工升级",
};

const STATUS_META = {
  waiting_user: {
    label: "等待补充信息",
    reason: "当前还缺少继续推进任务所需的关键信息，需要用户补充后再继续。",
  },
  profiling: {
    label: "持续收集偏好",
    reason: "当前已经进入业务主路径，但还在继续收窄偏好和执行条件。",
  },
  decision_ready: {
    label: "进入车型决策",
    reason: "候选方案已经收敛，可以继续围绕差异维度推进决策。",
  },
  ready_to_convert: {
    label: "可推进转化",
    reason: "当前信息已经足够推进到试驾、到店、预约或顾问跟进动作。",
  },
  solution_ready: {
    label: "方案已可执行",
    reason: "当前已经形成可执行方案，用户可以按步骤继续处理。",
  },
};

function uniqueStrings(list) {
  return [...new Set((Array.isArray(list) ? list : []).map((item) => String(item || "").trim()).filter(Boolean))];
}

function stageLabelFromCode(stageCode) {
  return STAGE_LABELS[stageCode] || STAGE_LABELS.discover;
}

function normalizeResponseSource(value) {
  const source = String(value || "").toLowerCase();
  return source.includes("llm") ? "llm" : "local";
}

function normalizeChecklist(checklist) {
  return (Array.isArray(checklist) ? checklist : [])
    .map((item) => ({
      label: String(item?.label || "").trim(),
      done: Boolean(item?.done),
    }))
    .filter((item) => item.label);
}

function normalizeTiming(timingMs) {
  return {
    planning: Number(timingMs?.planning || 0),
    synthesis: Number(timingMs?.synthesis || 0),
    total: Number(timingMs?.total || 0),
  };
}

function hasExploratoryRecommendationIntent(text) {
  return /(?:\u63a8\u8350|\u5e2e\u6211\u63a8\u8350|\u51e0\u6b3e|\u54ea\u51e0\u6b3e|\u503c\u5f97|\u91cd\u70b9\u8bd5\u9a7e|\u9002\u5408\u6211|\u5e2e\u6211\u9009|\u9884\u7b97|\u8f66\u578b|\u5de5\u4f5c\u65e5|\u901a\u52e4|\u5468\u672b|\u5bb6\u4eba|\u77ed\u9014|\u51fa\u884c)/u.test(
    String(text || "")
  );
}

function hasExplicitConversionIntent(text) {
  const raw = String(text || "");
  if (hasExploratoryRecommendationIntent(raw)) return false;
  return /(?:(?:\u9884\u7ea6|\u5b89\u6392|\u7ea6|\u60f3|\u51c6\u5907|\u53bb|\u5230\u5e97|\u8054\u7cfb|\u8ddf\u8fdb|\u7559\u8d44|\u56de\u7535).{0,6}(?:\u8bd5\u9a7e|\u95e8\u5e97|\u987e\u95ee)|(?:\u8bd5\u9a7e|\u95e8\u5e97|\u5230\u5e97).{0,6}(?:\u9884\u7ea6|\u5b89\u6392|\u8054\u7cfb|\u8ddf\u8fdb|\u7559\u8d44)|(?:\u8054\u7cfb|\u8ba9|\u5e2e\u6211|\u5b89\u6392|\u8f6c).{0,6}\u987e\u95ee|\u987e\u95ee.{0,6}(?:\u8ddf\u8fdb|\u8054\u7cfb|\u56de\u7535)|(?:\u6700\u8fd1.*\u5e97|\u54ea\u5bb6\u5e97|\u6700\u5feb.*\u8bd5\u9a7e|\u8ddf\u8fdb|\u7559\u8d44|\u8054\u7cfb\u6211|\u56de\u7535))/u.test(
    raw
  );
}

function deriveAgentStageCodeForCommercialLegacy({ mode, profile, message }) {
  const text = String(message || "");
  if (/试驾|到店|门店|预约/.test(text)) return "convert";
  if (/保养|充电|保险|事故|OTA|车机|提车|交付/.test(text) || mode === "service") return "service";
  if ((profile?.mentionedCars || []).length >= 2 || mode === "comparison") return "compare";
  if (profile?.budget || (profile?.usage || []).length || mode === "recommendation") return "recommend";
  return "discover";
}

function deriveAgentStageCodeForCommercial({ mode, profile, message }) {
  const text = String(message || "");
  if (hasExplicitConversionIntent(text)) return "convert";
  if (/淇濆吇|鍏呯數|淇濋櫓|浜嬫晠|OTA|杞︽満|鎻愯溅|浜や粯/.test(text) || mode === "service") return "service";
  if ((profile?.mentionedCars || []).length >= 2 || mode === "comparison") return "compare";
  if (profile?.budget || (profile?.usage || []).length || mode === "recommendation") return "recommend";
  return "discover";
}

function deriveAgentStageCodeForReActMode(mode) {
  const mapping = {
    recommendation: "recommend",
    comparison: "compare",
    configurator: "configure",
    store: "convert",
    service: "service",
    general: "discover",
  };
  return mapping[mode] || "discover";
}

function deriveAgentStageCodeForConfigurator({ internalStage, state, completed }) {
  if (completed || internalStage === "completed" || state?.done) return "convert";
  if (
    state?.selectedModel ||
    state?.selectedVariant ||
    state?.selectedColor ||
    state?.selectedInterior ||
    (state?.selectedPackages || []).length
  ) {
    return "configure";
  }
  return "discover";
}

function deriveAgentStatus({
  stageCode,
  message,
  nextActions,
  missingInfo,
  clarifyNeeded = false,
  solutionReady = false,
  readyToConvert = false,
}) {
  const pendingInfo = uniqueStrings(missingInfo);
  const actionHints = uniqueStrings(nextActions);
  const text = [String(message || ""), ...actionHints].join(" ");
  const hasConversionSignal = readyToConvert || /试驾|到店|门店|预约/.test(text);

  if (stageCode === "handoff") {
    return {
      code: "solution_ready",
      label: "建议人工接管",
      reason: "当前问题需要转人工或线下渠道继续处理，避免错误承诺或风险外溢。",
    };
  }

  if (clarifyNeeded || stageCode === "discover" || pendingInfo.length >= 3) {
    return {
      code: "waiting_user",
      label: STATUS_META.waiting_user.label,
      reason: STATUS_META.waiting_user.reason,
    };
  }

  if (stageCode === "service" || solutionReady) {
    return {
      code: "solution_ready",
      label: STATUS_META.solution_ready.label,
      reason: STATUS_META.solution_ready.reason,
    };
  }

  if (stageCode === "convert" || hasConversionSignal) {
    return {
      code: "ready_to_convert",
      label: STATUS_META.ready_to_convert.label,
      reason: STATUS_META.ready_to_convert.reason,
    };
  }

  if (stageCode === "compare") {
    return {
      code: "decision_ready",
      label: STATUS_META.decision_ready.label,
      reason: STATUS_META.decision_ready.reason,
    };
  }

  return {
    code: "profiling",
    label: STATUS_META.profiling.label,
    reason: STATUS_META.profiling.reason,
  };
}

function buildAgentPayload({
  stageCode,
  confidence,
  status,
  statusLabel,
  statusReason,
  statusContext,
  executionMode,
  responseSource,
  goal,
  memorySummary,
  profile,
  missingInfo,
  blockers,
  checklist,
  nextActions,
  toolCalls,
  toolsUsed,
  timingMs,
  trace,
  transition,
  routing,
  fallback,
}) {
  const normalizedStageCode = STAGE_ORDER.includes(stageCode) ? stageCode : "discover";
  const normalizedChecklist = normalizeChecklist(checklist);
  const normalizedMissingInfo = uniqueStrings(missingInfo);
  const normalizedNextActions = uniqueStrings(nextActions).slice(0, 4);
  const normalizedToolCalls = uniqueStrings([...(toolCalls || []), ...(toolsUsed || [])]);
  const normalizedStatus =
    status
      ? {
          code: status,
          label: statusLabel || STATUS_META[status]?.label || STATUS_META.profiling.label,
          reason: statusReason || STATUS_META[status]?.reason || STATUS_META.profiling.reason,
        }
      : deriveAgentStatus({
          stageCode: normalizedStageCode,
          message: goal,
          nextActions: normalizedNextActions,
          missingInfo: normalizedMissingInfo,
          ...(statusContext || {}),
        });

  const normalizedBlockers = Array.isArray(blockers)
    ? uniqueStrings(blockers)
    : normalizedStatus.code === "waiting_user"
      ? normalizedMissingInfo
      : [];

  return {
    stage: stageLabelFromCode(normalizedStageCode),
    stageCode: normalizedStageCode,
    confidence:
      typeof confidence === "number" && Number.isFinite(confidence)
        ? Number(Math.max(0, Math.min(1, confidence)).toFixed(2))
        : 0,
    status: normalizedStatus.code,
    statusLabel: normalizedStatus.label,
    statusReason: normalizedStatus.reason,
    executionMode: executionMode || "",
    goal: String(goal || ""),
    memorySummary: String(memorySummary || ""),
    profile: profile || {},
    missingInfo: normalizedMissingInfo,
    missing_info: normalizedMissingInfo,
    blockers: normalizedBlockers,
    checklist: normalizedChecklist,
    nextActions: normalizedNextActions,
    nextBestAction: normalizedNextActions[0] || null,
    next_best_action: normalizedNextActions[0] || null,
    responseSource: normalizeResponseSource(responseSource),
    response_source: normalizeResponseSource(responseSource),
    toolCalls: normalizedToolCalls,
    tool_calls: normalizedToolCalls,
    toolsUsed: normalizedToolCalls,
    timingMs: normalizeTiming(timingMs),
    trace: Array.isArray(trace) ? trace.slice(0, 8) : [],
    transition: transition || null,
    routing: routing || null,
    fallback: fallback || null,
  };
}

module.exports = {
  STAGE_ORDER,
  STAGE_LABELS,
  uniqueStrings,
  stageLabelFromCode,
  deriveAgentStageCodeForCommercial,
  deriveAgentStageCodeForReActMode,
  deriveAgentStageCodeForConfigurator,
  deriveAgentStatus,
  buildAgentPayload,
};
