const BUSINESS_DATA_DOMAINS = ["catalog", "stores", "rights", "advisors", "configurator"];
const BUSINESS_DATA_FRESHNESS = {
  FRESH: "fresh",
  STALE: "stale",
  UNAVAILABLE: "unavailable",
  MOCK_ACTIVE: "mock_active",
  DEGRADED: "degraded",
};
const BUSINESS_DATA_PROVIDER_TYPES = {
  LOCAL: "local",
  LIVE: "live",
};
const BUSINESS_DATA_SCHEMA_VERSION = "business-data-adapter-v2";
const DEFAULT_STALE_HOURS = {
  catalog: 72,
  stores: 168,
  rights: 72,
  advisors: 72,
  configurator: 72,
};
const SOURCE_DEFS = {
  catalog: {
    kind: "catalog",
    defaultFilename: "cars.json",
    pathEnvVar: "CATALOG_SOURCE_PATH",
    urlEnvVar: "CATALOG_SOURCE_URL",
    providerEnvVar: "BUSINESS_DATA_PROVIDER_CATALOG",
    sourceLabel: "车型目录",
  },
  stores: {
    kind: "stores",
    defaultFilename: "stores.json",
    pathEnvVar: "STORES_SOURCE_PATH",
    urlEnvVar: "STORES_SOURCE_URL",
    providerEnvVar: "BUSINESS_DATA_PROVIDER_STORES",
    sourceLabel: "门店数据",
  },
  rights: {
    kind: "rights",
    defaultFilename: "rights.json",
    pathEnvVar: "RIGHTS_SOURCE_PATH",
    urlEnvVar: "RIGHTS_SOURCE_URL",
    providerEnvVar: "BUSINESS_DATA_PROVIDER_RIGHTS",
    sourceLabel: "权益数据",
  },
  advisors: {
    kind: "advisors",
    defaultFilename: "advisors.json",
    pathEnvVar: "ADVISOR_SOURCE_PATH",
    urlEnvVar: "ADVISOR_SOURCE_URL",
    providerEnvVar: "BUSINESS_DATA_PROVIDER_ADVISORS",
    sourceLabel: "顾问数据",
  },
  configurator: {
    kind: "configurator",
    defaultFilename: "configurator-snapshot.json",
    pathEnvVar: "CONFIGURATOR_SOURCE_PATH",
    urlEnvVar: "CONFIGURATOR_SOURCE_URL",
    providerEnvVar: "BUSINESS_DATA_PROVIDER_CONFIGURATOR",
    sourceLabel: "配置器快照",
  },
};

function staleAfterHours(kind) {
  return DEFAULT_STALE_HOURS[kind] || 72;
}

function resolveBusinessDataProvider(kind) {
  const def = SOURCE_DEFS[kind];
  const raw = String(process.env[def?.providerEnvVar] || "local").trim().toLowerCase();
  return raw === BUSINESS_DATA_PROVIDER_TYPES.LIVE
    ? BUSINESS_DATA_PROVIDER_TYPES.LIVE
    : BUSINESS_DATA_PROVIDER_TYPES.LOCAL;
}

module.exports = {
  BUSINESS_DATA_DOMAINS,
  BUSINESS_DATA_FRESHNESS,
  BUSINESS_DATA_PROVIDER_TYPES,
  BUSINESS_DATA_SCHEMA_VERSION,
  DEFAULT_STALE_HOURS,
  SOURCE_DEFS,
  staleAfterHours,
  resolveBusinessDataProvider,
};
