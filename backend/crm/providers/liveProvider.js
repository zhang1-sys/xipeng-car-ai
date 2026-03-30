const { CRM_OUTBOX_STATUS } = require("../types");

async function send() {
  return {
    ok: false,
    transport: "live",
    httpStatus: 0,
    error: "live_provider_unavailable",
    nextStatus: CRM_OUTBOX_STATUS.FAILED,
  };
}

module.exports = {
  send,
};