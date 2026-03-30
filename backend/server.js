const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

require("dotenv").config({ path: path.join(__dirname, ".env") });

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

const { detectIntent } = require("./agent");
const {
  createSessionState,
  trimSessionMessages,
  runAgentTurn,
} = require("./commercialAgent");
const { runReActTurn } = require("./reactAgent");
const { runConfiguratorTurn, getConfiguratorStage } = require("./configuratorAgent");
const {
  inferBrandKeyword,
  inferBrandWithLLM,
  pickNearestStore,
  listBrandsFromCatalog,
} = require("./testDriveRouting");
const { pickNearestByDrivingTime } = require("./amapRoute");
const { sendTestDriveNotifications } = require("./sms");
const { buildAgentReadinessReport } = require("./agentReadiness");
const { buildLeadIntelligence } = require("./leadIntelligence");
const { assignAdvisor, buildCrmPayload } = require("./advisorAssignment");
const { buildEvalReport } = require("./evaluation");
const { getDatabaseUrl, query: postgresQuery } = require("./db/postgresClient");
const {
  AGENT_RELEASE,
  PROMPT_VERSION,
  POLICY_VERSION,
  EVAL_DATASET_VERSION,
  DATA_ADAPTER_VERSION,
} = require("./agentVersioning");
const { buildRuntimeConfigReport, getBlockingConfigErrors } = require("./startupValidation");
const {
  initializeBusinessData,
  refreshBusinessData,
  startBusinessDataRefreshLoop,
  getBusinessDataRefreshConfig,
  readStoresPayload,
  readRightsPayload,
  readAdvisorPayload,
  getBusinessDataStatus,
} = require("./businessData");
const {
  ensureDir,
  readJsonFile,
  writeJsonFile,
} = require("./persistence/filePersistence");
const { createStorageProvider } = require("./persistence/storageProvider");
const { sanitizeConversationEvent } = require("./privacy");
const { getOpsAccessConfig, getRetentionPolicy } = require("./runtimePolicy");
const {
  getKnowledgeProvider,
  searchKnowledgeInPostgres,
  searchKnowledgeByVectorInPostgres,
} = require("./knowledge/retrievalService");
const { searchServiceKnowledgeRuntime } = require("./serviceKnowledge");
const { getKnowledgeStatus } = require("./knowledge/knowledgeStatus");
const { buildOpsDashboard } = require("./opsDashboard");

const app = express();
const PORT = process.env.PORT || 3001;
const leadsDir = path.join(__dirname, "data");
const MAX_MESSAGES = 24;
const MAX_PERSISTED_SESSIONS = 120;
const CN_PHONE = /^1[3-9]\d{9}$/;
const LLM_TIMEOUT_MS = Math.max(1000, Number(process.env.LLM_TIMEOUT_MS || 30000));
const LLM_FAILURE_COOLDOWN_MS = Math.max(
  5000,
  Number(process.env.LLM_FAILURE_COOLDOWN_MS || 120000)
);
const SESSION_TTL_MS = Math.max(
  30 * 60 * 1000,
  Number(process.env.SESSION_TTL_MS || 24 * 60 * 60 * 1000)
);
const MAX_ACTIVE_SESSIONS = Math.max(50, Number(process.env.MAX_ACTIVE_SESSIONS || 300));
const CHAT_RATE_LIMIT_WINDOW_MS = Math.max(
  10 * 1000,
  Number(process.env.CHAT_RATE_LIMIT_WINDOW_MS || 60 * 1000)
);
const CHAT_RATE_LIMIT_MAX = Math.max(5, Number(process.env.CHAT_RATE_LIMIT_MAX || 20));
const TEST_DRIVE_RATE_LIMIT_WINDOW_MS = Math.max(
  60 * 1000,
  Number(process.env.TEST_DRIVE_RATE_LIMIT_WINDOW_MS || 60 * 60 * 1000)
);
const TEST_DRIVE_RATE_LIMIT_MAX = Math.max(
  1,
  Number(process.env.TEST_DRIVE_RATE_LIMIT_MAX || 6)
);
const REQUEST_LOG_SLOW_MS = Math.max(
  500,
  Number(process.env.REQUEST_LOG_SLOW_MS || 1500)
);
const CRM_SYNC_INTERVAL_MS = Math.max(
  10000,
  Number(process.env.CRM_SYNC_INTERVAL_MS || 30000)
);
const allowedOrigins = String(process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const llmCircuit = {
  cooldownUntil: 0,
  consecutiveFailures: 0,
  lastFailureAt: "",
  lastError: "",
};
const rateLimiters = {
  chat: new Map(),
  testDrive: new Map(),
};

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowedOrigins.length === 0) {
        callback(null, process.env.NODE_ENV !== "production");
        return;
      }

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "1mb" }));

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function isLocalIp(ip) {
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost"].includes(String(ip || ""));
}

function getRequestId(req) {
  return String(req.requestId || "");
}

app.use((req, res, next) => {
  req.requestId = randomUUID();
  res.setHeader("X-Request-Id", req.requestId);

  const startedAt = Date.now();
  res.on("finish", () => {
    const durationMs = Date.now() - startedAt;
    if (durationMs >= REQUEST_LOG_SLOW_MS || res.statusCode >= 400) {
      console.log(
        `[request] ${req.method} ${req.originalUrl} status=${res.statusCode} duration=${durationMs}ms id=${req.requestId} ip=${getClientIp(
          req
        )}`
      );
    }
  });

  next();
});

function withTimeout(promise, timeoutMs, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label || "operation"} timeout`)), timeoutMs);
    }),
  ]);
}

function llmCircuitOpen() {
  return llmCircuit.cooldownUntil > Date.now();
}

function markLLMFailure(error) {
  llmCircuit.consecutiveFailures += 1;
  llmCircuit.cooldownUntil = Date.now() + LLM_FAILURE_COOLDOWN_MS;
  llmCircuit.lastFailureAt = new Date().toISOString();
  llmCircuit.lastError = error instanceof Error ? error.message : String(error || "unknown_error");
  console.warn(
    `[LLM] request failed, falling back to local mode for ${Math.round(
      LLM_FAILURE_COOLDOWN_MS / 1000
    )}s: ${llmCircuit.lastError}`
  );
}

function markLLMSuccess() {
  llmCircuit.cooldownUntil = 0;
  llmCircuit.consecutiveFailures = 0;
  llmCircuit.lastFailureAt = "";
  llmCircuit.lastError = "";
}

function llmConfig() {
  const apiKey =
    process.env.MOONSHOT_API_KEY ||
    process.env.KIMI_API_KEY ||
    process.env.OPENAI_API_KEY;
  const baseURL =
    process.env.MOONSHOT_BASE_URL ||
    process.env.OPENAI_BASE_URL ||
    (process.env.MOONSHOT_API_KEY || process.env.KIMI_API_KEY
      ? "https://api.moonshot.cn/v1"
      : undefined);
  const model =
    process.env.MOONSHOT_MODEL ||
    process.env.OPENAI_MODEL ||
    (baseURL && String(baseURL).includes("moonshot") ? "kimi-k2.5" : "gpt-4o-mini");
  return { apiKey, baseURL, model };
}

function effectiveTemperature(llm) {
  if (process.env.LLM_TEMPERATURE !== undefined && process.env.LLM_TEMPERATURE !== "") {
    return Number(process.env.LLM_TEMPERATURE);
  }
  const moonshot =
    (llm.baseURL && String(llm.baseURL).includes("moonshot")) ||
    /^(kimi|moonshot)/i.test(String(llm.model || ""));
  return moonshot ? 1.0 : 0.6;
}

let openaiClient = null;
let openaiClientKey = "";
function getOpenAI() {
  const { apiKey, baseURL } = llmConfig();
  if (!apiKey || llmCircuitOpen()) return null;
  const key = `${apiKey}|${baseURL || ""}`;
  if (!openaiClient || openaiClientKey !== key) {
    openaiClient = new OpenAI({
      apiKey,
      baseURL,
      timeout: LLM_TIMEOUT_MS,
      maxRetries: 0,
    });
    openaiClientKey = key;
  }
  return openaiClient;
}

/** @type {Map<string, ReturnType<typeof createSessionState>>} */
const sessions = new Map();
const storage = createStorageProvider({
  dataDir: leadsDir,
  createSessionState,
  trimSessionMessages,
  maxPersistedSessions: MAX_PERSISTED_SESSIONS,
  sessionTtlMs: SESSION_TTL_MS,
});
const opsAccessConfig = getOpsAccessConfig();
const retentionPolicy = getRetentionPolicy({ sessionTtlMs: SESSION_TTL_MS });
const retentionState = {
  lastRunAt: null,
  lastReason: null,
  summary: null,
  error: null,
};

async function getStorageCrmSyncSummary() {
  if (typeof storage.getCrmSyncSummary === "function") {
    return storage.getCrmSyncSummary();
  }
  return {
    enabled: false,
    provider: "mock",
    webhookUrlConfigured: false,
    timeoutMs: 0,
    maxAttempts: 0,
    retryBaseMs: 0,
    counts: {
      total: 0,
      pending: 0,
      sent: 0,
      acknowledged: 0,
      synced: 0,
      failed: 0,
      dead_letter: 0,
    },
    recent: [],
  };
}

function parseIsoTime(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : 0;
}

function currentConfigReport() {
  return buildRuntimeConfigReport({ sessionTtlMs: SESSION_TTL_MS });
}

async function currentEvalReport() {
  const versions = {
    agentRelease: AGENT_RELEASE,
    promptVersion: PROMPT_VERSION,
    policyVersion: POLICY_VERSION,
    evalDatasetVersion: EVAL_DATASET_VERSION,
    dataAdapterVersion: DATA_ADAPTER_VERSION,
  };
  const analyticsRecords =
    typeof storage.listAnalyticsEvents === "function"
      ? await storage.listAnalyticsEvents(1000)
      : undefined;

  return buildEvalReport({
    backendDir: __dirname,
    leadsDir,
    versions,
    businessDataStatus: getBusinessDataStatus(),
    analyticsRecords,
  });
}

function currentSecurityStatus() {
  return {
    opsTokenConfigured: opsAccessConfig.tokenConfigured,
    localDevBypassEnabled: opsAccessConfig.allowLocalDevBypass,
    headerName: opsAccessConfig.headerName,
    actorHeaderName: opsAccessConfig.actorHeaderName,
  };
}

function currentRetentionStatus() {
  return {
    ...retentionPolicy,
    lastRunAt: retentionState.lastRunAt,
    lastReason: retentionState.lastReason,
    lastError: retentionState.error,
    lastSummary: retentionState.summary,
  };
}

function pruneRateLimitStore(store, windowMs, now = Date.now()) {
  for (const [key, entry] of store.entries()) {
    if (!entry || entry.resetAt <= now - windowMs) {
      store.delete(key);
    }
  }
}

function applyRateLimit(store, key, limit, windowMs, now = Date.now()) {
  pruneRateLimitStore(store, windowMs, now);

  const current = store.get(key);
  if (!current || current.resetAt <= now) {
    const next = {
      count: 1,
      resetAt: now + windowMs,
    };
    store.set(key, next);
    return {
      ok: true,
      remaining: Math.max(0, limit - next.count),
      retryAfterMs: 0,
    };
  }

  current.count += 1;
  store.set(key, current);

  if (current.count > limit) {
    return {
      ok: false,
      remaining: 0,
      retryAfterMs: Math.max(0, current.resetAt - now),
    };
  }

  return {
    ok: true,
    remaining: Math.max(0, limit - current.count),
    retryAfterMs: 0,
  };
}

function pruneSessions(now = Date.now()) {
  let removed = 0;

  for (const [id, state] of sessions.entries()) {
    const lastActiveAt = parseIsoTime(state?.lastActiveAt || state?.createdAt);
    if (lastActiveAt && now - lastActiveAt > SESSION_TTL_MS) {
      sessions.delete(id);
      removed += 1;
    }
  }

  if (sessions.size > MAX_ACTIVE_SESSIONS) {
    const overflow = [...sessions.entries()]
      .sort(
        (a, b) =>
          parseIsoTime(a[1]?.lastActiveAt || a[1]?.createdAt) -
          parseIsoTime(b[1]?.lastActiveAt || b[1]?.createdAt)
      )
      .slice(0, Math.max(0, sessions.size - MAX_ACTIVE_SESSIONS));

    for (const [id] of overflow) {
      if (sessions.delete(id)) removed += 1;
    }
  }

  return removed;
}

function getOrCreateSession(sessionId, channel) {
  const removed = pruneSessions();
  if (removed) {
    console.log(`[session] pruned ${removed} expired or overflow sessions`);
  }

  let id = sessionId;
  if (!id || !sessions.has(id)) {
    id = randomUUID();
    sessions.set(id, createSessionState());
  }
  const session = sessions.get(id);
  if (session) {
    // Channel isolation: if a session was created for a different channel,
    // create a new session to prevent cross-contamination
    if (channel && session.channel && session.channel !== channel) {
      console.log(`[session] channel mismatch: session ${id} is ${session.channel}, requested ${channel}; creating new session`);
      id = randomUUID();
      sessions.set(id, createSessionState());
      const newSession = sessions.get(id);
      if (newSession) {
        newSession.channel = channel;
        newSession.createdAt = new Date().toISOString();
        newSession.lastActiveAt = newSession.createdAt;
      }
      return id;
    }
    if (channel) session.channel = channel;
    const now = new Date().toISOString();
    if (!session.createdAt) session.createdAt = now;
    session.lastActiveAt = now;
  }
  return id;
}

function trimSession(messages) {
  return trimSessionMessages(messages, MAX_MESSAGES);
}

function isSupplementalProfileMessage(text) {
  return /预算|万|家充|装桩|充电|城市|我在|人在|通勤|长途|带娃|家庭|空间|智驾|智能化|续航|SUV|轿车|六座|七座|广州|深圳|上海|北京/.test(
    String(text || "")
  );
}

function resolveTurnMode(text, session) {
  const detected = detectIntent(text);
  if (detected !== "service") return detected;

  const lastMode = session?.lastMode;
  if (
    (lastMode === "recommendation" || lastMode === "comparison") &&
    isSupplementalProfileMessage(text)
  ) {
    return lastMode;
  }

  return detected;
}

function shouldFallbackFromReActTurn(turn) {
  if (!turn || turn.mode !== "general") {
    return false;
  }

  const reply = String(turn.reply || "");
  if (/超时|timeout/i.test(reply)) {
    return true;
  }

  const trace = Array.isArray(turn.meta?.trace) ? turn.meta.trace : [];
  return trace.some((item) => /timeout/i.test(String(item?.error || item?.detail || "")));
}

function maskConversationEvent(item) {
  return sanitizeConversationEvent(item);
}

function getOpsRequestToken(req) {
  const headerValue =
    req.headers[opsAccessConfig.headerName] ||
    req.headers[opsAccessConfig.headerName.toLowerCase()];
  if (typeof headerValue === "string" && headerValue.trim()) {
    return headerValue.trim();
  }

  const auth = String(req.headers.authorization || "").trim();
  if (/^bearer\s+/i.test(auth)) {
    return auth.replace(/^bearer\s+/i, "").trim();
  }

  return String(req.query?.opsToken || "").trim();
}

function getOpsActor(req, access) {
  const explicitActor = String(
    req.headers[opsAccessConfig.actorHeaderName] ||
      req.headers[opsAccessConfig.actorHeaderName.toLowerCase()] ||
      req.query?.actor ||
      ""
  ).trim();

  if (explicitActor) {
    return explicitActor;
  }
  if (access?.mode === "token") {
    return "token-operator";
  }
  if (access?.mode === "local-dev") {
    return "local-dev";
  }
  return `anonymous@${getClientIp(req)}`;
}

function evaluateOpsAccess(req) {
  const ip = getClientIp(req);
  const token = getOpsRequestToken(req);

  if (opsAccessConfig.tokenConfigured) {
    if (token && token === opsAccessConfig.token) {
      return {
        allowed: true,
        mode: "token",
        reason: "token_authenticated",
        canViewRaw: true,
      };
    }
    if (opsAccessConfig.allowLocalDevBypass && isLocalIp(ip)) {
      return {
        allowed: true,
        mode: "local-dev",
        reason: "localhost_development_bypass",
        canViewRaw: true,
      };
    }
    return {
      allowed: false,
      mode: "denied",
      reason: "invalid_or_missing_token",
      canViewRaw: false,
    };
  }

  if (opsAccessConfig.allowLocalDevBypass && isLocalIp(ip)) {
    return {
      allowed: true,
      mode: "local-dev",
      reason: "localhost_development_bypass",
      canViewRaw: true,
    };
  }

  return {
    allowed: false,
    mode: "denied",
    reason: "ops_access_not_configured",
    canViewRaw: false,
  };
}

async function appendOpsAudit(req, access, details) {
  if (typeof storage.appendAuditEvent !== "function") {
    return;
  }

  try {
    await storage.appendAuditEvent({
      action: details.action,
      resource: details.resource,
      outcome: details.outcome,
      actor: getOpsActor(req, access),
      actorType: access?.mode || "unknown",
      requestId: getRequestId(req) || null,
      ip: getClientIp(req),
      userAgent: String(req.headers["user-agent"] || ""),
      metadata: {
        method: req.method,
        path: req.originalUrl,
        reason: access?.reason || null,
        ...details.metadata,
      },
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    console.warn("[audit] failed to persist audit event:", error.message);
  }
}

async function requireOpsAccess(req, res, { action, resource }) {
  const access = evaluateOpsAccess(req);
  if (access.allowed) {
    return access;
  }

  await appendOpsAudit(req, access, {
    action,
    resource,
    outcome: "denied",
    metadata: {
      denied: true,
    },
  });
  res.status(403).json({
    error: "ops access denied",
    code: access.reason,
  });
  return null;
}

function shouldMaskDebugOutput(req, access) {
  const requestedMask = String(req.query.mask || "").trim().toLowerCase();
  if (requestedMask !== "false") {
    return true;
  }
  return !(access?.canViewRaw === true);
}

function ensureDataDir() {
  ensureDir(leadsDir);
}

async function loadPersistedSessions() {
  try {
    const entries = await storage.loadSessions();
    for (const entry of entries) {
      if (!entry?.id) continue;
      sessions.set(entry.id, entry.state);
    }
    if (entries.length) {
      console.log(`[session] restored ${entries.length} persisted sessions via ${storage.kind}`);
    }
  } catch (error) {
    console.warn("[session] failed to restore persisted sessions:", error.message);
  }
}

async function persistSessions() {
  try {
    await storage.persistSessions([...sessions.entries()]);
  } catch (error) {
    console.warn("[session] failed to persist sessions:", error.message);
  }
}

async function persistConversationEvent({
  route,
  requestId,
  sessionId,
  userMessage,
  assistantReply,
  mode,
  structured,
  agent,
  stream = false,
}) {
  try {
    await storage.appendConversationEvent({
      route,
      requestId,
      sessionId,
      stream,
      mode: mode || null,
      userMessage,
      assistantReply,
      structured: structured || null,
      agent: agent || null,
    });
  } catch (error) {
    console.warn("[storage] failed to append conversation event:", error.message);
  }
}

async function persistAnalyticsEvent(record) {
  try {
    await storage.appendAnalyticsEvent(record);
  } catch (error) {
    console.warn("[storage] failed to append analytics event:", error.message);
  }
}

async function runRetentionCleanup(reason = "scheduled") {
  if (typeof storage.applyRetentionPolicy !== "function") {
    return null;
  }

  try {
    const summary = await storage.applyRetentionPolicy();
    retentionState.lastRunAt = new Date().toISOString();
    retentionState.lastReason = reason;
    retentionState.summary = summary;
    retentionState.error = null;
    if (summary?.removedTotal > 0) {
      console.log(`[retention] reason=${reason} removed=${summary.removedTotal}`);
    }
    return summary;
  } catch (error) {
    retentionState.lastRunAt = new Date().toISOString();
    retentionState.lastReason = reason;
    retentionState.error = error.message;
    console.warn("[retention] cleanup failed:", error.message);
    return null;
  }
}

function uniqueStrings(list) {
  return [...new Set((Array.isArray(list) ? list : []).filter(Boolean).map((item) => String(item)))];
}

function extractTurnTelemetry(turn) {
  const traceTools = Array.isArray(turn?.meta?.trace)
    ? turn.meta.trace.map((item) => item?.action).filter(Boolean)
    : [];
  const toolsUsed = uniqueStrings([
    ...(turn?.agent?.toolsUsed || []),
    ...(turn?.agent?.toolCalls || []),
    ...(turn?.meta?.toolCalls || []),
    ...traceTools,
  ]);

  return {
    toolsUsed,
    agentTurns:
      typeof turn?.meta?.turns === "number"
        ? turn.meta.turns
        : Array.isArray(turn?.agent?.trace)
          ? turn.agent.trace.filter((item) => item?.type === "tool").length
          : toolsUsed.length,
    totalMs:
      turn?.agent?.timingMs?.total ??
      turn?.meta?.totalMs ??
      0,
  };
}

app.get("/health", async (_req, res) => {
  try {
    const { apiKey, baseURL, model } = llmConfig();
    const storesPayload = readStoresPayload();
    const businessData = getBusinessDataStatus();
    const crmSync = await getStorageCrmSyncSummary();
    const config = currentConfigReport();
    const audit = typeof storage.getAuditSummary === "function" ? await storage.getAuditSummary() : null;
    const businessDataRefresh = getBusinessDataRefreshConfig();
    res.json({
      ok: true,
      service: {
        port: Number(PORT),
        sessions: sessions.size,
        sessionTtlMs: SESSION_TTL_MS,
        maxActiveSessions: MAX_ACTIVE_SESSIONS,
        storesLoaded: Array.isArray(storesPayload.stores) ? storesPayload.stores.length : 0,
        amapEnabled: Boolean(String(process.env.AMAP_REST_KEY || "").trim()),
      },
      llm: {
        configured: Boolean(apiKey),
        available: Boolean(apiKey) && !llmCircuitOpen(),
        provider: baseURL || "default",
        model: model || "",
        timeoutMs: LLM_TIMEOUT_MS,
        failureCooldownMs: LLM_FAILURE_COOLDOWN_MS,
        cooldownUntil: llmCircuit.cooldownUntil
          ? new Date(llmCircuit.cooldownUntil).toISOString()
          : null,
        lastFailureAt: llmCircuit.lastFailureAt || null,
        lastError: llmCircuit.lastError || null,
      },
      limits: {
        chat: {
          max: CHAT_RATE_LIMIT_MAX,
          windowMs: CHAT_RATE_LIMIT_WINDOW_MS,
        },
        testDrive: {
          max: TEST_DRIVE_RATE_LIMIT_MAX,
          windowMs: TEST_DRIVE_RATE_LIMIT_WINDOW_MS,
        },
      },
      versions: {
        agentRelease: AGENT_RELEASE,
        promptVersion: PROMPT_VERSION,
        policyVersion: POLICY_VERSION,
        evalDatasetVersion: EVAL_DATASET_VERSION,
        dataAdapterVersion: DATA_ADAPTER_VERSION,
      },
      businessData,
      businessDataRefresh,
      crmSync,
      security: currentSecurityStatus(),
      retention: currentRetentionStatus(),
      audit,
      config,
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/stores", (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();
  const city = String(req.query.city || "").trim();
  const brand = String(req.query.brand || "").trim();

  const payload = readStoresPayload();
  let stores = Array.isArray(payload.stores) ? payload.stores : [];

  if (brand) {
    stores = stores.filter((store) => store.brand === brand);
  }
  if (city) {
    stores = stores.filter(
      (store) =>
        (store.city && store.city.includes(city)) ||
        (store.province && store.province.includes(city))
    );
  }
  if (q) {
    stores = stores.filter((store) => {
      const haystack = [
        store.brand,
        store.name,
        store.city,
        store.province,
        store.address,
        store.type,
        ...(store.services || []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }

  res.json({ meta: payload.meta || {}, stores });
});

app.get("/api/rights", (req, res) => {
  const city = String(req.query.city || "").trim();
  const brand = String(req.query.brand || "").trim();
  const payload = readRightsPayload();
  let items = Array.isArray(payload.items) ? payload.items : [];

  if (brand) {
    items = items.filter((item) => !item.brand || item.brand === brand || item.brand === "全国");
  }
  if (city) {
    items = items.filter((item) => !item.city || item.city === city || item.city === "全国");
  }

  res.json({ meta: payload.meta || {}, items });
});

// ─── 高德反向地理编码（经纬度→城市名）─────────────────────────
app.get("/api/geocode/city", async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  const amapKey = process.env.AMAP_REST_KEY;
  if (!amapKey) return res.json({ city: null, error: "no_amap_key" });
  if (isNaN(lat) || isNaN(lng)) return res.status(400).json({ error: "invalid_coords" });
  try {
    const url = `https://restapi.amap.com/v3/geocode/regeo?key=${amapKey}&location=${lng},${lat}&poitype=&radius=1000&extensions=base&batch=false&roadlevel=0`;
    const r = await fetch(url);
    const data = await r.json();
    if (String(data.status) !== "1") return res.json({ city: null, error: data.info });
    const addr = data.regeocode?.addressComponent;
    const city = (addr?.city && addr.city !== "[]" ? addr.city : addr?.province) || null;
    const district = addr?.district || null;
    res.json({
      city,
      district,
      province: addr?.province || null,
      formattedAddress: data.regeocode?.formatted_address || null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/test-drive", async (req, res) => {
  try {
    const requestId = getRequestId(req);
    const limitState = applyRateLimit(
      rateLimiters.testDrive,
      `${getClientIp(req)}:test-drive`,
      TEST_DRIVE_RATE_LIMIT_MAX,
      TEST_DRIVE_RATE_LIMIT_WINDOW_MS
    );
    if (!limitState.ok) {
      return res.status(429).json({
        error: "预约提交过于频繁，请稍后再试。",
        requestId,
        retryAfterSec: Math.ceil(limitState.retryAfterMs / 1000),
      });
    }

    const body = req.body || {};
    const name = String(body.name || "").trim();
    const phone = String(body.phone || "").replace(/\s/g, "");
    const preferredTime = String(body.preferredTime || "").trim();
    const carModel = String(body.carModel || "").trim();
    const storeId = body.storeId ? String(body.storeId) : "";
    const remark = String(body.remark || "").trim();
    const purchaseStage = String(body.purchaseStage || "").trim();
    const buyTimeline = String(body.buyTimeline || "").trim();
    const privacyConsent = body.privacyConsent === true;
    const contactConsent = body.contactConsent === true;
    const userCity = String(body.userCity || "").trim();
    const userLat =
      body.userLat !== undefined && body.userLat !== null && body.userLat !== ""
        ? Number(body.userLat)
        : NaN;
    const userLng =
      body.userLng !== undefined && body.userLng !== null && body.userLng !== ""
        ? Number(body.userLng)
        : NaN;
    const hasGeo = Number.isFinite(userLat) && Number.isFinite(userLng);

    const validationError =
      !name || name.length > 50
        ? "请填写有效姓名。"
        : !CN_PHONE.test(phone)
          ? "请填写 11 位中国大陆手机号。"
          : !storeId && !userCity && !hasGeo
            ? "请填写所在城市，或使用定位以匹配最近门店。"
            : !privacyConsent
              ? "请先同意隐私与试驾联系授权说明后再提交。"
              : "";

    if (validationError) {
      return res.status(400).json({ error: validationError, requestId });
    }

    const brands = listBrandsFromCatalog();
    const keywordGuess = inferBrandKeyword(carModel, remark, brands);

    let llmResult = null;
    const client = getOpenAI();
    const llm = llmConfig();
    if (client && llm.apiKey) {
      try {
        llmResult = await withTimeout(
          inferBrandWithLLM(client, llm.model, effectiveTemperature(llm), carModel, remark),
          LLM_TIMEOUT_MS,
          "brand_inference"
        );
        markLLMSuccess();
      } catch (error) {
        markLLMFailure(error);
        console.warn("[test-drive] llm brand inference failed:", error.message);
      }
    }

    let inferredBrand = "小鹏";
    let inferenceSource = "default";

    // 单品牌转化边界：若用户意向/备注明确指向竞品，必须识别出来并在后续直接拒绝转化。
    if (keywordGuess.brand && keywordGuess.brand !== "小鹏") {
      inferredBrand = keywordGuess.brand;
      inferenceSource = keywordGuess.source;
    } else if (llmResult?.brand && llmResult.confidence >= 0.45) {
      inferredBrand = llmResult.brand;
      inferenceSource = "llm";
    } else if (keywordGuess.brand) {
      inferredBrand = keywordGuess.brand;
      inferenceSource = keywordGuess.source;
    } else if (llmResult?.brand) {
      inferredBrand = llmResult.brand;
      inferenceSource = "llm_low_confidence";
    }

    const payload = readStoresPayload();
    const stores = Array.isArray(payload.stores) ? payload.stores : [];
    const brandLinks = payload.meta?.brandAppointmentLinks || {};

    const requestedNonXpeng = inferredBrand && inferredBrand !== "小鹏";
    if (requestedNonXpeng) {
      return res.status(200).json({
        requestId,
        ok: false,
        message: "当前试驾转化链路只支持小鹏车型。我可以继续帮你对比竞品，但预约试驾、门店匹配和留资只会为小鹏提供。",
        routing: {
          inferredBrand,
          inferenceSource,
          llmConfidence: llmResult?.confidence ?? null,
          llmReason: llmResult?.reason || null,
          assignedStore: null,
          method: "xpeng_only_boundary",
          distanceKm: null,
          drivingDurationMin: null,
          officialAppointmentUrl: payload.meta?.officialAppointment || "https://www.xiaopeng.com/appointment.html",
        },
      });
    }

    let assignedStore = null;
    let assignedBrand = "小鹏";
    let routingMethod = "none";
    let distanceKm = null;
    let drivingDurationMin = null;

    if (storeId) {
      const manual = stores.find((store) => store.id === storeId);
      if (manual) {
        assignedStore = manual;
        assignedBrand = manual.brand || assignedBrand;
        routingMethod = "manual";
      }
    }

    if (!assignedStore) {
      const amapKey = String(process.env.AMAP_REST_KEY || "").trim();
      const candidates = stores.filter(
        (store) =>
          store.brand === assignedBrand &&
          typeof store.lat === "number" &&
          typeof store.lng === "number"
      );

      let picked = null;
      if (hasGeo && amapKey && candidates.length) {
        try {
          const amap = await pickNearestByDrivingTime(amapKey, userLat, userLng, candidates);
          if (amap?.store) {
            picked = {
              store: amap.store,
              method: amap.method,
              distanceKm: amap.distanceKm,
            };
            drivingDurationMin = amap.durationMin;
          }
        } catch (error) {
          console.warn("[amap] route planning failed:", error.message);
        }
      }

      if (!picked?.store) {
        picked = pickNearestStore({
          stores,
          brand: assignedBrand,
          userLat: hasGeo ? userLat : undefined,
          userLng: hasGeo ? userLng : undefined,
          userCity: userCity || undefined,
        });
      }

      assignedStore = picked.store;
      routingMethod = picked.method;
      distanceKm = picked.distanceKm;
    }

    const officialAppointmentUrl =
      payload.meta?.officialAppointment ||
      brandLinks["小鹏"] ||
      "https://www.xiaopeng.com/appointment.html";

    const rightsPayload = readRightsPayload();
    const advisorPayload = readAdvisorPayload();
    const rightsItems = Array.isArray(rightsPayload.items) ? rightsPayload.items : [];
    const matchedRights = rightsItems.find(
      (item) =>
        (!item.brand || item.brand === assignedBrand || item.brand === "全国") &&
        (!item.city || item.city === userCity || item.city === "全国")
    );
    const versions = {
      agentRelease: AGENT_RELEASE,
      promptVersion: PROMPT_VERSION,
      policyVersion: POLICY_VERSION,
      evalDatasetVersion: EVAL_DATASET_VERSION,
      dataAdapterVersion: DATA_ADAPTER_VERSION,
    };

    const lead = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      name,
      phone,
      preferredTime,
      carModel,
      remark,
      purchaseStage: purchaseStage || null,
      buyTimeline: buyTimeline || null,
      privacyConsent,
      contactConsent,
      userCity: userCity || null,
      userLat: hasGeo ? userLat : null,
      userLng: hasGeo ? userLng : null,
      userSelectedStoreId: storeId || null,
      inferredBrand: assignedBrand,
      brandInferenceSource: inferenceSource,
      llmConfidence: llmResult?.confidence ?? null,
      llmReason: llmResult?.reason || null,
      assignedStoreId: assignedStore?.id || null,
      assignedStoreName: assignedStore?.name || null,
      assignedStoreBrand: assignedStore?.brand || null,
      assignedStoreCity: assignedStore?.city || null,
      assignedStoreAddress: assignedStore?.address || null,
      assignedStorePhone: assignedStore?.phone || null,
      routingMethod,
      distanceKm,
      drivingDurationMin,
      matchedRightsId: matchedRights?.id || null,
      matchedRightsTitle: matchedRights?.title || null,
      versions,
      source: "xpeng-car-ai-web",
      storeId: assignedStore?.id || (storeId || null),
    };

    const leadIntelligence = buildLeadIntelligence(lead);
    const advisor = assignAdvisor({
      lead,
      advisorsPayload: advisorPayload,
    });
    const crmPayload = buildCrmPayload({
      lead,
      intelligence: leadIntelligence,
      advisor,
      versions,
      requestId,
    });
    lead.leadScore = leadIntelligence.score;
    lead.leadStage = leadIntelligence.stage;
    lead.leadPriority = leadIntelligence.priority;
    lead.nextBestActions = leadIntelligence.nextBestActions;
    lead.scoreReasons = leadIntelligence.reasons;
    lead.assignedAdvisor = advisor;
    lead.crm = crmPayload;
    lead.crmSync = null;

    await storage.appendLeadRecord(lead);

    const queuedCrmSync = await storage.enqueueCrmOutbox({
      payload: crmPayload,
      lead,
      requestId,
    });
    let crmSync = {
      id: queuedCrmSync.id,
      status: queuedCrmSync.status,
      attempts: queuedCrmSync.attempts,
      syncEnabled: queuedCrmSync.syncEnabled,
      lastError: queuedCrmSync.lastError,
      lastHttpStatus: queuedCrmSync.lastHttpStatus,
      lastAttemptAt: queuedCrmSync.lastAttemptAt,
      nextAttemptAt: queuedCrmSync.nextAttemptAt,
      sentAt: queuedCrmSync.sentAt || null,
      ackAt: queuedCrmSync.ackAt || null,
      syncedAt: queuedCrmSync.syncedAt,
      deadLetterAt: queuedCrmSync.deadLetterAt || null,
      provider: queuedCrmSync.provider || null,
      transportStatus: queuedCrmSync.transportStatus || null,
    };

    if (queuedCrmSync.syncEnabled) {
      try {
        const crmSyncResult = await storage.syncCrmOutbox({
          limit: 1,
          ids: [queuedCrmSync.id],
          force: true,
        });
        crmSync = crmSyncResult.byId?.[queuedCrmSync.id] || crmSync;
      } catch (error) {
        console.warn("[crm] immediate sync failed:", error.message);
      }
    }

    lead.crmSync = crmSync;

    await storage.appendLeadRecord(lead);

    const rawLeadWebhook = String(process.env.RAW_LEAD_WEBHOOK_URL || "").trim();
    if (rawLeadWebhook) {
      fetch(rawLeadWebhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lead),
      }).catch((error) => console.warn("[webhook] forward failed:", error.message));
    }

    sendTestDriveNotifications({
      name,
      phone,
      carModel,
      storeName: assignedStore?.name || null,
      storePhone: assignedStore?.phone || null,
    }).catch((error) => console.warn("[sms] unexpected error:", error.message));

    const displayStoreSummary = assignedStore
      ? `已匹配门店「${assignedStore.name}」`
      : `当前库中暂无「${assignedBrand}」可匹配门店`;
    const displayDistanceSummary =
      distanceKm != null
        ? routingMethod === "amap_driving"
          ? `，驾车距离约 ${distanceKm}km`
          : `，直线距离约 ${distanceKm}km`
        : "";
    const displayTimeSummary =
      drivingDurationMin != null ? `，预计驾车约 ${drivingDurationMin} 分钟` : "";

    res.json({
      requestId,
      ok: true,
      message: `Demo 已记录预约信息（mock 流程，不触发真实顾问接单），${displayStoreSummary}${displayDistanceSummary}${displayTimeSummary}。如需真实预约，请前往官方预约页。`,
      routing: {
        inferredBrand: assignedBrand,
        inferenceSource,
        llmConfidence: llmResult?.confidence ?? null,
        llmReason: llmResult?.reason || null,
        assignedStore: assignedStore
          ? {
              id: assignedStore.id,
              brand: assignedStore.brand,
              name: assignedStore.name,
              city: assignedStore.city,
              address: assignedStore.address,
              phone: assignedStore.phone,
              mapQuery: assignedStore.mapQuery,
            }
          : null,
        method: routingMethod,
        distanceKm,
        drivingDurationMin,
        officialAppointmentUrl,
        leadScore: leadIntelligence.score,
        leadStage: leadIntelligence.stage,
        leadPriority: leadIntelligence.priority,
        nextBestActions: leadIntelligence.nextBestActions,
        advisor,
        matchedRightsTitle: matchedRights?.title || null,
        crmSyncReady: crmPayload.syncReady,
        crmSyncStatus: crmSync.status,
      },
      crm: crmPayload,
      crmSync,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "提交失败，请稍后重试。",
      requestId: getRequestId(req),
    });
  }
});

app.post("/api/chat", async (req, res) => {
  try {
    const requestId = getRequestId(req);
    const limitState = applyRateLimit(
      rateLimiters.chat,
      `${getClientIp(req)}:chat`,
      CHAT_RATE_LIMIT_MAX,
      CHAT_RATE_LIMIT_WINDOW_MS
    );
    if (!limitState.ok) {
      return res.status(429).json({
        error: "消息发送过于频繁，请稍后再试。",
        requestId,
        retryAfterSec: Math.ceil(limitState.retryAfterMs / 1000),
      });
    }

    const { message, sessionId: incomingSession, mode: forcedMode } = req.body || {};
    const text = typeof message === "string" ? message.trim() : "";
    if (!text) {
      return res.status(400).json({ error: "message 不能为空。", requestId });
    }

    const llm = llmConfig();
    const sessionId = getOrCreateSession(
      typeof incomingSession === "string" ? incomingSession : null,
      "chat"
    );
    const session = sessions.get(sessionId);
    const hasForcedMode =
      forcedMode === "recommendation" ||
      forcedMode === "comparison" ||
      forcedMode === "service";
    const mode =
      forcedMode === "recommendation" ||
      forcedMode === "comparison" ||
      forcedMode === "service"
        ? forcedMode
        : resolveTurnMode(text, session);

    const client = getOpenAI();
    const storesPayload = readStoresPayload();
    let turn =
      hasForcedMode || !client
        ? await runAgentTurn({
            client,
            model: client && llm.apiKey ? llm.model : "",
            temperature: effectiveTemperature(llm),
            session,
            message: text,
            forcedMode: mode,
            storesPayload,
          })
        : await runReActTurn({
            client,
            model: llm.apiKey ? llm.model : "",
            session,
            message: text,
            storesPayload,
          });

    if (client && !hasForcedMode && shouldFallbackFromReActTurn(turn)) {
      turn = await runAgentTurn({
        client: null,
        model: "",
        temperature: effectiveTemperature(llm),
        session,
        message: text,
        forcedMode: mode,
        storesPayload,
      });
    }

    if (client && llm.apiKey) {
      markLLMSuccess();
    }

    session.messages = trimSession(session.messages);
    await persistSessions();
    await persistConversationEvent({
      route: "/api/chat",
      requestId,
      sessionId,
      userMessage: text,
      assistantReply: turn.reply,
      mode: turn.mode,
      structured: turn.structured,
      agent: turn.agent,
    });

    // 转化漏斗埋点
    try {
      const telemetry = extractTurnTelemetry(turn);
      const record = {
        ts: new Date().toISOString(),
        sessionId,
        requestId,
        route: "/api/chat",
        mode: turn.mode,
        responseSource: turn.agent?.responseSource || (llm.apiKey ? "llm" : "local"),
        status:
          turn.agent?.responseSource === "local" && llm.apiKey ? "fallback" : "completed",
        toolsUsed: telemetry.toolsUsed,
        agentTurns: telemetry.agentTurns,
        totalMs: telemetry.totalMs,
        hasStructured: !!turn.structured,
        agentRelease: AGENT_RELEASE,
        promptVersion: PROMPT_VERSION,
        policyVersion: POLICY_VERSION,
        evalDatasetVersion: EVAL_DATASET_VERSION,
        ip: getClientIp(req),
      };
      await persistAnalyticsEvent(record);
    } catch (_) {}

    res.json({
      reply: turn.reply,
      mode: turn.mode,
      sessionId,
      structured: turn.structured,
      agent: turn.agent,
      requestId,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: error.message || "服务错误。",
      requestId: getRequestId(req),
    });
  }
});

// ─── SSE 流式对话端点（ReAct Agent）─────────────────────────────
app.post("/api/chat/stream", async (req, res) => {
  const requestId = getRequestId(req);
  const { message, sessionId: clientSessionId } = req.body || {};
  const text = typeof message === "string" ? message.trim() : "";
  if (!text) {
    return res.status(400).json({ error: "message is required", requestId });
  }

  // 获取或创建 session
  const limitState = applyRateLimit(
    rateLimiters.chat,
    `${getClientIp(req)}:chat`,
    CHAT_RATE_LIMIT_MAX,
    CHAT_RATE_LIMIT_WINDOW_MS
  );
  if (!limitState.ok) {
    return res.status(429).json({
      error: "消息发送过于频繁，请稍后再试。",
      requestId,
      retryAfterSec: Math.ceil(limitState.retryAfterMs / 1000),
    });
  }
  const sessionId = getOrCreateSession(
    typeof clientSessionId === "string" ? clientSessionId : null,
    "chat"
  );
  const session = sessions.get(sessionId);

  // 建立 SSE 连接
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  function sendEvent(eventType, data) {
    res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  async function finishStreamTurn(result, options = {}) {
    session.messages = trimSession(session.messages);
    await persistSessions();
    await persistConversationEvent({
      route: "/api/chat/stream",
      requestId,
      sessionId,
      userMessage: text,
      assistantReply: result.reply,
      mode: result.mode,
      structured: result.structured,
      agent: result.agent,
      stream: true,
    });

    try {
      const telemetry = extractTurnTelemetry(result);
      await persistAnalyticsEvent({
        ts: new Date().toISOString(),
        sessionId,
        requestId,
        route: "/api/chat/stream",
        mode: result.mode,
        responseSource: result.agent?.responseSource || (llm.apiKey ? "llm" : "local"),
        status:
          result.agent?.responseSource === "local" && llm.apiKey ? "fallback" : "completed",
        toolsUsed: telemetry.toolsUsed,
        agentTurns: telemetry.agentTurns,
        totalMs: telemetry.totalMs,
        hasStructured: !!result.structured,
        agentRelease: AGENT_RELEASE,
        promptVersion: PROMPT_VERSION,
        policyVersion: POLICY_VERSION,
        evalDatasetVersion: EVAL_DATASET_VERSION,
        stream: true,
        ip: getClientIp(req),
      });
    } catch (_) {}

    if (options.markSuccess === true) {
      markLLMSuccess();
    }

    sendEvent("done", {
      reply: result.reply,
      sessionId,
      requestId,
      mode: result.mode,
      structured: result.structured,
      agent: result.agent,
      meta: result.meta,
      profile: result.profile,
    });
  }

  const { apiKey, baseURL, model } = llmConfig();
  const client = getOpenAI();
  if (!apiKey || !client) {
    try {
      const fallback = await runAgentTurn({
        client: null,
        model: "",
        temperature: effectiveTemperature({ apiKey, baseURL, model }),
        session,
        message: text,
        storesPayload: readStoresPayload(),
      });
      await finishStreamTurn(fallback);
    } catch (error) {
      console.error("[stream fallback error]", error);
      sendEvent("error", { message: error.message || "鏈嶅姟閿欒", requestId, sessionId });
    }
    return res.end();
  }
  /* legacy unreachable branches removed
  if (!apiKey) {
    sendEvent("error", { message: "LLM 未配置，请检查 .env" });
    return res.end();
  }

  const client = getOpenAI();
  if (!client) {
    const fallback = await runAgentTurn({
      client: null,
      model: "",
      temperature: effectiveTemperature({ apiKey, baseURL, model }),
      session,
      message: text,
      storesPayload: readStoresPayload(),
    });
    await finishStreamTurn(fallback);
    return res.end();
  }
  if (!client) {
    sendEvent("error", {
      message: llmCircuitOpen() ? "LLM 暂时不可用，请稍后再试" : "LLM 客户端初始化失败",
      requestId,
      sessionId,
    });
    return res.end();
  }

  */
  try {
    // 获取附近门店信息
    let storesPayload = { meta: {}, stores: [] };
    try {
      storesPayload = readStoresPayload();
    } catch (_) {}

    let result = await runReActTurn({
      client,
      model,
      session,
      message: text,
      storesPayload,
      onStep: (step) => {
        // 实时推送思考过程
        sendEvent("step", step);
      },
    });

    if (shouldFallbackFromReActTurn(result)) {
      result = await runAgentTurn({
        client: null,
        model: "",
        temperature: effectiveTemperature({ apiKey, baseURL, model }),
        session,
        message: text,
        forcedMode: resolveTurnMode(text, session),
        storesPayload,
      });
    }

    await finishStreamTurn(result, { markSuccess: true });
    return;

    /* legacy unreachable persistence/send path removed
    session.messages = trimSession(session.messages);
    await persistSessions();
    await persistConversationEvent({
      route: "/api/chat/stream",
      requestId,
      sessionId,
      userMessage: text,
      assistantReply: result.reply,
      mode: result.mode,
      structured: result.structured,
      agent: result.agent,
      stream: true,
    });

    // 转化漏斗埋点
    try {
      const record = {
        ts: new Date().toISOString(),
        sessionId,
        requestId,
        route: "/api/chat/stream",
        mode: result.mode,
        responseSource: result.agent?.responseSource || (llm.apiKey ? "llm" : "local"),
        status:
          result.agent?.responseSource === "local" && llm.apiKey ? "fallback" : "completed",
        toolsUsed: (result.meta?.trace || []).map((t) => t.action).filter(Boolean),
        agentTurns: result.meta?.turns ?? 0,
        totalMs: result.meta?.totalMs ?? 0,
        hasStructured: !!result.structured,
        agentRelease: AGENT_RELEASE,
        promptVersion: PROMPT_VERSION,
        policyVersion: POLICY_VERSION,
        evalDatasetVersion: EVAL_DATASET_VERSION,
        stream: true,
        ip: getClientIp(req),
      };
      await persistAnalyticsEvent(record);
    } catch (_) {}

    markLLMSuccess();
    sendEvent("done", {
      reply: result.reply,
      sessionId,
      requestId,
      mode: result.mode,
      structured: result.structured,
      agent: result.agent,
      meta: result.meta,
      profile: result.profile,
    });
    */
  } catch (error) {
    console.error("[stream error]", error);
    try {
      const fallback = await runAgentTurn({
        client: null,
        model: "",
        temperature: effectiveTemperature({ apiKey, baseURL, model }),
        session,
        message: text,
        storesPayload: readStoresPayload(),
      });
      await finishStreamTurn(fallback);
      return;
    } catch (_) {}
    sendEvent("error", { message: error.message || "服务错误" });
  } finally {
    res.end();
  }
});

// ─── 配置器 Agent 端点 ────────────────────────────────────────
app.post("/api/configurator", async (req, res) => {
  const requestId = getRequestId(req);
  try {
    const { message, sessionId: clientSessionId } = req.body || {};
    const text = typeof message === "string" ? message.trim() : "";
    if (!text) {
      return res.status(400).json({ error: "message is required", requestId });
    }
    const sessionId = getOrCreateSession(
      typeof clientSessionId === "string" ? clientSessionId : null,
      "configurator"
    );
    const session = sessions.get(sessionId);
    const llm = llmConfig();
    const client = getOpenAI();
    const result = await runConfiguratorTurn({
      client,
      model: llm.apiKey ? llm.model : "",
      session,
      message: text,
    });
    session.messages = session.messages || [];
    session.messages.push({ role: "user", content: text });
    session.messages.push({ role: "assistant", content: result.reply, mode: "configurator" });
    session.messages = trimSession(session.messages);
    await persistSessions();
    await persistConversationEvent({
      route: "/api/configurator",
      requestId,
      sessionId,
      userMessage: text,
      assistantReply: result.reply,
      mode: "configurator",
      structured: result.configSummary || result.configState || null,
      agent: {
        engine: "configurator",
        ...(result.agent || {}),
        stage: result.stage || result.agent?.stage || getConfiguratorStage(result.configState),
      },
    });
    try {
      const telemetry = extractTurnTelemetry(result);
      await persistAnalyticsEvent({
        ts: new Date().toISOString(),
        sessionId,
        requestId,
        route: "/api/configurator",
        mode: "configurator",
        responseSource: result.agent?.responseSource || "local",
        status: "completed",
        toolsUsed: telemetry.toolsUsed,
        agentTurns: telemetry.agentTurns || 1,
        totalMs: telemetry.totalMs || result.durationMs || 0,
        hasStructured: Boolean(result.configSummary || result.configState),
        agentRelease: AGENT_RELEASE,
        promptVersion: PROMPT_VERSION,
        policyVersion: POLICY_VERSION,
        evalDatasetVersion: EVAL_DATASET_VERSION,
        ip: getClientIp(req),
      });
    } catch (_) {}
    res.json({
      reply: result.reply,
      mode: "configurator",
      sessionId,
      stage: result.stage,
      config: result.config,
      structured: result.configSummary || result.configState || null,
      configSummary: result.configSummary || null,
      configState: result.configState || null,
      choices: result.choices || null,
      agent: result.agent || null,
      requestId,
    });
  } catch (error) {
    console.error("[configurator error]", error);
    res.status(500).json({ error: error.message || "服务错误", requestId });
  }
});

// ─── 转化漏斗分析端点 ─────────────────────────────────────────
app.get("/api/analytics", async (req, res) => {
  try {
    const records = typeof storage.listAnalyticsEvents === "function"
      ? await storage.listAnalyticsEvents(500)
      : [];
    const byMode = {};
    const byTool = {};
    const byPromptVersion = {};
    let totalTurns = 0;
    let totalMs = 0;
    for (const r of records) {
      byMode[r.mode || "unknown"] = (byMode[r.mode || "unknown"] || 0) + 1;
      byPromptVersion[r.promptVersion || "unknown"] =
        (byPromptVersion[r.promptVersion || "unknown"] || 0) + 1;
      for (const t of r.toolsUsed || []) {
        byTool[t] = (byTool[t] || 0) + 1;
      }
      totalTurns += r.agentTurns || 0;
      totalMs += r.totalMs || 0;
    }
    res.json({
      total: records.length,
      byMode,
      byTool,
      byPromptVersion,
      avgTurns: records.length ? +(totalTurns / records.length).toFixed(2) : 0,
      avgMs: records.length ? Math.round(totalMs / records.length) : 0,
      storageProvider: storage.kind,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/debug/conversation-events", async (req, res) => {
  let access = null;
  try {
    access = await requireOpsAccess(req, res, {
      action: "conversation_replay.read",
      resource: "conversation_events",
    });
    if (!access) return;
    const requestedLimit = Number(req.query.limit || 100);
    const limit = Math.max(1, Math.min(500, Number.isFinite(requestedLimit) ? requestedLimit : 100));
    const sessionId =
      typeof req.query.sessionId === "string" && req.query.sessionId.trim()
        ? req.query.sessionId.trim()
        : null;
    const masked = shouldMaskDebugOutput(req, access);
    const items = typeof storage.listConversationEvents === "function"
      ? await storage.listConversationEvents(limit, sessionId)
      : [];
    await appendOpsAudit(req, access, {
      action: "conversation_replay.read",
      resource: "conversation_events",
      outcome: "success",
      metadata: {
        sessionId,
        limit,
        masked,
        count: items.length,
      },
    });
    res.json({
      storageProvider: storage.kind,
      sessionId,
      limit,
      masked,
      count: items.length,
      items: masked ? items.map(maskConversationEvent) : items,
    });
  } catch (error) {
    if (access) {
      await appendOpsAudit(req, access, {
        action: "conversation_replay.read",
        resource: "conversation_events",
        outcome: "error",
        metadata: {
          error: error.message || "failed to list conversation events",
        },
      });
    }
    res.status(500).json({ error: error.message || "failed to list conversation events" });
  }
});

app.get("/api/agent/readiness", async (req, res) => {
  let access = null;
  try {
    access = await requireOpsAccess(req, res, {
      action: "agent_readiness.read",
      resource: "agent_readiness",
    });
    if (!access) return;
    const versions = {
      agentRelease: AGENT_RELEASE,
      promptVersion: PROMPT_VERSION,
      policyVersion: POLICY_VERSION,
      evalDatasetVersion: EVAL_DATASET_VERSION,
      dataAdapterVersion: DATA_ADAPTER_VERSION,
    };
    const analyticsRecords =
      typeof storage.listAnalyticsEvents === "function"
        ? await storage.listAnalyticsEvents(1000)
        : undefined;
    const report = buildAgentReadinessReport({
      backendDir: __dirname,
      leadsDir,
      sessions,
      storageProvider: storage.kind,
      llm: llmConfig(),
      storesPayload: readStoresPayload(),
      businessDataStatus: getBusinessDataStatus(),
      versions,
      analyticsRecords,
      leadRecords:
        typeof storage.listLeadRecords === "function"
          ? await storage.listLeadRecords(1000)
          : undefined,
      sessionTtlMs: SESSION_TTL_MS,
      maxActiveSessions: MAX_ACTIVE_SESSIONS,
      limits: {
        chat: {
          max: CHAT_RATE_LIMIT_MAX,
          windowMs: CHAT_RATE_LIMIT_WINDOW_MS,
        },
        testDrive: {
          max: TEST_DRIVE_RATE_LIMIT_MAX,
          windowMs: TEST_DRIVE_RATE_LIMIT_WINDOW_MS,
        },
      },
    });
    await appendOpsAudit(req, access, {
      action: "agent_readiness.read",
      resource: "agent_readiness",
      outcome: "success",
      metadata: {
        overallScore: report.overallScore,
      },
    });
    res.json(report);
  } catch (error) {
    if (access) {
      await appendOpsAudit(req, access, {
        action: "agent_readiness.read",
        resource: "agent_readiness",
        outcome: "error",
        metadata: {
          error: error.message,
        },
      });
    }
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/agent/eval", async (req, res) => {
  try {
    res.json(await currentEvalReport());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/business-data/status", (req, res) => {
  try {
    res.json({
      generatedAt: new Date().toISOString(),
      version: DATA_ADAPTER_VERSION,
      sources: getBusinessDataStatus(),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/business-data/refresh", async (req, res) => {
  let access = null;
  try {
    access = await requireOpsAccess(req, res, {
      action: "business_data.refresh",
      resource: "business_data",
    });
    if (!access) return;

    const requestedKinds = Array.isArray(req.body?.kinds)
      ? req.body.kinds.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    const results = await refreshBusinessData({
      kinds: requestedKinds.length ? requestedKinds : undefined,
      reason: "ops_manual_refresh",
    });

    await appendOpsAudit(req, access, {
      action: "business_data.refresh",
      resource: "business_data",
      outcome: "success",
      metadata: {
        requestedKinds,
        refreshed: results.filter((item) => item.refreshed).length,
        failed: results.filter((item) => item.ok === false).length,
      },
    });

    res.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      version: DATA_ADAPTER_VERSION,
      results,
      sources: getBusinessDataStatus(),
    });
  } catch (error) {
    if (access) {
      await appendOpsAudit(req, access, {
        action: "business_data.refresh",
        resource: "business_data",
        outcome: "error",
        metadata: {
          error: error.message,
        },
      });
    }
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/ops/config-status", async (req, res) => {
  let access = null;
  try {
    access = await requireOpsAccess(req, res, {
      action: "config_status.read",
      resource: "config_status",
    });
    if (!access) return;
    const report = currentConfigReport();
    await appendOpsAudit(req, access, {
      action: "config_status.read",
      resource: "config_status",
      outcome: "success",
      metadata: {
        warnings: report.counts.warning,
        errors: report.counts.error,
      },
    });
    res.json(report);
  } catch (error) {
    if (access) {
      await appendOpsAudit(req, access, {
        action: "config_status.read",
        resource: "config_status",
        outcome: "error",
        metadata: {
          error: error.message,
        },
      });
    }
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/db/health", async (req, res) => {
  try {
    const databaseUrlConfigured = Boolean(getDatabaseUrl());
    if (!databaseUrlConfigured) {
      return res.json({
        ok: false,
        configured: false,
        storageProvider: storage.kind,
        message: "DATABASE_URL is not configured",
      });
    }

    const db = await postgresQuery(
      `
        SELECT current_database() AS database_name,
               current_user AS current_user,
               NOW() AS now
      `
    );
    const extension = await postgresQuery(
      `
        SELECT EXISTS (
          SELECT 1 FROM pg_extension WHERE extname = 'vector'
        ) AS enabled
      `
    );
    res.json({
      ok: true,
      configured: true,
      storageProvider: storage.kind,
      database: db.rows[0]?.database_name || null,
      currentUser: db.rows[0]?.current_user || null,
      now: db.rows[0]?.now || null,
      vectorEnabled: extension.rows[0]?.enabled === true,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      configured: Boolean(getDatabaseUrl()),
      storageProvider: storage.kind,
      error: error.message,
    });
  }
});

app.get("/api/knowledge/search", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const limit = Math.max(1, Math.min(8, Number(req.query.limit || 5)));
    const provider = getKnowledgeProvider();

    if (!q) {
      return res.status(400).json({ error: "q is required" });
    }

    let items = [];
    if (provider === "postgres") {
      try {
        items = await searchKnowledgeByVectorInPostgres({ message: q, limit });
      } catch (error) {
        console.warn("[knowledge-search] vector query failed:", error.message);
      }
      if (!items.length) {
        items = await searchKnowledgeInPostgres({ message: q, limit });
      }
    } else {
      items = await searchServiceKnowledgeRuntime({
        message: q,
        profile: {},
        limit,
      });
    }

    res.json({
      ok: true,
      provider,
      query: q,
      count: items.length,
      items,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/knowledge/status", async (req, res) => {
  try {
    res.json(await getKnowledgeStatus());
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error.message,
    });
  }
});

app.get("/api/crm/outbox", async (req, res) => {
  let access = null;
  try {
    access = await requireOpsAccess(req, res, {
      action: "crm_outbox.read",
      resource: "crm_outbox",
    });
    if (!access) return;
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const payload = {
      generatedAt: new Date().toISOString(),
      ...(await storage.listCrmOutbox(limit)),
    };
    await appendOpsAudit(req, access, {
      action: "crm_outbox.read",
      resource: "crm_outbox",
      outcome: "success",
      metadata: {
        limit,
        count: Array.isArray(payload.items) ? payload.items.length : 0,
      },
    });
    res.json(payload);
  } catch (error) {
    if (access) {
      await appendOpsAudit(req, access, {
        action: "crm_outbox.read",
        resource: "crm_outbox",
        outcome: "error",
        metadata: {
          error: error.message,
        },
      });
    }
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/crm/sync/run", async (req, res) => {
  let access = null;
  try {
    access = await requireOpsAccess(req, res, {
      action: "crm_sync.run",
      resource: "crm_outbox",
    });
    if (!access) return;
    const limit = Math.min(50, Math.max(1, Number(req.body?.limit || 10)));
    const result = await storage.syncCrmOutbox({
      limit,
      force: req.body?.force === true,
    });
    const payload = {
      ok: true,
      generatedAt: new Date().toISOString(),
      ...result,
      summary: await getStorageCrmSyncSummary(),
    };
    await appendOpsAudit(req, access, {
      action: "crm_sync.run",
      resource: "crm_outbox",
      outcome: "success",
      metadata: {
        limit,
        force: req.body?.force === true,
        attempted: result.attempted,
        sent: result.sent,
        acknowledged: result.acknowledged,
        synced: result.synced,
        deadLetter: result.deadLetter,
        failed: result.failed,
        skipped: result.skipped,
      },
    });
    res.json(payload);
  } catch (error) {
    if (access) {
      await appendOpsAudit(req, access, {
        action: "crm_sync.run",
        resource: "crm_outbox",
        outcome: "error",
        metadata: {
          error: error.message,
        },
      });
    }
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/crm/ack", async (req, res) => {
  let access = null;
  try {
    access = await requireOpsAccess(req, res, {
      action: "crm_ack.write",
      resource: "crm_outbox",
    });
    if (!access) return;

    if (typeof storage.acknowledgeCrmOutbox !== "function") {
      return res.status(501).json({ error: "crm ack is not supported by current storage provider" });
    }

    const status = String(req.body?.status || "acknowledged").trim().toLowerCase();
    const result = await storage.acknowledgeCrmOutbox({
      outboxId: req.body?.outboxId ? String(req.body.outboxId) : null,
      externalLeadId: req.body?.externalLeadId ? String(req.body.externalLeadId) : null,
      status,
      message: req.body?.message ? String(req.body.message) : null,
      metadata: req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : null,
    });

    if (!result.ok) {
      return res.status(404).json(result);
    }

    await appendOpsAudit(req, access, {
      action: "crm_ack.write",
      resource: "crm_outbox",
      outcome: "success",
      metadata: {
        outboxId: req.body?.outboxId || null,
        externalLeadId: req.body?.externalLeadId || null,
        status,
      },
    });

    res.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      ...result,
    });
  } catch (error) {
    if (access) {
      await appendOpsAudit(req, access, {
        action: "crm_ack.write",
        resource: "crm_outbox",
        outcome: "error",
        metadata: {
          error: error.message,
        },
      });
    }
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/crm/callback", async (req, res) => {
  let access = null;
  try {
    access = await requireOpsAccess(req, res, {
      action: "crm_callback.write",
      resource: "crm_outbox",
    });
    if (!access) return;

    if (typeof storage.acknowledgeCrmOutbox !== "function") {
      return res.status(501).json({ error: "crm callback is not supported by current storage provider" });
    }

    const callback = req.body || {};
    const result = await storage.acknowledgeCrmOutbox({
      outboxId: callback.outboxId ? String(callback.outboxId) : null,
      externalLeadId: callback.externalLeadId ? String(callback.externalLeadId) : null,
      status: String(callback.status || callback.result || "synced").trim().toLowerCase(),
      message: callback.message ? String(callback.message) : callback.reason ? String(callback.reason) : null,
      metadata: callback,
    });

    if (!result.ok) {
      return res.status(404).json(result);
    }

    await appendOpsAudit(req, access, {
      action: "crm_callback.write",
      resource: "crm_outbox",
      outcome: "success",
      metadata: {
        outboxId: callback.outboxId || null,
        externalLeadId: callback.externalLeadId || null,
        status: callback.status || callback.result || "synced",
      },
    });

    res.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      callbackAccepted: true,
      ...result,
    });
  } catch (error) {
    if (access) {
      await appendOpsAudit(req, access, {
        action: "crm_callback.write",
        resource: "crm_outbox",
        outcome: "error",
        metadata: {
          error: error.message,
        },
      });
    }
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/ops/audit-log", async (req, res) => {
  let access = null;
  try {
    access = await requireOpsAccess(req, res, {
      action: "audit_log.read",
      resource: "ops_audit_log",
    });
    if (!access) return;
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
    const payload = {
      generatedAt: new Date().toISOString(),
      summary:
        typeof storage.getAuditSummary === "function" ? await storage.getAuditSummary() : null,
      items:
        typeof storage.listAuditEvents === "function" ? await storage.listAuditEvents(limit) : [],
    };
    await appendOpsAudit(req, access, {
      action: "audit_log.read",
      resource: "ops_audit_log",
      outcome: "success",
      metadata: {
        limit,
        count: Array.isArray(payload.items) ? payload.items.length : 0,
      },
    });
    res.json(payload);
  } catch (error) {
    if (access) {
      await appendOpsAudit(req, access, {
        action: "audit_log.read",
        resource: "ops_audit_log",
        outcome: "error",
        metadata: {
          error: error.message,
        },
      });
    }
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/ops/dashboard", async (req, res) => {
  let access = null;
  try {
    access = await requireOpsAccess(req, res, {
      action: "ops_dashboard.read",
      resource: "ops_dashboard",
    });
    if (!access) return;

    const analyticsRecords =
      typeof storage.listAnalyticsEvents === "function"
        ? await storage.listAnalyticsEvents(1000)
        : [];
    const leadRecords =
      typeof storage.listLeadRecords === "function"
        ? await storage.listLeadRecords(1000)
        : [];
    const crmSummary = await getStorageCrmSyncSummary();
    const knowledgeStatus = await getKnowledgeStatus();
    const evalReport = await currentEvalReport();

    const payload = buildOpsDashboard({
      analyticsRecords,
      leadRecords,
      crmSummary,
      businessDataStatus: getBusinessDataStatus(),
      knowledgeStatus,
      evalReport,
    });

    await appendOpsAudit(req, access, {
      action: "ops_dashboard.read",
      resource: "ops_dashboard",
      outcome: "success",
      metadata: {
        totalRuns: payload.traffic.totalRuns,
        totalLeads: payload.funnel.totalLeads,
        releaseStatus: payload.release.status,
      },
    });

    res.json(payload);
  } catch (error) {
    if (access) {
      await appendOpsAudit(req, access, {
        action: "ops_dashboard.read",
        resource: "ops_dashboard",
        outcome: "error",
        metadata: {
          error: error.message,
        },
      });
    }
    res.status(500).json({ error: error.message });
  }
});

async function startServer() {
  const businessDataInit = await initializeBusinessData();
  await loadPersistedSessions();
  await runRetentionCleanup("startup");
  const configReport = currentConfigReport();
  const blockingErrors = getBlockingConfigErrors(configReport);
  if (blockingErrors.length) {
    console.error(
      `[startup] refusing to start due to ${blockingErrors.length} blocking config errors`
    );
    for (const item of blockingErrors) {
      console.error(`[startup] ERROR ${item.id}: ${item.detail}`);
    }
    process.exit(1);
  }

  const businessDataRefresh = startBusinessDataRefreshLoop();

  app.listen(PORT, () => {
    console.log(`API listening on http://localhost:${PORT}`);
    console.log(`[storage] provider=${storage.kind}`);
    const businessFailures = businessDataInit.filter((item) => item.ok === false);
    if (businessFailures.length) {
      console.warn(
        `[business-data] startup fallback: ${businessFailures
          .map((item) => `${item.kind}:${item.error}`)
          .join(" | ")}`
      );
    }
    if (businessDataRefresh.enabled) {
      console.log(
        `[business-data] remote refresh enabled every ${Math.round(
          businessDataRefresh.intervalMs / 1000
        )}s for ${businessDataRefresh.kinds.join(", ")}`
      );
    }
    const { apiKey, baseURL, model } = llmConfig();
    if (apiKey) {
      console.log(`[LLM] ready | provider=${baseURL || "default"} | model=${model}`);
    } else {
      console.warn("[LLM] no api key detected in backend/.env, fallback mode enabled");
    }
    if (String(process.env.AMAP_REST_KEY || "").trim()) {
      console.log("[AMAP] route planning enabled");
    }
    if (configReport.counts.warning > 0 || configReport.counts.error > 0) {
      console.warn(
        `[config] ${configReport.counts.error} errors, ${configReport.counts.warning} warnings`
      );
      for (const item of configReport.checks.filter((check) => check.status !== "ok")) {
        console.warn(`[config] ${item.status.toUpperCase()} ${item.id}: ${item.detail}`);
      }
    }
  });
}

startServer().catch((error) => {
  console.error("[startup] failed to initialize server:", error);
  process.exit(1);
});

const crmSyncTimer = setInterval(() => {
  storage.syncCrmOutbox({ limit: 5 }).catch((error) => {
    console.warn("[crm] scheduled sync failed:", error.message);
  });
}, CRM_SYNC_INTERVAL_MS);

if (typeof crmSyncTimer.unref === "function") {
  crmSyncTimer.unref();
}

const retentionTimer = setInterval(() => {
  runRetentionCleanup("scheduled");
}, retentionPolicy.cleanupIntervalMs);

if (typeof retentionTimer.unref === "function") {
  retentionTimer.unref();
}
