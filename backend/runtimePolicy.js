const DAY_MS = 24 * 60 * 60 * 1000;

function normalizeBoolEnv(value) {
  return ["1", "true", "yes", "on", "require"].includes(
    String(value || "").trim().toLowerCase()
  );
}

function parsePositiveNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function readRetentionDays(envName, fallbackDays) {
  return Math.max(1, parsePositiveNumber(process.env[envName], fallbackDays));
}

function getRetentionPolicy({ sessionTtlMs } = {}) {
  const resolvedSessionTtlMs = Math.max(
    30 * 60 * 1000,
    parsePositiveNumber(process.env.SESSION_TTL_MS, sessionTtlMs || 24 * 60 * 60 * 1000)
  );
  const replayDays = readRetentionDays("RETENTION_REPLAY_DAYS", 30);
  const leadDays = readRetentionDays("RETENTION_LEAD_DAYS", 180);
  const crmAttemptDays = readRetentionDays("RETENTION_CRM_ATTEMPT_DAYS", 30);
  const crmOutboxDays = readRetentionDays("RETENTION_CRM_OUTBOX_DAYS", crmAttemptDays);
  const auditDays = readRetentionDays("RETENTION_AUDIT_DAYS", 90);
  const cleanupIntervalMs = Math.max(
    60 * 1000,
    parsePositiveNumber(process.env.RETENTION_CLEANUP_INTERVAL_MS, 15 * 60 * 1000)
  );

  return {
    sessionMs: resolvedSessionTtlMs,
    sessionDays: +(resolvedSessionTtlMs / DAY_MS).toFixed(2),
    replayMs: replayDays * DAY_MS,
    replayDays,
    leadMs: leadDays * DAY_MS,
    leadDays,
    crmAttemptMs: crmAttemptDays * DAY_MS,
    crmAttemptDays,
    crmOutboxMs: crmOutboxDays * DAY_MS,
    crmOutboxDays,
    auditMs: auditDays * DAY_MS,
    auditDays,
    cleanupIntervalMs,
  };
}

function getOpsAccessConfig() {
  const nodeEnv = String(process.env.NODE_ENV || "development").trim().toLowerCase() || "development";
  const token = String(process.env.OPS_ACCESS_TOKEN || "").trim();
  const allowLocalDevBypass =
    nodeEnv !== "production" &&
    !normalizeBoolEnv(process.env.OPS_DISABLE_LOCAL_BYPASS);

  return {
    nodeEnv,
    token,
    tokenConfigured: Boolean(token),
    headerName: "x-ops-token",
    actorHeaderName: "x-ops-actor",
    allowLocalDevBypass,
  };
}

module.exports = {
  DAY_MS,
  getOpsAccessConfig,
  getRetentionPolicy,
  normalizeBoolEnv,
};
