const fs = require("fs");
const path = require("path");
const { createHmac, randomUUID } = require("crypto");
const { CRM_OUTBOX_STATUS, resolveCrmProvider } = require("./crm/types");

const CRM_SYNC_MAX_ATTEMPTS = Math.max(1, Number(process.env.CRM_SYNC_MAX_ATTEMPTS || 5));
const CRM_SYNC_TIMEOUT_MS = Math.max(1000, Number(process.env.CRM_SYNC_TIMEOUT_MS || 5000));
const CRM_SYNC_RETRY_BASE_MS = Math.max(
  5000,
  Number(process.env.CRM_SYNC_RETRY_BASE_MS || 30000)
);
const CRM_SYNC_RETRY_MAX_MS = Math.max(
  CRM_SYNC_RETRY_BASE_MS,
  Number(process.env.CRM_SYNC_RETRY_MAX_MS || 15 * 60 * 1000)
);

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function outboxFilePath(dataDir) {
  return path.join(dataDir, "crm-outbox.json");
}

function attemptsFilePath(dataDir) {
  return path.join(dataDir, "crm-attempts.jsonl");
}

function readOutbox(dataDir) {
  const filePath = outboxFilePath(dataDir);
  if (!fs.existsSync(filePath)) {
    return [];
  }

  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(raw?.items) ? raw.items : [];
  } catch (_) {
    return [];
  }
}

function writeOutbox(dataDir, items) {
  ensureDir(dataDir);
  fs.writeFileSync(
    outboxFilePath(dataDir),
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        items,
      },
      null,
      2
    ),
    "utf8"
  );
}

function appendAttemptLog(dataDir, record) {
  ensureDir(dataDir);
  fs.appendFileSync(attemptsFilePath(dataDir), `${JSON.stringify(record)}\n`, "utf8");
}

function readAttemptLogs(dataDir) {
  const filePath = attemptsFilePath(dataDir);
  if (!fs.existsSync(filePath)) {
    return [];
  }

  return fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean);
}

function writeAttemptLogs(dataDir, records) {
  ensureDir(dataDir);
  fs.writeFileSync(
    attemptsFilePath(dataDir),
    records.map((item) => JSON.stringify(item)).join("\n") + (records.length ? "\n" : ""),
    "utf8"
  );
}

function maskPhone(phone) {
  const raw = String(phone || "");
  if (raw.length < 7) return raw;
  return `${raw.slice(0, 3)}****${raw.slice(-4)}`;
}

function webhookConfig() {
  const url = String(process.env.CRM_WEBHOOK_URL || process.env.LEAD_WEBHOOK_URL || "").trim();
  const secret = String(process.env.CRM_WEBHOOK_SECRET || "").trim();
  return {
    url,
    secret,
    enabled: Boolean(url),
    timeoutMs: CRM_SYNC_TIMEOUT_MS,
  };
}

function signBody(body, secret) {
  if (!secret) return "";
  return createHmac("sha256", secret).update(body).digest("hex");
}

function retryDelayMs(attempts) {
  const next = CRM_SYNC_RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1);
  return Math.min(CRM_SYNC_RETRY_MAX_MS, next);
}

function summarizeRecord(item) {
  return {
    id: item.id,
    status: item.status,
    transportStatus: item.transportStatus || item.status,
    attempts: item.attempts,
    syncEnabled: item.syncEnabled,
    provider: item.provider || resolveCrmProvider(),
    lastError: item.lastError || null,
    lastHttpStatus: item.lastHttpStatus ?? null,
    lastAttemptAt: item.lastAttemptAt || null,
    nextAttemptAt: item.nextAttemptAt || null,
    sentAt: item.sentAt || null,
    ackAt: item.ackAt || null,
    syncedAt: item.syncedAt || null,
    deadLetterAt: item.deadLetterAt || null,
  };
}

function enqueueCrmOutbox({ dataDir, payload, lead, requestId }) {
  const config = webhookConfig();
  const now = new Date().toISOString();
  const provider = resolveCrmProvider();
  const item = {
    id: randomUUID(),
    requestId,
    externalLeadId: payload.externalLeadId,
    payloadVersion: payload.payloadVersion,
    source: payload.source,
    stage: payload.stage,
    priority: payload.priority,
    score: payload.score,
    createdAt: now,
    updatedAt: now,
    // 新状态机（闭环骨架）
    status: CRM_OUTBOX_STATUS.PENDING,
    transportStatus: null,
    provider,
    attempts: 0,
    nextAttemptAt: now,
    lastAttemptAt: null,
    lastError: null,
    lastHttpStatus: null,
    sentAt: null,
    ackAt: null,
    syncedAt: null,
    deadLetterAt: null,
    // syncEnabled 仍保留（对 webhook provider 有意义），mock provider 默认也为 true
    syncEnabled: config.enabled || provider === "mock",
    customer: {
      name: payload.customer?.name || lead?.name || "",
      phoneMasked: maskPhone(payload.customer?.phone || lead?.phone || ""),
      city: payload.customer?.city || lead?.userCity || null,
    },
    payload,
  };

  const items = readOutbox(dataDir);
  items.unshift(item);
  writeOutbox(dataDir, items.slice(0, 500));
  return item;
}

async function sendRecord(item, config) {
  const body = JSON.stringify(item.payload);
  const headers = {
    "Content-Type": "application/json",
    "X-CRM-Delivery-Id": item.id,
    "X-CRM-Lead-Id": String(item.externalLeadId || ""),
  };
  const signature = signBody(body, config.secret);
  if (signature) {
    headers["X-CRM-Signature"] = signature;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
    const responseText = await response.text();
    if (!response.ok) {
      const error = new Error(
        `crm webhook ${response.status}: ${String(responseText || "").slice(0, 200)}`
      );
      error.httpStatus = response.status;
      throw error;
    }
    return {
      ok: true,
      httpStatus: response.status,
      body: String(responseText || "").slice(0, 200),
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      const timeoutError = new Error(`crm webhook timeout after ${config.timeoutMs}ms`);
      timeoutError.httpStatus = 0;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function syncCrmOutbox({ dataDir, limit = 5, ids = null, force = false } = {}) {
  const config = webhookConfig();
  const { getCrmProvider } = require("./crm/providerRegistry");
  const provider = getCrmProvider();
  const items = readOutbox(dataDir);
  const nowMs = Date.now();
  const touched = {};
  const summary = {
    provider: provider.kind,
    syncEnabled: config.enabled || provider.kind === "mock",
    attempted: 0,
    sent: 0,
    acknowledged: 0,
    synced: 0,
    retried: 0,
    failed: 0,
    deadLetter: 0,
    skipped: 0,
    byId: {},
  };

  let processed = 0;
  for (const item of items) {
    if (processed >= limit) break;
    if (Array.isArray(ids) && ids.length && !ids.includes(item.id)) continue;
    if (![CRM_OUTBOX_STATUS.PENDING, CRM_OUTBOX_STATUS.FAILED].includes(item.status)) continue;
    if (!force && item.nextAttemptAt && new Date(item.nextAttemptAt).getTime() > nowMs) continue;

    processed += 1;
    summary.attempted += 1;
    const updatedAt = new Date().toISOString();

    try {
      const result = await provider.send({ outboxItem: item, payload: item.payload, lead: item.customer });
      item.attempts += 1;
      item.lastAttemptAt = updatedAt;
      item.lastHttpStatus = result.httpStatus ?? null;
      item.lastError = result.error || null;
      item.updatedAt = updatedAt;
      item.provider = provider.kind;
      if (result.ok) {
        item.status = result.nextStatus || CRM_OUTBOX_STATUS.SENT;
        item.transportStatus = item.status;
        item.sentAt = updatedAt;
        item.nextAttemptAt = null;
        summary.sent += 1;
      } else if (item.attempts >= CRM_SYNC_MAX_ATTEMPTS) {
        item.status = CRM_OUTBOX_STATUS.DEAD_LETTER;
        item.transportStatus = CRM_OUTBOX_STATUS.DEAD_LETTER;
        item.deadLetterAt = updatedAt;
        item.nextAttemptAt = null;
        summary.deadLetter += 1;
      } else {
        item.status = CRM_OUTBOX_STATUS.FAILED;
        item.transportStatus = CRM_OUTBOX_STATUS.FAILED;
        item.nextAttemptAt = new Date(Date.now() + retryDelayMs(item.attempts)).toISOString();
        summary.failed += 1;
      }
      appendAttemptLog(dataDir, {
        crmOutboxId: item.id,
        requestId: item.requestId,
        createdAt: updatedAt,
        status: item.status,
        httpStatus: item.lastHttpStatus,
        error: item.lastError,
        provider: provider.kind,
      });
    } catch (error) {
      item.attempts += 1;
      item.lastAttemptAt = updatedAt;
      item.lastHttpStatus = error?.httpStatus ?? null;
      item.lastError = error instanceof Error ? error.message : String(error || "unknown_error");
      item.updatedAt = updatedAt;
      item.provider = provider.kind;
      if (item.attempts >= CRM_SYNC_MAX_ATTEMPTS) {
        item.status = CRM_OUTBOX_STATUS.DEAD_LETTER;
        item.transportStatus = CRM_OUTBOX_STATUS.DEAD_LETTER;
        item.deadLetterAt = updatedAt;
        item.nextAttemptAt = null;
        summary.deadLetter += 1;
      } else {
        item.status = CRM_OUTBOX_STATUS.FAILED;
        item.transportStatus = CRM_OUTBOX_STATUS.FAILED;
        item.nextAttemptAt = new Date(Date.now() + retryDelayMs(item.attempts)).toISOString();
        summary.failed += 1;
      }
      appendAttemptLog(dataDir, {
        crmOutboxId: item.id,
        requestId: item.requestId,
        createdAt: updatedAt,
        status: item.status,
        httpStatus: item.lastHttpStatus,
        error: item.lastError,
        provider: provider.kind,
      });
    }

    touched[item.id] = summarizeRecord(item);
  }

  writeOutbox(dataDir, items);
  summary.byId = touched;
  return summary;
}

function acknowledgeCrmOutbox({ dataDir, outboxId, externalLeadId, status = "acknowledged", message = null, metadata = null }) {
  const items = readOutbox(dataDir);
  const item = items.find((entry) =>
    (outboxId && entry.id === outboxId) || (externalLeadId && entry.externalLeadId === externalLeadId)
  );
  if (!item) {
    return { ok: false, error: "crm_outbox_not_found" };
  }
  const updatedAt = new Date().toISOString();
  item.updatedAt = updatedAt;
  item.lastError = message || null;
  if (status === CRM_OUTBOX_STATUS.ACKNOWLEDGED) {
    item.status = CRM_OUTBOX_STATUS.ACKNOWLEDGED;
    item.transportStatus = CRM_OUTBOX_STATUS.ACKNOWLEDGED;
    item.ackAt = updatedAt;
  } else if (status === CRM_OUTBOX_STATUS.SYNCED) {
    item.status = CRM_OUTBOX_STATUS.SYNCED;
    item.transportStatus = CRM_OUTBOX_STATUS.SYNCED;
    item.syncedAt = updatedAt;
    item.ackAt = item.ackAt || updatedAt;
  } else if (status === CRM_OUTBOX_STATUS.FAILED) {
    item.status = CRM_OUTBOX_STATUS.FAILED;
    item.transportStatus = CRM_OUTBOX_STATUS.FAILED;
    item.nextAttemptAt = new Date(Date.now() + retryDelayMs(item.attempts || 1)).toISOString();
  } else if (status === CRM_OUTBOX_STATUS.DEAD_LETTER) {
    item.status = CRM_OUTBOX_STATUS.DEAD_LETTER;
    item.transportStatus = CRM_OUTBOX_STATUS.DEAD_LETTER;
    item.deadLetterAt = updatedAt;
    item.nextAttemptAt = null;
  }
  appendAttemptLog(dataDir, {
    crmOutboxId: item.id,
    requestId: item.requestId,
    createdAt: updatedAt,
    status: item.status,
    message: message || null,
    metadata: metadata || null,
    provider: item.provider || resolveCrmProvider(),
  });
  writeOutbox(dataDir, items);
  return {
    ok: true,
    item: summarizeRecord(item),
    summary: getCrmSyncSummary({ dataDir }),
  };
}

function getCrmSyncSummary({ dataDir }) {
  const items = readOutbox(dataDir);
  const provider = resolveCrmProvider();
  const config = webhookConfig();
  const counts = items.reduce(
    (acc, item) => {
      acc.total += 1;
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    },
    {
      total: 0,
      [CRM_OUTBOX_STATUS.PENDING]: 0,
      [CRM_OUTBOX_STATUS.SENT]: 0,
      [CRM_OUTBOX_STATUS.ACKNOWLEDGED]: 0,
      [CRM_OUTBOX_STATUS.SYNCED]: 0,
      [CRM_OUTBOX_STATUS.FAILED]: 0,
      [CRM_OUTBOX_STATUS.DEAD_LETTER]: 0,
    }
  );

  return {
    provider,
    enabled: config.enabled || provider === "mock",
    webhookUrlConfigured: config.enabled,
    timeoutMs: config.timeoutMs,
    maxAttempts: CRM_SYNC_MAX_ATTEMPTS,
    retryBaseMs: CRM_SYNC_RETRY_BASE_MS,
    counts,
    recent: items.slice(0, 10).map((item) => ({
      id: item.id,
      externalLeadId: item.externalLeadId,
      status: item.status,
      transportStatus: item.transportStatus || item.status,
      attempts: item.attempts,
      updatedAt: item.updatedAt,
      sentAt: item.sentAt || null,
      ackAt: item.ackAt || null,
      syncedAt: item.syncedAt || null,
      deadLetterAt: item.deadLetterAt || null,
      lastError: item.lastError || null,
      lastHttpStatus: item.lastHttpStatus ?? null,
      provider: item.provider || provider,
      customer: item.customer,
    })),
  };
}

function listCrmOutbox({ dataDir, limit = 20 } = {}) {
  const items = readOutbox(dataDir).slice(0, limit);
  return {
    summary: getCrmSyncSummary({ dataDir }),
    items: items.map((item) => ({
      id: item.id,
      requestId: item.requestId,
      externalLeadId: item.externalLeadId,
      stage: item.stage,
      priority: item.priority,
      score: item.score,
      status: item.status,
      attempts: item.attempts,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      nextAttemptAt: item.nextAttemptAt,
      lastError: item.lastError,
      customer: item.customer,
    })),
  };
}

function parseEventTimeMs(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : 0;
}

function applyCrmRetention({ dataDir, retention }) {
  const summary = {
    crmOutbox: 0,
    crmAttempts: 0,
  };
  const now = Date.now();
  const outboxCutoff = now - retention.crmOutboxMs;
  const attemptCutoff = now - retention.crmAttemptMs;

  const outboxItems = readOutbox(dataDir);
  const keptOutbox = outboxItems.filter((item) => {
    const status = String(item?.status || "");
    if (![CRM_OUTBOX_STATUS.SYNCED, CRM_OUTBOX_STATUS.DEAD_LETTER].includes(status)) {
      return true;
    }
    const ts = parseEventTimeMs(item?.syncedAt || item?.deadLetterAt || item?.updatedAt || item?.createdAt);
    return !ts || ts >= outboxCutoff;
  });
  summary.crmOutbox = Math.max(0, outboxItems.length - keptOutbox.length);
  if (summary.crmOutbox > 0) {
    writeOutbox(dataDir, keptOutbox);
  }

  const attemptItems = readAttemptLogs(dataDir);
  const keptAttempts = attemptItems.filter((item) => {
    const ts = parseEventTimeMs(item?.createdAt || item?.updatedAt || item?.ts);
    return !ts || ts >= attemptCutoff;
  });
  summary.crmAttempts = Math.max(0, attemptItems.length - keptAttempts.length);
  if (summary.crmAttempts > 0) {
    writeAttemptLogs(dataDir, keptAttempts);
  }

  return summary;
}

module.exports = {
  applyCrmRetention,
  enqueueCrmOutbox,
  syncCrmOutbox,
  getCrmSyncSummary,
  listCrmOutbox,
  acknowledgeCrmOutbox,
  summarizeRecord,
  webhookConfig,
  sendRecord,
  retryDelayMs,
  maskPhone,
};
