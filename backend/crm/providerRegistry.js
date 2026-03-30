const { CRM_PROVIDERS, resolveCrmProvider } = require("./types");
const mock = require("./providers/mockProvider");
const webhook = require("./providers/webhookProvider");
const live = require("./providers/liveProvider");

function getCrmProvider() {
  const kind = resolveCrmProvider();
  if (kind === CRM_PROVIDERS.WEBHOOK) return { kind, ...webhook };
  if (kind === CRM_PROVIDERS.LIVE) return { kind, ...live };
  return { kind, ...mock };
}

module.exports = {
  getCrmProvider,
};