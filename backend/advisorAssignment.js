const { CRM_PAYLOAD_VERSION } = require("./agentVersioning");

function hashSeed(value) {
  return String(value || "")
    .split("")
    .reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function matchAdvisor(advisor, lead) {
  if (advisor.storeIds?.length && !advisor.storeIds.includes(lead.assignedStoreId)) return false;
  if (advisor.brand && advisor.brand !== lead.inferredBrand) return false;
  if (advisor.city && advisor.city !== lead.userCity && advisor.city !== lead.assignedStoreCity) return false;
  return true;
}

function assignAdvisor({ lead, advisorsPayload }) {
  const advisors = Array.isArray(advisorsPayload?.advisors) ? advisorsPayload.advisors : [];
  const eligible = advisors.filter((advisor) => matchAdvisor(advisor, lead));
  const pool = eligible.length ? eligible : advisors;
  if (!pool.length) return null;
  const index = hashSeed(lead.phone || lead.id) % pool.length;
  const pick = pool[index];
  return {
    id: pick.id,
    name: pick.name,
    title: pick.title || "Sales Advisor",
    team: pick.team || "C-end AI Sales",
    city: pick.city || lead.userCity || lead.assignedStoreCity || "",
    brand: pick.brand || lead.inferredBrand || "",
    phone: pick.phone || null,
    channel: pick.channel || "phone",
    assignmentReason: eligible.length ? "matched_by_city_brand" : "fallback_pool",
  };
}

function buildCrmPayload({ lead, intelligence, advisor, versions, requestId }) {
  return {
    payloadVersion: CRM_PAYLOAD_VERSION,
    requestId,
    externalLeadId: lead.id,
    source: lead.source,
    status: intelligence.stage === "handoff_ready" ? "ready_for_followup" : "captured",
    stage: intelligence.stage,
    priority: intelligence.priority,
    score: intelligence.score,
    nextBestActions: intelligence.nextBestActions,
    customer: {
      name: lead.name,
      phone: lead.phone,
      city: lead.userCity || null,
      preferredTime: lead.preferredTime || null,
    },
    consent: {
      privacyConsent: lead.privacyConsent === true,
      contactConsent: lead.contactConsent === true,
    },
    intent: {
      brand: lead.inferredBrand || null,
      carModel: lead.carModel || null,
      purchaseStage: lead.purchaseStage || null,
      buyTimeline: lead.buyTimeline || null,
      remark: lead.remark || null,
    },
    routing: {
      method: lead.routingMethod || null,
      storeId: lead.assignedStoreId || null,
      storeName: lead.assignedStoreName || null,
      storeCity: lead.assignedStoreCity || null,
      distanceKm: lead.distanceKm ?? null,
      drivingDurationMin: lead.drivingDurationMin ?? null,
    },
    owner: advisor
      ? {
          advisorId: advisor.id,
          advisorName: advisor.name,
          advisorTeam: advisor.team,
          advisorPhone: advisor.phone,
        }
      : null,
    versions,
    syncReady: Boolean(lead.contactConsent && lead.privacyConsent),
  };
}

module.exports = {
  assignAdvisor,
  buildCrmPayload,
};
