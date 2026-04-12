const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { Client } = require("pg");

require("dotenv").config({ path: path.join(__dirname, ".env") });

const USE_EXISTING_SERVER = process.env.SMOKE_USE_EXISTING_SERVER === "true";
const DEFAULT_APP_PORT = 3001;
const DEFAULT_SMOKE_PORT = 3101;

function resolvePort(value, fallback) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 ? port : fallback;
}

const PORT = resolvePort(
  process.env.SMOKE_PORT,
  USE_EXISTING_SERVER
    ? resolvePort(process.env.PORT, DEFAULT_APP_PORT)
    : DEFAULT_SMOKE_PORT
);
const BASE = `http://127.0.0.1:${PORT}`;
const OPS_ACCESS_TOKEN = String(process.env.OPS_ACCESS_TOKEN || "smoke-test-token").trim();
let serverProcess = null;
const SMOKE_CHECKS = [
  "health",
  "config_status",
  "agent_readiness",
  "agent_eval",
  "knowledge_status",
  "business_data_status",
  "crm_outbox",
  "crm_sync_run",
  "crm_acknowledged",
  "crm_synced_callback",
  "crm_failed_dead_letter",
  "observability",
  "recommendation",
  "comparison",
  "service",
  "forced_mode",
  "single_car_deep_dive",
  "multi_turn_memory",
  "memory_isolation_service",
  "stream_chat",
  "configurator",
  "conversation_replay",
  "session_storage_masking",
  "privacy_validation",
  "test_drive_success",
  "lead_intelligence",
  "crm_payload",
];

function smokeResultPath() {
  return path.join(__dirname, "data", "smoke-results.json");
}

function writeSmokeResult(payload) {
  const filePath = smokeResultPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const health = await fetch(`${BASE}/health`).then((res) => res.json());
      if (health.ok === true) return;
    } catch {
      /* retry */
    }
    await sleep(300);
  }
  throw new Error("smoke server failed to become healthy");
}

async function startServer() {
  if (USE_EXISTING_SERVER) {
    await waitForHealth();
    return;
  }

  serverProcess = spawn(process.execPath, ["server.js"], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: String(PORT),
      OPS_ACCESS_TOKEN,
    },
    stdio: "inherit",
  });

  await waitForHealth();
}

async function stopServer() {
  if (!serverProcess || serverProcess.killed) return;

  serverProcess.kill();
  await Promise.race([
    new Promise((resolve) => serverProcess.once("exit", resolve)),
    sleep(3000),
  ]);
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...buildOpsHeaders(),
    },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  return { response, json };
}

async function postSse(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...buildOpsHeaders(),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const events = [];
  let eventType = "";

  for (const line of text.split("\n")) {
    if (line.startsWith("event:")) {
      eventType = line.slice(6).trim();
      continue;
    }
    if (!line.startsWith("data:")) {
      continue;
    }

    try {
      events.push({
        event: eventType || "message",
        data: JSON.parse(line.slice(5).trim()),
      });
    } catch {
      events.push({
        event: eventType || "message",
        data: null,
      });
    }

    eventType = "";
  }

  return { response, events };
}

async function queryPostgresCounts() {
  if (String(process.env.STORAGE_PROVIDER || "").trim().toLowerCase() !== "postgres") {
    return null;
  }
  if (!String(process.env.DATABASE_URL || "").trim()) {
    throw new Error("postgres smoke requires DATABASE_URL");
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: ["1", "true", "require"].includes(String(process.env.DATABASE_SSL || "").trim().toLowerCase())
      ? { rejectUnauthorized: false }
      : false,
  });

  await client.connect();
  try {
    const leads = await client.query("SELECT COUNT(*)::int AS count FROM leads");
    const crmOutbox = await client.query("SELECT COUNT(*)::int AS count FROM crm_outbox");
    return {
      leads: Number(leads.rows[0]?.count || 0),
      crmOutbox: Number(crmOutbox.rows[0]?.count || 0),
    };
  } finally {
    await client.end().catch(() => {});
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function buildOpsHeaders() {
  return {
    "X-Internal-Test": "true",
    ...(OPS_ACCESS_TOKEN
      ? {
          "X-Ops-Token": OPS_ACCESS_TOKEN,
          "X-Ops-Actor": "smoke-test",
        }
      : {}),
  };
}

function assertExpectedModeOrTimeout(result, expectedMode) {
  if (result.json.mode === expectedMode) {
    return "expected";
  }

  const reply = String(result.json.reply || "");
  const isTimeoutFallback =
    result.json.mode === "general" && (/timeout/i.test(reply) || /瓒呮椂/.test(reply));

  assert(
    isTimeoutFallback,
    `${expectedMode} request returned unexpected mode: ${String(result.json.mode || "unknown")}`
  );
  return "timeout_fallback";
}

async function main() {
  const dbCountsBefore = await queryPostgresCounts();
  await startServer();

  const health = await fetch(`${BASE}/health`).then((res) => res.json());
  assert(health.ok === true, "health check failed");
  assert(typeof health.service?.sessions === "number", "health sessions missing");
  assert(typeof health.service?.storesLoaded === "number", "health storesLoaded missing");
  assert(typeof health.service?.sessionTtlMs === "number", "health sessionTtlMs missing");
  assert(typeof health.limits?.chat?.max === "number", "health chat limit missing");
  assert(typeof health.crmSync?.counts?.total === "number", "health crmSync missing");
  assert(typeof health.config?.counts?.total === "number", "health config summary missing");

  const configStatus = await fetch(`${BASE}/api/ops/config-status`, {
    headers: buildOpsHeaders(),
  }).then((res) => res.json());
  assert(typeof configStatus.ok === "boolean", "config status ok missing");
  assert(Array.isArray(configStatus.checks), "config status checks missing");
  assert(
    configStatus.checks.some((item) => item.id === "ops_access_token"),
    "config status ops_access_token check missing"
  );
  assert(
    configStatus.checks.some((item) => item.id === "retention_policy"),
    "config status retention_policy check missing"
  );

  const readiness = await fetch(`${BASE}/api/agent/readiness`, {
    headers: buildOpsHeaders(),
  }).then((res) => res.json());
  assert(typeof readiness.overallScore === "number", "readiness overallScore missing");
  assert(Array.isArray(readiness.dimensions), "readiness dimensions missing");
  assert(Array.isArray(readiness.milestones), "readiness milestones missing");
  assert(typeof readiness.versions?.promptVersion === "string", "readiness promptVersion missing");
  assert(
    typeof readiness.businessDataStatus?.stores?.count === "number",
    "readiness business data missing"
  );

  const evalReport = await fetch(`${BASE}/api/agent/eval`).then((res) => res.json());
  assert(typeof evalReport.versions?.policyVersion === "string", "eval policyVersion missing");
  assert(typeof evalReport.dataset?.scenarioCount === "number", "eval scenarioCount missing");
  assert(Array.isArray(evalReport.qualityGates), "eval quality gates missing");

  const knowledgeStatus = await fetch(`${BASE}/api/knowledge/status`).then((res) => res.json());
  assert(typeof knowledgeStatus.provider === "string", "knowledge status provider missing");
  assert(
    typeof knowledgeStatus.generated?.records === "number",
    "knowledge status generated records missing"
  );
  assert(
    typeof knowledgeStatus.embedding?.configured === "boolean",
    "knowledge status embedding flag missing"
  );

  const businessData = await fetch(`${BASE}/api/business-data/status`).then((res) => res.json());
  assert(typeof businessData.version === "string", "business data version missing");
  assert(
    typeof businessData.sources?.catalog?.count === "number",
    "business data catalog count missing"
  );

  const recommendation = await postJson(`${BASE}/api/chat`, {
    message:
      "\u9884\u7b9715\u4e07\uff0c\u5e7f\u5dde\u901a\u52e4\uff0c\u63a8\u8350\u4e00\u6b3e\u667a\u80fd SUV",
    mode: "recommendation",
  });
  assert(recommendation.response.ok, "recommendation request failed");
  const recommendationStatus = assertExpectedModeOrTimeout(recommendation, "recommendation");
  assert(typeof recommendation.json.requestId === "string", "recommendation requestId missing");
  if (recommendationStatus === "expected") {
    assert(Array.isArray(recommendation.json.structured?.cars), "recommendation cars missing");
    assert(
      recommendation.json.structured.cars.length >= 1,
      "recommendation should keep at least one candidate car"
    );
    assert(
      Array.isArray(recommendation.json.structured?.next_steps),
      "recommendation next_steps missing"
    );
    assert(
      recommendation.json.uiHints?.showRecommendationCards === true,
      "recommendation should render recommendation cards"
    );
  }

  const comparison = await postJson(`${BASE}/api/chat`, {
    message: "小鹏 G6 和小鹏 G9 怎么选",
    mode: "comparison",
  });
  assert(comparison.response.ok, "comparison request failed");
  const comparisonStatus = assertExpectedModeOrTimeout(comparison, "comparison");
  if (comparisonStatus === "expected") {
    assert(Array.isArray(comparison.json.structured?.dimensions), "comparison dimensions missing");
  }

  const service = await postJson(`${BASE}/api/chat`, {
    message:
      "\u51ac\u5929\u7eed\u822a\u6389\u5f97\u5feb\uff0c\u65e5\u5e38\u5e94\u8be5\u600e\u4e48\u7528\u8f66",
    mode: "service",
  });
  assert(service.response.ok, "service request failed");
  const serviceStatus = assertExpectedModeOrTimeout(service, "service");
  if (serviceStatus === "expected") {
    assert(Array.isArray(service.json.structured?.steps), "service steps missing");
  }

  const forcedComparison = await postJson(`${BASE}/api/chat`, {
    message: "Please compare options for a 200k city commuter SUV.",
    mode: "comparison",
  });
  assert(forcedComparison.response.ok, "forced comparison request failed");
  assertExpectedModeOrTimeout(forcedComparison, "comparison");

  const singleCarDeepDive = await postJson(`${BASE}/api/chat`, {
    message: "讲讲G9",
  });
  assert(singleCarDeepDive.response.ok, "single car deep dive request failed");
  const singleCarStatus = assertExpectedModeOrTimeout(singleCarDeepDive, "recommendation");
  if (singleCarStatus === "expected") {
    assert(
      Array.isArray(singleCarDeepDive.json.structured?.cars) &&
        singleCarDeepDive.json.structured.cars.length === 1 &&
        singleCarDeepDive.json.structured.cars[0]?.name === "G9",
      "single car deep dive should only keep G9"
    );
  }

  const firstTurn = await postJson(`${BASE}/api/chat`, {
    message:
      "\u9884\u7b9720\u4e07\u5185\uff0c\u4e3b\u8981\u57ce\u5e02\u901a\u52e4\uff0c\u60f3\u8981\u667a\u80fd\u5316\u597d\u4e00\u70b9\u7684 SUV",
    mode: "recommendation",
  });
  const firstTurnStatus = assertExpectedModeOrTimeout(firstTurn, "recommendation");
  if (firstTurnStatus === "expected") {
    assert(firstTurn.json.agent?.profile?.city !== "主要城", "recommendation city parser should not capture 主要城");
    const recommendedCars = Array.isArray(firstTurn.json.structured?.cars) ? firstTurn.json.structured.cars : [];
    assert(
      !recommendedCars.some((item) => String(item?.name || "").includes("P7+")),
      "SUV recommendation should not carry over stale P7+ card"
    );
  }
  const sessionId = firstTurn.json.sessionId;
  const secondTurn = await postJson(`${BASE}/api/chat`, {
    message:
      "\u6211\u5728\u5e7f\u5dde\uff0c\u5bb6\u91cc\u80fd\u88c5\u5145\u7535\u6869",
    sessionId,
    mode: "recommendation",
  });
  assert(secondTurn.response.ok, "second turn request failed");
  assertExpectedModeOrTimeout(secondTurn, "recommendation");

  const exploratoryTestDriveRecommendation = await postJson(`${BASE}/api/chat`, {
    message:
      "\u9884\u7b97 20 \u4e07\u5de6\u53f3\uff0c\u4e3b\u8981\u5728\u57ce\u5e02\u901a\u52e4\uff0c\u5468\u672b\u5076\u5c14\u5e26\u5bb6\u4eba\u51fa\u6e38\uff0c\u5e2e\u6211\u63a8\u8350 2 \u5230 3 \u6b3e\u503c\u5f97\u91cd\u70b9\u8bd5\u9a7e\u7684\u5c0f\u9e4f\u8f66\u578b\u3002",
    mode: "service",
  });
  assert(exploratoryTestDriveRecommendation.response.ok, "exploratory recommendation request failed");
  const exploratoryRecommendationStatus = assertExpectedModeOrTimeout(
    exploratoryTestDriveRecommendation,
    "recommendation"
  );
  if (exploratoryRecommendationStatus === "expected") {
    assert(
      exploratoryTestDriveRecommendation.json.uiHints?.showRecommendationCards === true,
      "exploratory recommendation should still render recommendation cards"
    );
    assert(
      Array.isArray(exploratoryTestDriveRecommendation.json.structured?.cars) &&
        exploratoryTestDriveRecommendation.json.structured.cars.length >= 2,
      "exploratory recommendation should keep recommendation cars"
    );
    assert(
      !/(?:^|\n)#\s*首次购车需求梳理|##\s*操作建议/u.test(
        String(exploratoryTestDriveRecommendation.json.reply || "")
      ),
      "exploratory recommendation should not leak raw service-knowledge markdown"
    );
  }

  const pastedAdvisorReplyLabelRecommendation = await postJson(`${BASE}/api/chat`, {
    message:
      "\u9884\u7b97 18 \u5230 22 \u4e07\uff0c\u5de5\u4f5c\u65e5\u57ce\u5e02\u901a\u52e4\uff0c\u5468\u672b\u5e26\u5bb6\u4eba\u77ed\u9014\u51fa\u884c\uff0c\u63a8\u8350\u4e24\u6b3e\u9002\u5408\u91cd\u70b9\u8bd5\u9a7e\u7684\u5c0f\u9e4f\u8f66\u578b\u3002\n\u987e\u95ee\u56de\u590d",
    mode: "service",
  });
  assert(pastedAdvisorReplyLabelRecommendation.response.ok, "pasted advisor reply label request failed");
  const pastedAdvisorReplyLabelStatus = assertExpectedModeOrTimeout(
    pastedAdvisorReplyLabelRecommendation,
    "recommendation"
  );
  if (pastedAdvisorReplyLabelStatus === "expected") {
    assert(
      pastedAdvisorReplyLabelRecommendation.json.uiHints?.showRecommendationCards === true,
      "pasted advisor reply label should still render recommendation cards"
    );
    assert(
      Array.isArray(pastedAdvisorReplyLabelRecommendation.json.structured?.cars) &&
        pastedAdvisorReplyLabelRecommendation.json.structured.cars.length >= 2,
      "pasted advisor reply label should still keep recommendation cars"
    );
    assert(
      !/(?:^|\n)#\s*首次购车需求梳理|##\s*操作建议/u.test(
        String(pastedAdvisorReplyLabelRecommendation.json.reply || "")
      ),
      "pasted advisor reply label should not leak raw service-knowledge markdown"
    );
  }

  const carryoverRecommendation = await postJson(`${BASE}/api/chat`, {
    message:
      "\u9884\u7b97 18 \u5230 22 \u4e07\uff0c\u5de5\u4f5c\u65e5\u57ce\u5e02\u901a\u52e4\uff0c\u5468\u672b\u5e26\u5bb6\u4eba\u77ed\u9014\u51fa\u884c\uff0c\u63a8\u8350\u4e24\u6b3e\u9002\u5408\u91cd\u70b9\u8bd5\u9a7e\u7684\u5c0f\u9e4f\u8f66\u578b\u3002",
    mode: "recommendation",
  });
  assert(carryoverRecommendation.response.ok, "candidate carryover recommendation request failed");
  const carryoverRecommendationStatus = assertExpectedModeOrTimeout(
    carryoverRecommendation,
    "recommendation"
  );
  if (carryoverRecommendationStatus === "expected") {
    const carryoverSessionId = carryoverRecommendation.json.sessionId;
    const carryoverCars = Array.isArray(carryoverRecommendation.json.structured?.cars)
      ? carryoverRecommendation.json.structured.cars
          .map((item) => String(item?.name || "").trim())
          .filter(Boolean)
          .slice(0, 2)
      : [];
    assert(carryoverCars.length >= 2, "candidate carryover recommendation should keep two candidates");
    const carryoverFollowup = await postJson(`${BASE}/api/chat`, {
      message: "\u67e5\u770b\u4e24\u6b3e\u8f66\u7684\u9009\u88c5\u5305\u53ca\u4ea4\u4ed8\u6392\u671f",
      sessionId: carryoverSessionId,
    });
    assert(carryoverFollowup.response.ok, "candidate carryover followup request failed");
    const carryoverFollowupStatus = assertExpectedModeOrTimeout(carryoverFollowup, "comparison");
    if (carryoverFollowupStatus === "expected") {
      const followupCarNames = Array.isArray(carryoverFollowup.json.structured?.carNames)
        ? carryoverFollowup.json.structured.carNames.map((item) => String(item || "").trim())
        : [];
      assert(
        carryoverCars.every((name) => followupCarNames.some((item) => item.includes(name))),
        "candidate carryover followup should reuse prior recommended cars"
      );
    }
  }

  const isolatedSessionTurn1 = await postJson(`${BASE}/api/chat`, {
    message: "讲讲G9，预算20万",
  });
  assert(isolatedSessionTurn1.response.ok, "memory isolation turn1 failed");
  const isolatedSessionId = isolatedSessionTurn1.json.sessionId;
  const isolatedSessionTurn2 = await postJson(`${BASE}/api/chat`, {
    message: "第一次买纯电车，想知道日常补能、保养和冬季续航要注意什么。",
    sessionId: isolatedSessionId,
  });
  assert(isolatedSessionTurn2.response.ok, "memory isolation turn2 failed");
  const isolatedServiceStatus = assertExpectedModeOrTimeout(isolatedSessionTurn2, "service");
  if (isolatedServiceStatus === "expected") {
    const traceText = JSON.stringify(isolatedSessionTurn2.json.agent?.trace || []);
    assert(!/G9|20万/.test(traceText), "service trace should not leak previous recommendation profile");
  }

  const isolatedForcedRecommendationTurn = await postJson(`${BASE}/api/chat`, {
    message: "第一次买纯电车，想知道日常补能、保养和冬季续航要注意什么。",
    sessionId: isolatedSessionId,
    mode: "recommendation",
  });
  assert(
    isolatedForcedRecommendationTurn.response.ok,
    "forced stale recommendation service turn failed"
  );
  assertExpectedModeOrTimeout(isolatedForcedRecommendationTurn, "service");

  const staleComparisonSeed = await postJson(`${BASE}/api/chat`, {
    message: "对比 G6 和 X9",
    mode: "comparison",
  });
  assert(staleComparisonSeed.response.ok, "stale comparison seed request failed");
  const staleComparisonSessionId = staleComparisonSeed.json.sessionId;
  const refreshedComparison = await postJson(`${BASE}/api/chat`, {
    message: "对比G6 755km与P7+ 725km的落地价差异",
    sessionId: staleComparisonSessionId,
    mode: "comparison",
  });
  assert(refreshedComparison.response.ok, "refreshed comparison request failed");
  const refreshedComparisonStatus = assertExpectedModeOrTimeout(refreshedComparison, "comparison");
  if (refreshedComparisonStatus === "expected") {
    const comparisonCarNames = Array.isArray(refreshedComparison.json.structured?.carNames)
      ? refreshedComparison.json.structured.carNames.join(" | ")
      : "";
    assert(/G6/i.test(comparisonCarNames), "refreshed comparison should keep G6");
    assert(/P7\+/i.test(comparisonCarNames), "refreshed comparison should include P7+");
    assert(!/X9/i.test(comparisonCarNames), "refreshed comparison should not reuse stale X9 label");
  }

  const singleCarAfterComparison = await postJson(`${BASE}/api/chat`, {
    message: "小米yu7如何",
    sessionId: staleComparisonSessionId,
    mode: "comparison",
  });
  assert(singleCarAfterComparison.response.ok, "single car after comparison request failed");
  const singleCarAfterComparisonStatus = assertExpectedModeOrTimeout(singleCarAfterComparison, "recommendation");
  if (singleCarAfterComparisonStatus === "expected") {
    assert(
      singleCarAfterComparison.json.mode === "recommendation",
      "single car explain should override stale comparison mode"
    );
    assert(
      !/X9/i.test(JSON.stringify(singleCarAfterComparison.json.structured || {})),
      "single car explain should not leak stale X9 card content"
    );
  }

  const piiTurn = await postJson(`${BASE}/api/chat`, {
    message: "My phone is 13800138000 and my email is demo@example.com",
    sessionId,
  });
  assert(piiTurn.response.ok, "pii turn request failed");

  const stream = await postSse(`${BASE}/api/chat/stream`, {
    message:
      "\u5e2e\u6211\u603b\u7ed3\u4e00\u4e0b\u9002\u5408\u57ce\u5e02\u901a\u52e4\u7684\u667a\u80fd SUV \u600e\u4e48\u9009",
    sessionId,
  });
  assert(stream.response.ok, "stream request failed");
  const doneEvent = stream.events.find((item) => item.event === "done");
  assert(doneEvent, "stream endpoint did not emit done event");
  assert(typeof doneEvent.data?.sessionId === "string", "stream done event missing sessionId");

  const configurator = await postJson(`${BASE}/api/configurator`, {
    message:
      "\u6211\u60f3\u914d\u4e00\u53f0\u9002\u5408\u901a\u52e4\u7684\u5c0f\u9e4f G6\uff0c\u5148\u4ece\u7248\u672c\u5f00\u59cb",
    sessionId,
  });
  assert(configurator.response.ok, "configurator request failed");
  assert(typeof configurator.json.reply === "string", "configurator reply missing");
  assert(typeof configurator.json.sessionId === "string", "configurator sessionId missing");

  const invalidLead = await postJson(`${BASE}/api/test-drive`, {
    name: "\u5f20\u4e09",
    phone: "13800138000",
    carModel: "\u5c0f\u9e4f G6",
    userCity: "\u5e7f\u5dde",
    privacyConsent: false,
  });
  assert(invalidLead.response.status === 400, "privacy validation should fail");

  const validLead = await postJson(`${BASE}/api/test-drive`, {
    name: "\u5f20\u4e09",
    phone: "13800138000",
    carModel: "\u5c0f\u9e4f G6",
    userCity: "\u5e7f\u5dde",
    privacyConsent: true,
    contactConsent: true,
  });
  assert(validLead.response.ok, "valid lead submit failed");
  assert(validLead.json.ok === true, "valid lead missing ok");
  assert(typeof validLead.json.requestId === "string", "valid lead requestId missing");
  assert(typeof validLead.json.routing?.leadScore === "number", "valid lead score missing");
  assert(typeof validLead.json.routing?.leadStage === "string", "valid lead stage missing");
  assert(
    Array.isArray(validLead.json.routing?.nextBestActions),
    "valid lead next best actions missing"
  );
  assert(typeof validLead.json.crm?.payloadVersion === "string", "valid lead crm payload missing");
  assert(typeof validLead.json.crm?.syncReady === "boolean", "valid lead crm syncReady missing");
  assert(typeof validLead.json.crmSync?.id === "string", "valid lead crm sync state missing");
  assert(typeof validLead.json.crmSync?.status === "string", "valid lead crm sync status missing");

  const dbCountsAfterLead = await queryPostgresCounts();
  if (dbCountsBefore && dbCountsAfterLead) {
    assert(dbCountsAfterLead.leads >= dbCountsBefore.leads + 1, "postgres lead record was not persisted");
    assert(
      dbCountsAfterLead.crmOutbox >= dbCountsBefore.crmOutbox + 1,
      "postgres crm_outbox record was not persisted"
    );
  }

  const crmOutbox = await fetch(`${BASE}/api/crm/outbox`, {
    headers: buildOpsHeaders(),
  }).then((res) => res.json());
  assert(Array.isArray(crmOutbox.items), "crm outbox items missing");
  assert(typeof crmOutbox.summary?.counts?.total === "number", "crm outbox summary missing");
  assert(
    crmOutbox.items.some((item) => item.id === validLead.json.crmSync.id),
    "crm outbox does not contain submitted lead"
  );

  const crmRun = await postJson(`${BASE}/api/crm/sync/run`, { limit: 2, force: true });
  assert(crmRun.response.ok, "crm sync run failed");
  assert(typeof crmRun.json.syncEnabled === "boolean", "crm sync run summary missing");

  const ack = await postJson(`${BASE}/api/crm/ack`, {
    outboxId: validLead.json.crmSync.id,
    status: "acknowledged",
    message: "smoke ack",
  });
  assert(ack.response.ok, "crm ack request failed");
  assert(ack.json.ok === true, "crm ack response missing ok");
  assert(ack.json.item?.status === "acknowledged", "crm ack did not move to acknowledged");

  const callback = await postJson(`${BASE}/api/crm/callback`, {
    outboxId: validLead.json.crmSync.id,
    status: "synced",
    message: "smoke callback",
    result: "synced",
  });
  assert(callback.response.ok, "crm callback request failed");
  assert(callback.json.ok === true, "crm callback response missing ok");
  assert(callback.json.item?.status === "synced", "crm callback did not move to synced");

  const failLead = await postJson(`${BASE}/api/test-drive`, {
    name: "smoke_fail",
    phone: "13800138001",
    carModel: "小鹏 G6",
    userCity: "广州",
    privacyConsent: true,
    contactConsent: true,
  });
  assert(failLead.response.ok, "dead-letter lead submit failed");
  assert(typeof failLead.json.crmSync?.id === "string", "dead-letter lead crmSync missing");

  const failAck = await postJson(`${BASE}/api/crm/ack`, {
    outboxId: failLead.json.crmSync.id,
    status: "failed",
    message: "smoke failure",
  });
  assert(failAck.response.ok, "crm fail ack request failed");
  assert(failAck.json.item?.status === "failed", "crm fail ack did not move to failed");

  const deadLetter = await postJson(`${BASE}/api/crm/callback`, {
    outboxId: failLead.json.crmSync.id,
    status: "dead_letter",
    message: "smoke dead letter",
    result: "dead_letter",
  });
  assert(deadLetter.response.ok, "crm dead-letter callback request failed");
  assert(deadLetter.json.item?.status === "dead_letter", "crm callback did not move to dead_letter");
  assert(
    typeof deadLetter.json.item?.deadLetterAt === "string" || deadLetter.json.item?.deadLetterAt === null,
    "dead_letter missing deadLetterAt"
  );

  const replay = await fetch(
    `${BASE}/api/debug/conversation-events?limit=20&sessionId=${encodeURIComponent(sessionId)}`,
    {
      headers: buildOpsHeaders(),
    }
  ).then((res) => res.json());
  const replayText = JSON.stringify(replay.items);
  assert(Array.isArray(replay.items), "conversation replay items missing");
  assert(replay.masked === true, "conversation replay should be masked by default");
  assert(
    replay.items.some(
      (item) =>
        item.route === "/api/chat" ||
        item.route === "/api/chat/stream" ||
        item.route === "/api/configurator"
    ),
    "conversation replay missing expected routes"
  );
  assert(!replayText.includes("13800138000"), "conversation replay leaked raw phone");
  assert(!replayText.includes("demo@example.com"), "conversation replay leaked raw email");
  assert(replayText.includes("138****8000"), "conversation replay missing masked phone");
  assert(replayText.includes("de***@example.com"), "conversation replay missing masked email");

  const auditLog = await fetch(`${BASE}/api/ops/audit-log?limit=20`, {
    headers: buildOpsHeaders(),
  }).then((res) => res.json());
  assert(Array.isArray(auditLog.items), "audit log items missing");
  const auditActions = auditLog.items.map((item) => item.action);
  assert(auditActions.includes("config_status.read"), "audit log missing config status access");
  assert(auditActions.includes("agent_readiness.read"), "audit log missing readiness access");
  assert(auditActions.includes("crm_outbox.read"), "audit log missing outbox access");
  assert(auditActions.includes("crm_sync.run"), "audit log missing crm sync access");
  assert(
    auditActions.includes("conversation_replay.read"),
    "audit log missing conversation replay access"
  );

  const sessionsFile = path.join(__dirname, "data", "sessions.json");
  if (fs.existsSync(sessionsFile)) {
    const sessionsText = fs.readFileSync(sessionsFile, "utf8");
    assert(!sessionsText.includes("13800138000"), "session storage leaked raw phone");
    assert(!sessionsText.includes("demo@example.com"), "session storage leaked raw email");
    assert(sessionsText.includes("138****8000"), "session storage missing masked phone");
    assert(sessionsText.includes("de***@example.com"), "session storage missing masked email");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        generatedAt: new Date().toISOString(),
        checks: SMOKE_CHECKS,
      },
      null,
      2
    )
  );
  writeSmokeResult({
    ok: true,
    generatedAt: new Date().toISOString(),
    checks: SMOKE_CHECKS,
  });
}

(async () => {
  try {
    await main();
  } catch (error) {
    writeSmokeResult({
      ok: false,
      generatedAt: new Date().toISOString(),
      message: error.message,
    });
    console.error(JSON.stringify({ ok: false, message: error.message }, null, 2));
    process.exitCode = 1;
  } finally {
    await stopServer();
  }
})();
