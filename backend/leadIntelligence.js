function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeTimeline(raw) {
  const text = String(raw || "").toLowerCase();
  if (/1\s*周|week|7/.test(text)) return "immediate";
  if (/1\s*个?月|month/.test(text)) return "short_term";
  if (/1-3|3\s*个?月/.test(text)) return "mid_term";
  return "research";
}

function buildLeadIntelligence(lead) {
  let score = 20;
  const reasons = [];

  if (lead.carModel) {
    score += 12;
    reasons.push("intent_model");
  }
  if (lead.userCity) {
    score += 8;
    reasons.push("city_known");
  }
  if (lead.userLat != null && lead.userLng != null) {
    score += 12;
    reasons.push("geo_available");
  }
  if (lead.contactConsent) {
    score += 6;
    reasons.push("contactable");
  }
  if (lead.assignedStoreId) {
    score += 10;
    reasons.push("store_matched");
  }
  if (lead.preferredTime) {
    score += 6;
    reasons.push("time_preference");
  }
  if (lead.remark && String(lead.remark).trim().length >= 8) {
    score += 4;
    reasons.push("rich_context");
  }

  const timeline = normalizeTimeline(lead.buyTimeline);
  if (timeline === "immediate") {
    score += 24;
    reasons.push("timeline_immediate");
  } else if (timeline === "short_term") {
    score += 16;
    reasons.push("timeline_short_term");
  } else if (timeline === "mid_term") {
    score += 8;
    reasons.push("timeline_mid_term");
  } else {
    score += 2;
    reasons.push("timeline_research");
  }

  if (/首次|增换购|家庭/.test(String(lead.purchaseStage || ""))) {
    score += 6;
    reasons.push("purchase_stage_known");
  }

  if (typeof lead.distanceKm === "number") {
    if (lead.distanceKm <= 15) {
      score += 10;
      reasons.push("store_nearby");
    } else if (lead.distanceKm <= 40) {
      score += 6;
      reasons.push("store_reasonable_distance");
    } else if (lead.distanceKm >= 120) {
      score -= 6;
      reasons.push("store_far");
    }
  }

  if (lead.routingMethod === "manual") {
    score += 10;
    reasons.push("manual_store_selected");
  }

  if (typeof lead.llmConfidence === "number" && lead.llmConfidence >= 0.8) {
    score += 3;
    reasons.push("brand_confident");
  }

  score = clamp(score, 0, 100);

  let stage = "captured";
  let priority = "nurture";
  if (score >= 80 || lead.routingMethod === "manual" || timeline === "immediate") {
    stage = "handoff_ready";
    priority = "hot";
  } else if (score >= 60) {
    stage = "qualified";
    priority = "warm";
  }

  const nextBestActions = [];
  if (!lead.assignedStoreId) nextBestActions.push("Match a valid store before sales handoff");
  if (!lead.preferredTime) nextBestActions.push("Confirm a preferred arrival or callback time");
  if (timeline === "research") nextBestActions.push("Nurture with comparison content and configurator follow-up");
  if (stage === "qualified") nextBestActions.push("Invite the user to a store or remote consultation");
  if (stage === "handoff_ready") nextBestActions.push("Push lead to advisor queue with a 15-minute SLA");
  if (!nextBestActions.length) nextBestActions.push("Proceed to advisor follow-up and test-drive confirmation");

  return {
    score,
    stage,
    priority,
    timeline,
    reasons,
    nextBestActions: nextBestActions.slice(0, 4),
  };
}

module.exports = {
  buildLeadIntelligence,
};
