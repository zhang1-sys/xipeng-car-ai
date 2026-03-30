const { webhookConfig, sendRecord } = require("../../crmSync");
const { CRM_OUTBOX_STATUS } = require("../types");

async function send({ outboxItem }) {
  const config = webhookConfig();
  if (!config.enabled) {
    return {
      ok: false,
      transport: "webhook",
      httpStatus: 0,
      error: "webhook_not_configured",
      nextStatus: CRM_OUTBOX_STATUS.FAILED,
    };
  }
  const result = await sendRecord(outboxItem, config);
  return {
    ok: true,
    transport: "webhook",
    httpStatus: result.httpStatus,
    nextStatus: CRM_OUTBOX_STATUS.SENT,
    ackSuggested: false,
  };
}

module.exports = {
  send,
};