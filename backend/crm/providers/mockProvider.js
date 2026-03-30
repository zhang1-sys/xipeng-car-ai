const { CRM_OUTBOX_STATUS } = require("../types");

function decideMockResult(payload, lead) {
  const mode = String(process.env.CRM_MOCK_MODE || "success").trim().toLowerCase();
  if (mode === "fail") return { ok: false, reason: "mock_fail" };
  if (mode === "flaky") {
    const phone = String(payload?.customer?.phone || lead?.phone || "");
    const last = phone.slice(-1);
    const digit = Number(last);
    if (Number.isFinite(digit) && digit % 2 === 1) {
      return { ok: false, reason: "mock_flaky_odd_phone" };
    }
  }
  return { ok: true, reason: "mock_success" };
}

async function send({ outboxItem, payload, lead }) {
  const result = decideMockResult(payload, lead);
  if (!result.ok) {
    return {
      ok: false,
      transport: "mock",
      httpStatus: 0,
      error: result.reason,
      nextStatus: CRM_OUTBOX_STATUS.FAILED,
    };
  }
  return {
    ok: true,
    transport: "mock",
    httpStatus: 200,
    nextStatus: CRM_OUTBOX_STATUS.SENT,
    ackSuggested: true,
  };
}

module.exports = {
  send,
};