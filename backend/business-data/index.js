const {
  BUSINESS_DATA_DOMAINS,
  SOURCE_DEFS,
  resolveBusinessDataProvider,
} = require("./types");
const {
  buildAdapterResponse,
  resolveLocalSource,
  resolveLiveSource,
} = require("./adapter");

const BUSINESS_DATA_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.BUSINESS_DATA_REMOTE_TIMEOUT_MS || 8000)
);
const BUSINESS_DATA_REFRESH_MS = Math.max(
  60 * 1000,
  Number(process.env.BUSINESS_DATA_REFRESH_MS || 15 * 60 * 1000)
);

const cache = {};
let refreshTimer = null;

async function loadDomain(kind) {
  const def = SOURCE_DEFS[kind];
  const providerType = resolveBusinessDataProvider(kind);
  let result;
  if (providerType === "live") {
    try {
      result = await resolveLiveSource(def, BUSINESS_DATA_TIMEOUT_MS);
    } catch (error) {
      const localResult = resolveLocalSource(def);
      result = {
        ...localResult,
        provider: `${def.kind}.live`,
        providerType: "live",
        sourceType: "remote_http_fallback",
        remoteConfigured: Boolean(String(process.env[def.urlEnvVar] || "").trim()),
        remoteUrl: String(process.env[def.urlEnvVar] || "").trim() || null,
        fallbackUsed: true,
        errors: [error.message],
      };
    }
  } else {
    result = resolveLocalSource(def);
  }

  const adapter = buildAdapterResponse(kind, result);
  cache[kind] = {
    raw: result.raw,
    adapter,
  };
  return cache[kind];
}

function currentCache(kind) {
  if (!cache[kind]) {
    const local = resolveLocalSource(SOURCE_DEFS[kind]);
    cache[kind] = {
      raw: local.raw,
      adapter: buildAdapterResponse(kind, local),
    };
  }
  return cache[kind];
}

async function initializeBusinessData() {
  const results = [];
  for (const kind of BUSINESS_DATA_DOMAINS) {
    const item = await loadDomain(kind);
    results.push({
      kind,
      ok: item.adapter.errors.length === 0,
      refreshed: true,
      mode: item.adapter.source.sourceType,
      provider: item.adapter.source.provider,
      freshnessStatus: item.adapter.freshnessStatus,
      error: item.adapter.source.lastError,
    });
  }
  return results;
}

async function refreshBusinessData({ kinds, reason = "manual" } = {}) {
  const targetKinds = Array.isArray(kinds) && kinds.length ? kinds : BUSINESS_DATA_DOMAINS;
  const results = [];
  for (const kind of targetKinds) {
    if (!SOURCE_DEFS[kind]) continue;
    const item = await loadDomain(kind);
    results.push({
      kind,
      ok: item.adapter.errors.length === 0,
      refreshed: true,
      mode: item.adapter.source.sourceType,
      provider: item.adapter.source.provider,
      freshnessStatus: item.adapter.freshnessStatus,
      reason,
      error: item.adapter.source.lastError,
    });
  }
  return results;
}

function startBusinessDataRefreshLoop(logger = console) {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  const enabledKinds = BUSINESS_DATA_DOMAINS.filter(
    (kind) => resolveBusinessDataProvider(kind) === "live"
  );
  if (!enabledKinds.length) {
    return { enabled: false, intervalMs: BUSINESS_DATA_REFRESH_MS, kinds: [] };
  }
  refreshTimer = setInterval(() => {
    refreshBusinessData({ reason: "scheduled" }).then((results) => {
      const failed = results.filter((item) => item.ok === false);
      if (failed.length) {
        logger.warn(
          `[business-data] ${failed.length} refresh failure(s): ${failed
            .map((item) => `${item.kind}:${item.error}`)
            .join(" | ")}`
        );
      }
    }).catch((error) => {
      logger.warn(`[business-data] scheduled refresh failed: ${error.message}`);
    });
  }, BUSINESS_DATA_REFRESH_MS);
  if (typeof refreshTimer.unref === "function") refreshTimer.unref();
  return { enabled: true, intervalMs: BUSINESS_DATA_REFRESH_MS, kinds: enabledKinds };
}

function stopBusinessDataRefreshLoop() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

function getBusinessDataRefreshConfig() {
  return {
    enabledKinds: BUSINESS_DATA_DOMAINS.filter((kind) => resolveBusinessDataProvider(kind) === "live"),
    intervalMs: BUSINESS_DATA_REFRESH_MS,
    timeoutMs: BUSINESS_DATA_TIMEOUT_MS,
  };
}

function readCatalogPayload() {
  return currentCache("catalog").adapter.data;
}

function readStoresPayload() {
  return currentCache("stores").adapter.data;
}

function readRightsPayload() {
  return currentCache("rights").adapter.data;
}

function readAdvisorPayload() {
  return currentCache("advisors").adapter.data;
}

function readConfiguratorPayload() {
  return currentCache("configurator").adapter.data;
}

function getBusinessDataAdapter(domain) {
  return currentCache(domain).adapter;
}

function getBusinessDataStatus() {
  const sources = {};
  for (const kind of BUSINESS_DATA_DOMAINS) {
    const adapter = getBusinessDataAdapter(kind);
    sources[kind] = {
      provider: adapter.source.provider,
      sourceType: adapter.source.sourceType,
      count: adapter.count,
      fetchedAt: adapter.fetchedAt,
      expiresAt: adapter.expiresAt,
      freshnessStatus: adapter.freshnessStatus,
      lastError: adapter.source.lastError,
      errors: adapter.errors,
      remoteConfigured: adapter.source.remoteConfigured,
      fallbackUsed: adapter.source.fallbackUsed,
      brand: adapter.source.brand,
      source: {
        ...adapter.source,
        stale: ["stale", "degraded"].includes(adapter.freshnessStatus),
      },
      version: adapter.version,
    };
  }
  return sources;
}

for (const kind of BUSINESS_DATA_DOMAINS) {
  currentCache(kind);
}

module.exports = {
  initializeBusinessData,
  refreshBusinessData,
  startBusinessDataRefreshLoop,
  stopBusinessDataRefreshLoop,
  getBusinessDataRefreshConfig,
  readCatalogPayload,
  readStoresPayload,
  readRightsPayload,
  readAdvisorPayload,
  readConfiguratorPayload,
  getBusinessDataAdapter,
  getBusinessDataStatus,
};
