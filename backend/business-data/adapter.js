const fs = require("fs");
const path = require("path");
const {
  BUSINESS_DATA_FRESHNESS,
  BUSINESS_DATA_SCHEMA_VERSION,
  SOURCE_DEFS,
  staleAfterHours,
} = require("./types");

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function safeIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function ageHours(dateValue) {
  if (!dateValue) return null;
  const ms = Date.now() - new Date(dateValue).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.round((ms / 36e5) * 10) / 10;
}

function computeExpiresAt(fetchedAt, kind) {
  const iso = safeIso(fetchedAt);
  if (!iso) return null;
  const expiresMs = new Date(iso).getTime() + staleAfterHours(kind) * 3600 * 1000;
  return new Date(expiresMs).toISOString();
}

function freshnessStatus({ providerType, fetchedAt, expiresAt, remoteConfigured, errors }) {
  const hasErrors = Array.isArray(errors) && errors.length > 0;
  if (providerType === "live" && !remoteConfigured) {
    return BUSINESS_DATA_FRESHNESS.UNAVAILABLE;
  }
  if (!fetchedAt) {
    return hasErrors ? BUSINESS_DATA_FRESHNESS.DEGRADED : BUSINESS_DATA_FRESHNESS.UNAVAILABLE;
  }
  if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
    return hasErrors ? BUSINESS_DATA_FRESHNESS.DEGRADED : BUSINESS_DATA_FRESHNESS.STALE;
  }
  if (providerType === "local") {
    return hasErrors ? BUSINESS_DATA_FRESHNESS.DEGRADED : BUSINESS_DATA_FRESHNESS.MOCK_ACTIVE;
  }
  return hasErrors ? BUSINESS_DATA_FRESHNESS.DEGRADED : BUSINESS_DATA_FRESHNESS.FRESH;
}

function summarizeVersion(raw, filePath, fetchedAt) {
  if (raw?.meta?.version) return String(raw.meta.version);
  if (raw?.version) return String(raw.version);
  if (filePath && fs.existsSync(filePath)) {
    return String(fs.statSync(filePath).mtimeMs);
  }
  if (fetchedAt) return String(new Date(fetchedAt).getTime());
  return null;
}

function normalizeData(kind, raw) {
  if (kind === "catalog") {
    const items = (Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : []).filter(
      (item) => String(item?.brand || "").trim() === "小鹏"
    );
    return {
      meta: { ...(raw?.meta || {}) },
      items,
    };
  }
  if (kind === "stores") {
    const stores = (Array.isArray(raw?.stores) ? raw.stores : []).filter(
      (item) => String(item?.brand || "").trim() === "小鹏"
    );
    return { meta: { ...(raw?.meta || {}) }, stores };
  }
  if (kind === "rights") {
    const items = Array.isArray(raw?.items) ? raw.items : [];
    return { meta: { ...(raw?.meta || {}) }, items };
  }
  if (kind === "configurator") {
    const models = (Array.isArray(raw?.models) ? raw.models : []).filter((item) => {
      const brand = String(item?.brand || "").trim();
      return !brand || brand === "小鹏";
    });
    return { meta: { ...(raw?.meta || {}) }, models };
  }
  const advisors = (Array.isArray(raw?.advisors) ? raw.advisors : []).filter((item) => {
    const brand = String(item?.brand || "小鹏").trim();
    return !brand || brand === "小鹏";
  });
  return { meta: { ...(raw?.meta || {}) }, advisors };
}

function countData(kind, data) {
  if (kind === "catalog") return Array.isArray(data?.items) ? data.items.length : 0;
  if (kind === "stores") return Array.isArray(data?.stores) ? data.stores.length : 0;
  if (kind === "rights") return Array.isArray(data?.items) ? data.items.length : 0;
  if (kind === "configurator") return Array.isArray(data?.models) ? data.models.length : 0;
  return Array.isArray(data?.advisors) ? data.advisors.length : 0;
}

function buildAdapterResponse(kind, result) {
  const sourceDef = SOURCE_DEFS[kind];
  const data = normalizeData(kind, result.raw);
  const fetchedAt = safeIso(result.fetchedAt || result.updatedAt);
  const expiresAt = computeExpiresAt(fetchedAt, kind);
  const errors = Array.isArray(result.errors) ? result.errors.filter(Boolean).map(String) : [];
  const source = {
    provider: result.provider,
    providerType: result.providerType,
    sourceType: result.sourceType,
    label: sourceDef?.sourceLabel || kind,
    brand: "小鹏",
    path: result.path || null,
    remoteUrl: result.remoteUrl || null,
    remoteConfigured: result.remoteConfigured === true,
    fallbackUsed: result.fallbackUsed === true,
    fetchedAt,
    expiresAt,
    freshnessStatus: freshnessStatus({
      providerType: result.providerType,
      fetchedAt,
      expiresAt,
      remoteConfigured: result.remoteConfigured === true,
      errors,
    }),
    lastError: errors[errors.length - 1] || null,
    ageHours: ageHours(fetchedAt),
    staleAfterHours: staleAfterHours(kind),
  };

  return {
    data,
    source,
    version: summarizeVersion(result.raw, result.path, fetchedAt),
    fetchedAt,
    expiresAt,
    freshnessStatus: source.freshnessStatus,
    errors,
    schemaVersion: BUSINESS_DATA_SCHEMA_VERSION,
    count: countData(kind, data),
  };
}

function resolveLocalSource(def) {
  const defaultPath = path.join(__dirname, "..", def.defaultFilename);
  const overridePath = String(process.env[def.pathEnvVar] || "").trim();
  const preferredPath = overridePath || defaultPath;
  const activePath = fs.existsSync(preferredPath) ? preferredPath : defaultPath;
  const raw = readJsonFile(activePath);
  const stat = fs.statSync(activePath);
  return {
    raw,
    path: activePath,
    fetchedAt: stat.mtime.toISOString(),
    provider: `${def.kind}.local`,
    providerType: "local",
    sourceType: overridePath && activePath === overridePath ? "override_file" : "local_file",
    remoteConfigured: Boolean(String(process.env[def.urlEnvVar] || "").trim()),
    fallbackUsed: false,
    errors: [],
  };
}

async function fetchRemoteJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`remote source ${response.status}: ${text.slice(0, 160)}`);
    }
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`remote source timeout after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveLiveSource(def, timeoutMs) {
  const remoteUrl = String(process.env[def.urlEnvVar] || "").trim();
  if (!/^https?:\/\//i.test(remoteUrl)) {
    const placeholders = {
      catalog: { meta: {}, items: [] },
      stores: { meta: {}, stores: [] },
      rights: { meta: {}, items: [] },
      advisors: { meta: {}, advisors: [] },
      configurator: { meta: {}, models: [] },
    };
    return {
      raw: placeholders[def.kind] || { meta: {} },
      path: null,
      remoteUrl: null,
      fetchedAt: null,
      provider: `${def.kind}.live`,
      providerType: "live",
      sourceType: "live_placeholder",
      remoteConfigured: false,
      fallbackUsed: false,
      errors: [`${def.kind} live provider not configured`],
    };
  }
  const raw = await fetchRemoteJson(remoteUrl, timeoutMs);
  return {
    raw,
    path: null,
    remoteUrl,
    fetchedAt: new Date().toISOString(),
    provider: `${def.kind}.live`,
    providerType: "live",
    sourceType: "remote_http",
    remoteConfigured: true,
    fallbackUsed: false,
    errors: [],
  };
}

module.exports = {
  buildAdapterResponse,
  resolveLocalSource,
  resolveLiveSource,
};
