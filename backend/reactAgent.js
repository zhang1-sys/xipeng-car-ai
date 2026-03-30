/**
 * reactAgent.js
 * ReAct (Reason + Act) runtime for streaming/tool-driven turns.
 */

const { detectIntent } = require("./agent");
const {
  runRecallMemoryTool,
  runSearchCatalogTool,
  runCompareCatalogTool,
  runFindStoresTool,
  runSearchServiceKnowledgeTool,
  extractProfileFromTextSafe,
  mergeProfile,
  buildMemorySummarySafe,
  compactProfile,
} = require("./agentTools");
const {
  buildAgentPayload,
  deriveAgentStageCodeForReActMode,
  deriveAgentStatus: deriveSharedAgentStatus,
} = require("./agentRuntimeContract");
const {
  buildRoutingPolicy,
  resolveDeterministicFallback,
} = require("./agentRuntimePolicy");

const MAX_TURNS = 8;
const TOOL_TIMEOUT_MS = 5000;
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 60000;

const TOOLS_SCHEMA = `
可用工具：
1. recall_memory
2. search_catalog
3. compare_catalog
4. find_stores
5. search_service_knowledge
`.trim();

const REACT_SYSTEM_PROMPT = `
你是汽车 C 端 AI Agent。
你必须严格输出 JSON。

格式 A：
{
  "thought": "为什么要调用工具",
  "action": "tool_name",
  "action_input": {}
}

格式 B：
{
  "thought": "为什么现在可以直接回答",
  "final_answer": "给用户的最终回答"
}

原则：
- 先理解用户目标，再决定是否调用工具。
- 不要编造价格、配置、门店、权益、库存、政策。
- 如果信息不足，可以直接要求补充，不要无意义地循环调用工具。
- 优先使用工具结果组织回答。

${TOOLS_SCHEMA}
`.trim();

async function executeTool(toolName, toolArgs, { session, storesPayload, message, policy }) {
  const ctx = { session, storesPayload, message, args: toolArgs || {} };
  if (policy && !policy.allowedTools.includes(toolName)) {
    const blocked = resolveDeterministicFallback({
      failureType: "policy_blocked",
      toolName,
      policy,
    });
    throw new Error(`业务边界拦截: ${blocked.summary}`);
  }

  switch (toolName) {
    case "recall_memory":
      return runRecallMemoryTool(ctx);
    case "search_catalog":
      return runSearchCatalogTool(ctx);
    case "compare_catalog":
      return runCompareCatalogTool(ctx);
    case "find_stores":
      return runFindStoresTool(ctx);
    case "search_service_knowledge":
      return runSearchServiceKnowledgeTool(ctx);
    default:
      return { data: null, summary: `未知工具: ${toolName}` };
  }
}

function safeParseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {}
  const match = String(text).match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch (_) {}
  }
  return null;
}

function updateSessionProfile(session, message) {
  const extracted = extractProfileFromTextSafe(message);
  if (!Object.keys(extracted).length) return;
  session.profile = mergeProfile(session.profile || {}, extracted);
  session.memorySummary = buildMemorySummarySafe(session.profile);
}

function deriveOutput(toolResults) {
  if (toolResults.compare_catalog) {
    const rows = Array.isArray(toolResults.compare_catalog) ? toolResults.compare_catalog : [];
    return {
      mode: "comparison",
      structured: { dimensions: rows, comparison: rows },
    };
  }

  if (toolResults.search_catalog) {
    const cars = Array.isArray(toolResults.search_catalog) ? toolResults.search_catalog : [];
    return {
      mode: "recommendation",
      structured: { cars, next_steps: [] },
    };
  }

  if (toolResults.find_stores) {
    return {
      mode: "store",
      structured: { stores: toolResults.find_stores },
    };
  }

  if (toolResults.search_service_knowledge) {
    const items = Array.isArray(toolResults.search_service_knowledge)
      ? toolResults.search_service_knowledge
      : [];
    return {
      mode: "service",
      structured: { steps: items, knowledge: items },
    };
  }

  return { mode: "general", structured: null };
}

function uniqueStrings(list) {
  return [...new Set((Array.isArray(list) ? list : []).filter(Boolean).map((item) => String(item)))];
}

function buildChecklist(mode, structured) {
  if (mode === "recommendation") {
    return [
      { label: "识别预算和场景", done: true },
      { label: "给出候选车型", done: Array.isArray(structured?.cars) && structured.cars.length > 0 },
      { label: "生成下一步动作", done: Array.isArray(structured?.next_steps) && structured.next_steps.length > 0 },
    ];
  }
  if (mode === "comparison") {
    return [
      { label: "识别对比对象", done: true },
      { label: "输出对比维度", done: Array.isArray(structured?.dimensions) && structured.dimensions.length > 0 },
      { label: "引导后续动作", done: true },
    ];
  }
  if (mode === "service") {
    return [
      { label: "识别服务问题", done: true },
      { label: "输出处理步骤", done: Array.isArray(structured?.steps) && structured.steps.length > 0 },
      { label: "给出升级或下一步建议", done: true },
    ];
  }
  if (mode === "store") {
    return [
      { label: "识别到店意图", done: true },
      { label: "返回门店候选", done: Array.isArray(structured?.stores) && structured.stores.length > 0 },
      { label: "推进试驾或联系动作", done: true },
    ];
  }
  return [
    { label: "澄清问题类型", done: true },
    { label: "补齐关键信息", done: false },
    { label: "进入明确业务路径", done: false },
  ];
}

function buildNextActions(mode, structured) {
  const explicit = uniqueStrings([
    ...(structured?.next_steps || []),
    ...(structured?.followups || []),
  ]);
  if (explicit.length) return explicit.slice(0, 4);

  if (mode === "recommendation") {
    return ["继续补充预算和城市", "把两款重点车型做详细对比", "进入配置方案"];
  }
  if (mode === "comparison") {
    return ["告诉我更偏家用还是通勤", "从两款里选一台进入配置器", "继续推进试驾"];
  }
  if (mode === "service") {
    return ["补充故障或服务场景", "需要时转门店或官方售后", "继续查询相关服务知识"];
  }
  if (mode === "store") {
    return ["告诉我所在城市", "继续预约试驾", "让我帮你筛选最近门店"];
  }
  return ["补充预算、城市或车型偏好", "告诉我你现在是购车前还是车主服务阶段"];
}

function buildAgentTrace(trace) {
  return trace
    .map((item) => {
      if (item.action) {
        return {
          type: "tool",
          status: "completed",
          title: `调用工具 ${item.action}`,
          detail: item.thought || "ReAct tool call",
        };
      }
      if (item.observation) {
        return {
          type: "observation",
          status: "completed",
          title: "接收工具观察结果",
          detail: String(item.observation).slice(0, 180),
        };
      }
      if (item.error) {
        return {
          type: "error",
          status: "failed",
          title: "ReAct 执行异常",
          detail: item.error,
        };
      }
      if (item.thought) {
        return {
          type: "plan",
          status: "completed",
          title: "ReAct 思考",
          detail: item.thought,
        };
      }
      return null;
    })
    .filter(Boolean)
    .slice(0, 8);
}

async function runReActTurn({ client, model, session, message, storesPayload, onStep }) {
  const startTime = Date.now();
  const trace = [];
  const toolResults = {};
  const baseMode = detectIntent(message);
  let routingPolicy = buildRoutingPolicy({
    mode: baseMode,
    stageCode: deriveAgentStageCodeForReActMode(baseMode),
    message,
    profile: session?.profile || {},
  });

  updateSessionProfile(session, message);

  const historyMessages = (session.messages || []).slice(-12).map((item) => ({
    role: item.role,
    content: typeof item.content === "string" ? item.content : JSON.stringify(item.content),
  }));

  const workMessages = [
    { role: "system", content: REACT_SYSTEM_PROMPT },
    ...historyMessages,
    { role: "user", content: message },
  ];

  let finalAnswer = null;
  let lastThought = "";

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    let llmResponse;
    try {
      const completion = await Promise.race([
        client.chat.completions.create({
          model,
          max_tokens: 4096,
          response_format: { type: "json_object" },
          messages: workMessages,
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("LLM timeout")), LLM_TIMEOUT_MS)
        ),
      ]);
      llmResponse = completion.choices[0]?.message?.content?.trim() || "{}";
    } catch (err) {
      trace.push({ turn, error: err.message });
      finalAnswer = "抱歉，AI 响应超时，请稍后再试。";
      break;
    }

    const parsed = safeParseJson(llmResponse);
    if (!parsed) {
      trace.push({ turn, raw: llmResponse, error: "JSON parse failed" });
      finalAnswer = llmResponse;
      break;
    }

    lastThought = parsed.thought || "";
    trace.push({ turn, thought: lastThought, action: parsed.action, final: !!parsed.final_answer });
    if (onStep) onStep({ type: "thought", turn, thought: lastThought });

    if (parsed.final_answer) {
      finalAnswer = parsed.final_answer;
      break;
    }

    if (!parsed.action) {
      finalAnswer = lastThought || "我需要更多信息才能继续给出建议。";
      break;
    }

    let observation;
    try {
      const toolResult = await Promise.race([
        executeTool(parsed.action, parsed.action_input || {}, {
          session,
          storesPayload,
          message,
          policy: routingPolicy,
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("tool timeout")), TOOL_TIMEOUT_MS)
        ),
      ]);
      toolResults[parsed.action] = toolResult.data;
      observation = `工具 ${parsed.action} 执行成功：${toolResult.summary}\n详细数据：${JSON.stringify(toolResult.data)}`;
      if (onStep) onStep({ type: "action", turn, action: parsed.action, result: toolResult.summary });
    } catch (err) {
      const fallback = resolveDeterministicFallback({
        failureType:
          parsed.action === "search_service_knowledge"
            ? "retrieval_miss"
            : String(err?.message || "").includes("业务边界")
              ? "policy_blocked"
              : "tool_timeout",
        toolName: parsed.action,
        policy: routingPolicy,
      });
      observation = `工具 ${parsed.action} 执行失败：${fallback.userHint}`;
      if (onStep) onStep({ type: "error", turn, action: parsed.action, error: err.message });
    }

    trace.push({ turn, observation });
    workMessages.push(
      { role: "assistant", content: llmResponse },
      { role: "user", content: `<observation>\n${observation}\n</observation>\n请继续思考，或给出最终答案。` }
    );
  }

  if (!finalAnswer) {
    workMessages.push({
      role: "user",
      content: '你已经收集了足够信息，请现在给出最终答案，格式为 JSON：{"thought":"...","final_answer":"..."}',
    });
    try {
      const finalCompletion = await client.chat.completions.create({
        model,
        max_tokens: 4096,
        response_format: { type: "json_object" },
        messages: workMessages,
      });
      const raw = finalCompletion.choices[0]?.message?.content?.trim() || "{}";
      const parsed = safeParseJson(raw);
      finalAnswer = parsed?.final_answer || parsed?.thought || "感谢等待，如有其他问题欢迎继续咨询。";
    } catch (_) {
      finalAnswer = "感谢等待，如有其他问题欢迎继续咨询。";
    }
  }

  session.messages = session.messages || [];
  session.messages.push(
    { role: "user", content: message },
    { role: "assistant", content: finalAnswer }
  );

  const { mode, structured } = deriveOutput(toolResults);
  session.lastMode = mode;
  session.turns = [...(session.turns || []), {
    at: new Date().toISOString(),
    mode,
    goal: message,
  }].slice(-20);
  session.lastActiveAt = new Date().toISOString();
  session.profile = compactProfile(session.profile);

  const toolsUsed = uniqueStrings(Object.keys(toolResults));
  const checklist = buildChecklist(mode, structured);
  const nextActions = buildNextActions(mode, structured);
  const completedSteps = checklist.filter((item) => item.done).length;
  const confidence = checklist.length ? Number((completedSteps / checklist.length).toFixed(2)) : 0;
  const totalMs = Date.now() - startTime;
  const missingInfo = mode === "general" ? ["budget_or_city_or_intent"] : [];
  let stageCode = deriveAgentStageCodeForReActMode(mode);

  routingPolicy = buildRoutingPolicy({
    mode,
    stageCode,
    message,
    profile: session?.profile || {},
    structured,
    nextActions,
  });
  if (routingPolicy.escalation?.needed) {
    stageCode = routingPolicy.escalation.stageCode;
    routingPolicy = buildRoutingPolicy({
      mode,
      stageCode,
      message,
      profile: session?.profile || {},
      structured,
      nextActions,
    });
  }

  const status = deriveSharedAgentStatus({
    stageCode,
    message,
    nextActions,
    missingInfo,
    clarifyNeeded: mode === "general",
    solutionReady: mode === "service",
    readyToConvert: mode === "store",
  });

  return {
    reply: finalAnswer,
    mode,
    structured,
    agent: buildAgentPayload({
      stageCode,
      confidence,
      status: status.code,
      statusLabel: status.label,
      statusReason: status.reason,
      executionMode: client && model ? "ReAct + tools" : "Local fallback",
      responseSource: client && model ? "llm" : "local",
      goal: message,
      memorySummary: session.memorySummary || "",
      profile: session.profile,
      missingInfo,
      blockers: mode === "general" ? ["need_more_context"] : [],
      checklist,
      nextActions,
      toolCalls: toolsUsed,
      toolsUsed,
      timingMs: {
        planning: 0,
        synthesis: totalMs,
        total: totalMs,
      },
      trace: buildAgentTrace(trace),
      transition: routingPolicy.transition,
      routing: {
        requiredDataSource: routingPolicy.requiredDataSource,
        allowedTools: routingPolicy.allowedTools,
        preferredTools: routingPolicy.preferredTools,
        escalation: routingPolicy.escalation,
      },
      fallback: routingPolicy.deterministicFallbacks,
    }),
    profile: session.profile,
    memorySummary: session.memorySummary || "",
    meta: {
      engine: "react",
      turns: trace.filter((item) => item.action).length,
      totalMs,
      toolCalls: toolsUsed,
      trace,
    },
  };
}

module.exports = { runReActTurn };
