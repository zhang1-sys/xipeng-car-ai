const path = require("path");
const fs = require("fs");
const { readJsonLines, readJsonFile } = require("./persistence/filePersistence");

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

function scoreLevel(score) {
  if (score >= 4.5) return "strong";
  if (score >= 3) return "partial";
  return "weak";
}

function buildDimension(key, title, score, evidence, gaps, nextSteps) {
  return {
    key,
    title,
    score,
    maxScore: 5,
    level: scoreLevel(score),
    evidence,
    gaps,
    nextSteps,
  };
}

function rounded(value, digits = 1) {
  const base = 10 ** digits;
  return Math.round(value * base) / base;
}

function readLatestEvalSummary(leadsDir) {
  const payload = readJsonFile(path.join(leadsDir, "eval-results.json"), null);
  if (!payload || !Array.isArray(payload.scenarios)) {
    return null;
  }

  return {
    generatedAt: payload.generatedAt || null,
    summary: payload.summary || null,
    qualityGates: Array.isArray(payload.qualityGates) ? payload.qualityGates : [],
  };
}

function buildAgentReadinessReport({
  backendDir,
  leadsDir,
  sessions,
  storageProvider,
  llm,
  storesPayload,
  businessDataStatus,
  versions,
  sessionTtlMs,
  maxActiveSessions,
  limits,
  analyticsRecords,
  leadRecords,
}) {
  const analyticsFile = path.join(leadsDir, "analytics.jsonl");
  const leadsFile = path.join(leadsDir, "leads.jsonl");
  const analytics = Array.isArray(analyticsRecords) ? analyticsRecords : readJsonLines(analyticsFile);
  const leads = Array.isArray(leadRecords) ? leadRecords : readJsonLines(leadsFile);
  const stores = Array.isArray(storesPayload?.stores) ? storesPayload.stores : [];
  const storeMeta = storesPayload?.meta || {};
  const totalMsValues = analytics.map((item) => Number(item.totalMs || 0)).filter((item) => item > 0);
  const turnValues = analytics.map((item) => Number(item.agentTurns || 0)).filter((item) => item >= 0);
  const structuredCount = analytics.filter((item) => item.hasStructured).length;
  const routedLeadCount = leads.filter((item) => item.assignedStoreId).length;
  const geoLeadCount = leads.filter((item) => typeof item.userLat === "number" && typeof item.userLng === "number").length;
  const scoredLeadCount = leads.filter((item) => typeof item.leadScore === "number").length;
  const crmReadyCount = leads.filter((item) => item.crm?.syncReady === true).length;
  const crmSyncedCount = leads.filter((item) => item.crmSync?.status === "synced").length;
  const advisorAssignedCount = leads.filter((item) => item.assignedAdvisor?.id).length;
  const webhookEnabled = Boolean(
    String(process.env.CRM_WEBHOOK_URL || process.env.LEAD_WEBHOOK_URL || "").trim()
  );
  const llmConfigured = Boolean(llm?.apiKey);
  const amapEnabled = Boolean(String(process.env.AMAP_REST_KEY || "").trim());
  const activeSessions = sessions?.size || 0;
  const hasDocker = fs.existsSync(path.join(backendDir, "..", "deploy", "docker-compose.yml"));
  const hasNginx = fs.existsSync(path.join(backendDir, "..", "deploy", "nginx.conf"));
  const hasSmoke = fs.existsSync(path.join(backendDir, "smoke-test.js"));
  const latestEval = readLatestEvalSummary(leadsDir);
  const hasConfigurator = fs.existsSync(path.join(backendDir, "configuratorAgent.js"));
  const storesReviewedAt = String(storeMeta.lastReviewed || "").trim();
  const isPostgresStorage = String(storageProvider || "file").trim().toLowerCase() === "postgres";

  const dimensions = [
    buildDimension(
      "orchestration",
      "Agent orchestration",
      4.2,
      [
        "Multi-turn session memory and profile extraction are live.",
        "Tool-driven recommendation, comparison, store routing, and service flows are implemented.",
        "Streaming ReAct endpoint and configurator endpoint already exist.",
      ],
      [
        "Planner quality still depends on prompt logic more than formal policies.",
        "No deterministic fallback policy per business scenario beyond current heuristics.",
      ],
      [
        "Add explicit policy engine for pricing, service, and escalation scenarios.",
        "Split planner, policy, and answer synthesizer into independently testable modules.",
      ]
    ),
    buildDimension(
      "memory",
      "Memory and user state",
      isPostgresStorage ? 3.8 : 3.1,
      [
        `Session TTL is enforced at ${Math.round(sessionTtlMs / 3600000)}h with max ${maxActiveSessions} active sessions.`,
        isPostgresStorage
          ? "Structured profile and memory summary are persisted through the Postgres storage provider."
          : "Structured profile and memory summary are persisted to local session storage.",
      ],
      [
        isPostgresStorage
          ? "User identity graph, consent-bound profile merge, and cross-device continuity are still missing."
          : "Session persistence is local-file based, not Redis/Postgres grade.",
        isPostgresStorage
          ? "Retention, access control, and multi-device continuity are still missing."
          : "No user identity graph, consent-bound profile merge, or cross-device continuity.",
      ],
      [
        isPostgresStorage
          ? "Add user identity, consent scope, and profile lifecycle management."
          : "Move session/profile persistence to Redis + Postgres.",
        "Add user identity, consent scope, and profile lifecycle management.",
      ]
    ),
    buildDimension(
      "conversion",
      "Conversion and business loop",
      isPostgresStorage ? 4.4 : 4.2,
      [
        "Test-drive lead capture, nearest-store routing, lead scoring, and advisor assignment are already in place.",
        `${leads.length} leads captured, ${scoredLeadCount} scored, ${advisorAssignedCount} advisor-assigned, ${crmSyncedCount} CRM-synced${webhookEnabled ? ", webhook configured" : ""}${isPostgresStorage ? ", persisted via Postgres storage provider" : ""}.`,
        "CRM outbox now supports pending/sent/acknowledged/synced/failed/dead_letter lifecycle skeleton with mock-first provider routing.",
      ],
      [
        "No real CRM writeback confirmation, lead status sync, or SLA feedback loop.",
        "No conversion scoring or next-best-action framework across funnel stages.",
      ],
      [
        "Connect outbound CRM sync acknowledgment and status callbacks.",
        "Add funnel outcome telemetry from appointment to store visit and test drive completion.",
      ]
    ),
    buildDimension(
      "observability",
      "Observability and ops",
      3.4,
      [
        "Request IDs, slow request logging, analytics records, and health endpoint exist.",
        `${analytics.length} conversation analytics records are available for replay-level analysis.`,
      ],
      [
        "No dashboard for quality drift, prompt versioning, or tool failure analysis.",
        "No alerting for latency spikes, LLM outages, or conversion regressions.",
      ],
      [
        "Ship analytics to a real event pipeline.",
        "Add dashboards for funnel, tool success rate, and latency percentiles.",
      ]
    ),
    buildDimension(
      "safety",
      "Safety and compliance",
      3.0,
      [
        "Rate limiting, privacy consent fields, request tracing, and hotline/escalation messaging are present.",
        `Chat limit is ${limits?.chat?.max || 0}/${Math.round((limits?.chat?.windowMs || 0) / 1000)}s; lead limit is ${limits?.testDrive?.max || 0}/${Math.round((limits?.testDrive?.windowMs || 0) / 1000)}s.`,
      ],
      [
        "PII masking, retention controls, audit review, and role-based access are not production-grade yet.",
        "No policy QA workflow for high-risk advice and compliance review.",
      ],
      [
        "Mask and tokenize PII in storage and logs.",
        "Add retention policy, access control, and compliance review workflow.",
      ]
    ),
    buildDimension(
      "data",
      "Business data freshness",
      2.8,
      [
        `${stores.length} stores are available locally${storesReviewedAt ? `; last reviewed ${storesReviewedAt}` : ""}.`,
        "Catalog, store, rights, and advisor feeds now go through a dedicated adapter layer with freshness metadata.",
      ],
      [
        "Vehicle catalog, rights, and advisor feeds are still local-file backed in this repo.",
        "No real-time pricing, rights, stock, delivery ETA, or city-level campaign data.",
      ],
      [
        "Connect official CMS/CRM/ERP sources for pricing, rights, and store data.",
        "Track source freshness and stale-data alarms in each tool response.",
      ]
    ),
    buildDimension(
      "evaluation",
      "Evaluation and iteration",
      latestEval?.summary?.releaseReady === true ? 4.1 : latestEval ? 3.8 : hasSmoke ? 3.4 : 2.1,
      [
        hasSmoke
          ? "Smoke tests already cover health, recommendation, comparison, service, memory, and test-drive submission."
          : "Basic runtime checks exist but no formal eval suite is detected.",
        latestEval?.summary
          ? `Offline eval latest run passed ${latestEval.summary.passed}/${latestEval.summary.total} scenarios with ${Math.round((latestEval.summary.passRate || 0) * 100)}% pass rate.`
          : "No offline eval result snapshot is visible yet.",
        "Analytics supports basic offline review of turns and latency.",
        versions?.promptVersion && versions?.policyVersion
          ? `Prompt version ${versions.promptVersion} and policy version ${versions.policyVersion} are tracked.`
          : "Prompt/policy version snapshot is not visible yet.",
      ],
      [
        latestEval
          ? "Offline eval exists, but refusal/uncertainty/escalation coverage and richer release workflow are still incomplete."
          : "No golden dataset, scenario-level pass criteria, or LLM-as-judge evaluation pipeline.",
        "No A/B experiment loop tied to business KPIs.",
      ],
      [
        latestEval
          ? "Expand eval to cover refusal, uncertainty, and escalation scenarios."
          : "Build an eval dataset for recommend / compare / service / conversion scenarios.",
        "Version prompts and policies, then attach KPI impact to each release.",
      ]
    ),
    buildDimension(
      "deployment",
      "Deployment readiness",
      hasDocker && hasNginx ? 3.6 : 2.8,
      [
        "Health endpoint, Docker deployment assets, and standalone frontend build path exist.",
        "Local production start flow is already validated.",
      ],
      [
        "No visible blue-green release, secret rotation, or rollback workflow.",
        "No multi-env release checklist or incident playbook inside the product flow.",
      ],
      [
        "Add staging/prod release checklist and rollback playbook.",
        "Add environment validation and secret health checks before startup.",
      ]
    ),
  ];

  const overallScore = rounded(
    dimensions.reduce((sum, item) => sum + item.score, 0) / dimensions.length,
    2
  );
  const overallPercent = Math.round((overallScore / 5) * 100);
  const overallLevel =
    overallScore >= 4 ? "launch-near"
    : overallScore >= 3 ? "pilot-ready"
    : "prototype-plus";

  return {
    generatedAt: new Date().toISOString(),
    overallScore,
    overallPercent,
    overallLevel,
    summary:
      "The project is beyond a chatbot demo and already has an agent foundation, but it still needs real-time business data, CRM closure, and formal evaluation to be launch-ready.",
    versions,
    metrics: {
      runtime: {
        activeSessions,
        llmConfigured,
        amapEnabled,
        storesLoaded: stores.length,
        sessionTtlHours: rounded(sessionTtlMs / 3600000, 1),
      },
      conversations: {
        total: analytics.length,
        structuredRate: analytics.length ? rounded(structuredCount / analytics.length, 2) : 0,
        avgTurns: rounded(average(turnValues), 2),
        avgMs: Math.round(average(totalMsValues)),
        p95Ms: Math.round(percentile(totalMsValues, 0.95)),
      },
      conversion: {
        totalLeads: leads.length,
        routedLeadRate: leads.length ? rounded(routedLeadCount / leads.length, 2) : 0,
        geoLeadRate: leads.length ? rounded(geoLeadCount / leads.length, 2) : 0,
        scoredLeadRate: leads.length ? rounded(scoredLeadCount / leads.length, 2) : 0,
        advisorAssignedRate: leads.length ? rounded(advisorAssignedCount / leads.length, 2) : 0,
        crmReadyRate: leads.length ? rounded(crmReadyCount / leads.length, 2) : 0,
        crmSyncedRate: leads.length ? rounded(crmSyncedCount / leads.length, 2) : 0,
        webhookEnabled,
      },
    },
    businessDataStatus,
    milestones: [
      "Replace static catalog/store data with official live sources.",
      "Add CRM writeback, lead scoring, and advisor assignment loop.",
      "Ship eval dataset, quality gates, and prompt/version management.",
      "Upgrade memory, PII, and audit controls to production storage.",
    ],
    dimensions,
  };
}

module.exports = {
  buildAgentReadinessReport,
};
