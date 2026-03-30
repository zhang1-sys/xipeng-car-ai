const { getOpsAccessConfig, getRetentionPolicy, normalizeBoolEnv } = require("./runtimePolicy");

function addCheck(checks, { id, status, severity, detail }) {
  checks.push({ id, status, severity, detail });
}

function summarizeChecks(checks) {
  const counts = checks.reduce(
    (acc, item) => {
      acc.total += 1;
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    },
    { total: 0, ok: 0, warning: 0, error: 0 }
  );

  return {
    ok: counts.error === 0,
    counts,
  };
}

function buildRuntimeConfigReport(options = {}) {
  const checks = [];
  const storageProvider = String(process.env.STORAGE_PROVIDER || "file").trim().toLowerCase() || "file";
  const nodeEnv = String(process.env.NODE_ENV || "development").trim().toLowerCase() || "development";
  const hasDatabaseUrl = Boolean(String(process.env.DATABASE_URL || "").trim());
  const databaseSsl = normalizeBoolEnv(process.env.DATABASE_SSL);
  const hasLlmKey = Boolean(
    String(
      process.env.MOONSHOT_API_KEY || process.env.KIMI_API_KEY || process.env.OPENAI_API_KEY || ""
    ).trim()
  );
  const hasAllowedOrigins = Boolean(String(process.env.ALLOWED_ORIGINS || "").trim());
  const crmWebhookUrl = String(process.env.CRM_WEBHOOK_URL || process.env.LEAD_WEBHOOK_URL || "").trim();
  const crmWebhookSecret = String(process.env.CRM_WEBHOOK_SECRET || "").trim();
  const hasAmapKey = Boolean(String(process.env.AMAP_REST_KEY || "").trim());
  const opsAccess = getOpsAccessConfig();
  const retention = getRetentionPolicy(options);

  const strictProduction =
    nodeEnv === "production" &&
    (String(process.env.STRICT_PRODUCTION || "1").trim() === "1" ||
      String(process.env.STRICT_PRODUCTION || "").trim().toLowerCase() === "true");

  addCheck(checks, {
    id: "llm_api_key",
    status: hasLlmKey ? "ok" : "warning",
    severity: hasLlmKey ? "info" : "medium",
    detail: hasLlmKey ? "LLM API key configured." : "LLM API key missing; runtime will fall back to local-only responses.",
  });

  addCheck(checks, {
    id: "storage_provider",
    status: ["file", "postgres"].includes(storageProvider) ? "ok" : "error",
    severity: ["file", "postgres"].includes(storageProvider) ? "info" : "high",
    detail: `STORAGE_PROVIDER=${storageProvider}`,
  });

  addCheck(checks, {
    id: "database_url",
    status: storageProvider !== "postgres" || hasDatabaseUrl ? "ok" : "error",
    severity: storageProvider !== "postgres" || hasDatabaseUrl ? "info" : "high",
    detail:
      storageProvider === "postgres"
        ? hasDatabaseUrl
          ? "DATABASE_URL configured for Postgres storage."
          : "DATABASE_URL is required when STORAGE_PROVIDER=postgres."
        : "DATABASE_URL not required in file mode.",
  });

  addCheck(checks, {
    id: "database_ssl",
    status:
      storageProvider !== "postgres" || nodeEnv !== "production" || databaseSsl
        ? "ok"
        : "warning",
    severity:
      storageProvider !== "postgres" || nodeEnv !== "production" || databaseSsl
        ? "info"
        : "medium",
    detail:
      storageProvider === "postgres"
        ? databaseSsl
          ? "DATABASE_SSL enabled for Postgres connections."
          : "DATABASE_SSL disabled."
        : "DATABASE_SSL not used in file mode.",
  });

  addCheck(checks, {
    id: "allowed_origins",
    status: !strictProduction || hasAllowedOrigins ? "ok" : "error",
    severity: !strictProduction || hasAllowedOrigins ? "info" : "high",
    detail:
      hasAllowedOrigins
        ? "ALLOWED_ORIGINS configured."
        : strictProduction
          ? "ALLOWED_ORIGINS is required in production (fail-fast enabled)."
          : "ALLOWED_ORIGINS is empty; CORS defaults will stay permissive in local mode.",
  });

  addCheck(checks, {
    id: "crm_webhook_secret",
    status: !crmWebhookUrl || crmWebhookSecret ? "ok" : "warning",
    severity: !crmWebhookUrl || crmWebhookSecret ? "info" : "medium",
    detail:
      crmWebhookUrl
        ? crmWebhookSecret
          ? "CRM webhook URL and signature secret configured."
          : "CRM webhook URL is configured without CRM_WEBHOOK_SECRET."
        : "CRM webhook not configured; CRM sync stays local/outbox-only.",
  });

  addCheck(checks, {
    id: "amap_rest_key",
    status: hasAmapKey ? "ok" : "warning",
    severity: hasAmapKey ? "info" : "low",
    detail: hasAmapKey
      ? "AMAP route-planning key configured."
      : "AMAP route-planning key missing; store routing will use non-driving fallback paths.",
  });

  addCheck(checks, {
    id: "ops_access_token",
    status: opsAccess.tokenConfigured ? "ok" : strictProduction ? "error" : "warning",
    severity: opsAccess.tokenConfigured ? "info" : strictProduction ? "high" : "medium",
    detail: opsAccess.tokenConfigured
      ? "Sensitive ops endpoints require X-Ops-Token / Bearer token."
      : strictProduction
        ? "OPS_ACCESS_TOKEN is required in production (fail-fast enabled)."
        : opsAccess.allowLocalDevBypass
          ? "OPS_ACCESS_TOKEN missing; localhost-only development bypass is enabled."
          : "OPS_ACCESS_TOKEN missing; sensitive ops endpoints will be denied until configured.",
  });

  addCheck(checks, {
    id: "production_storage_baseline",
    status: !strictProduction || storageProvider === "postgres" ? "ok" : "error",
    severity: !strictProduction || storageProvider === "postgres" ? "info" : "high",
    detail:
      storageProvider === "postgres"
        ? "Production storage baseline is Postgres."
        : strictProduction
          ? "Production requires STORAGE_PROVIDER=postgres (fail-fast enabled)."
          : "File storage is allowed outside production.",
  });

  addCheck(checks, {
    id: "retention_policy",
    status: "ok",
    severity: "info",
    detail:
      `session=${retention.sessionDays}d, replay=${retention.replayDays}d, ` +
      `lead=${retention.leadDays}d, crm_attempt=${retention.crmAttemptDays}d, ` +
      `crm_outbox=${retention.crmOutboxDays}d, audit=${retention.auditDays}d`,
  });

  const summary = summarizeChecks(checks);
  return {
    generatedAt: new Date().toISOString(),
    storageProvider,
    nodeEnv,
    security: {
      opsTokenConfigured: opsAccess.tokenConfigured,
      localDevBypassEnabled: opsAccess.allowLocalDevBypass,
      headerName: opsAccess.headerName,
      actorHeaderName: opsAccess.actorHeaderName,
    },
    retention,
    ...summary,
    checks,
  };
}

function getBlockingConfigErrors(report) {
  if (!report || !Array.isArray(report.checks)) return [];
  return report.checks.filter((item) => item.status === "error");
}

module.exports = {
  buildRuntimeConfigReport,
  getBlockingConfigErrors,
};
