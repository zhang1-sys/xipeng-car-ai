function round(value, digits = 2) {
  if (!Number.isFinite(value)) return 0;
  const base = 10 ** digits;
  return Math.round(value * base) / base;
}

function percentile(values, ratio) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

function increment(map, key, delta = 1) {
  const normalized = String(key || "unknown");
  map[normalized] = (map[normalized] || 0) + delta;
}

function sortBreakdown(map, limit = 8) {
  return Object.entries(map)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, limit);
}

function buildOpsDashboard({
  analyticsRecords = [],
  leadRecords = [],
  crmSummary = null,
  businessDataStatus = {},
  knowledgeStatus = null,
  evalReport = null,
}) {
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;

  const latencies = [];
  const routeCounts = {};
  const modeCounts = {};
  const responseSourceCounts = {};
  const statusCounts = {};
  const toolCounts = {};
  const fallbackReasons = {};
  let structuredCount = 0;
  let fallbackCount = 0;
  let recent24h = 0;

  for (const record of analyticsRecords) {
    const totalMs = Number(record.totalMs || 0);
    if (totalMs > 0) latencies.push(totalMs);
    if (record.hasStructured) structuredCount += 1;
    increment(routeCounts, record.route || "unknown");
    increment(modeCounts, record.mode || "unknown");
    increment(responseSourceCounts, record.responseSource || "unknown");
    increment(statusCounts, record.status || "unknown");

    const ts = Date.parse(String(record.ts || ""));
    if (Number.isFinite(ts) && ts >= dayAgo) {
      recent24h += 1;
    }

    const toolsUsed = Array.isArray(record.toolsUsed) ? record.toolsUsed : [];
    for (const toolName of toolsUsed) {
      increment(toolCounts, toolName);
    }

    if (record.status === "fallback") {
      fallbackCount += 1;
      increment(fallbackReasons, record.fallbackReason || "fallback");
    }
  }

  const totalRuns = analyticsRecords.length;
  const leadTotal = leadRecords.length;
  const routedLeadCount = leadRecords.filter((item) => item.assignedStoreId).length;
  const advisorAssignedCount = leadRecords.filter((item) => item.assignedAdvisor?.id).length;
  const crmReadyCount = leadRecords.filter((item) => item.crm?.syncReady === true).length;
  const crmSyncedCount = leadRecords.filter((item) => item.crmSync?.status === "synced").length;

  const staleBusinessSources = Object.entries(businessDataStatus || {})
    .filter(([, value]) => value?.source?.stale)
    .map(([key]) => key);

  const qualityGates = Array.isArray(evalReport?.qualityGates) ? evalReport.qualityGates : [];
  const readyGateCount = qualityGates.filter((item) => item.status === "ready").length;
  const blockedGateCount = qualityGates.filter((item) => item.status !== "ready").length;

  return {
    generatedAt: new Date().toISOString(),
    traffic: {
      totalRuns,
      recent24h,
      structuredRate: totalRuns ? round(structuredCount / totalRuns) : 0,
      fallbackRate: totalRuns ? round(fallbackCount / totalRuns) : 0,
      avgLatencyMs: latencies.length ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length) : 0,
      p95LatencyMs: Math.round(percentile(latencies, 0.95)),
    },
    breakdowns: {
      routes: sortBreakdown(routeCounts),
      modes: sortBreakdown(modeCounts),
      responseSources: sortBreakdown(responseSourceCounts),
      statuses: sortBreakdown(statusCounts),
      tools: sortBreakdown(toolCounts),
      fallbackReasons: sortBreakdown(fallbackReasons),
    },
    funnel: {
      totalLeads: leadTotal,
      routedLeadRate: leadTotal ? round(routedLeadCount / leadTotal) : 0,
      advisorAssignedRate: leadTotal ? round(advisorAssignedCount / leadTotal) : 0,
      crmReadyRate: leadTotal ? round(crmReadyCount / leadTotal) : 0,
      crmSyncedRate: leadTotal ? round(crmSyncedCount / leadTotal) : 0,
      crmPending: crmSummary?.counts?.pending || 0,
      crmSent: crmSummary?.counts?.sent || 0,
      crmAcknowledged: crmSummary?.counts?.acknowledged || 0,
      crmSynced: crmSummary?.counts?.synced || 0,
      crmFailed: crmSummary?.counts?.failed || 0,
      crmDeadLetter: crmSummary?.counts?.dead_letter || 0,
      crmProvider: crmSummary?.provider || null,
      crmEnabled: crmSummary?.enabled === true,
    },
    release: {
      status: evalReport?.releaseGate?.status || "unknown",
      latestPassRate: evalReport?.releaseGate?.latestPassRate ?? null,
      latestCriticalFailed: evalReport?.releaseGate?.latestCriticalFailed ?? null,
      readyGateCount,
      blockedGateCount,
    },
    freshness: {
      staleBusinessSources,
      sources: Object.fromEntries(
        Object.entries(businessDataStatus || {}).map(([key, value]) => [
          key,
          {
            provider: value?.provider || null,
            sourceType: value?.sourceType || null,
            freshnessStatus: value?.freshnessStatus || null,
            lastError: value?.lastError || null,
            errors: Array.isArray(value?.errors) ? value.errors : [],
            count: Number(value?.count || 0),
          },
        ])
      ),
      knowledgeProvider: knowledgeStatus?.provider || "unknown",
      knowledgeVectorEnabled: knowledgeStatus?.database?.vectorEnabled === true,
      knowledgeEmbeddedChunks: Number(knowledgeStatus?.database?.embeddedChunks || 0),
    },
  };
}

module.exports = {
  buildOpsDashboard,
};
