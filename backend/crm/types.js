const CRM_OUTBOX_STATUS = {
  PENDING: "pending",
  SENT: "sent",
  ACKNOWLEDGED: "acknowledged",
  SYNCED: "synced",
  FAILED: "failed",
  DEAD_LETTER: "dead_letter",
};

const CRM_PROVIDERS = {
  MOCK: "mock",
  WEBHOOK: "webhook",
  LIVE: "live",
};

function resolveCrmProvider() {
  const raw = String(process.env.CRM_PROVIDER || CRM_PROVIDERS.MOCK).trim().toLowerCase();
  if (raw === CRM_PROVIDERS.WEBHOOK) return CRM_PROVIDERS.WEBHOOK;
  if (raw === CRM_PROVIDERS.LIVE) return CRM_PROVIDERS.LIVE;
  return CRM_PROVIDERS.MOCK;
}

module.exports = {
  CRM_OUTBOX_STATUS,
  CRM_PROVIDERS,
  resolveCrmProvider,
};