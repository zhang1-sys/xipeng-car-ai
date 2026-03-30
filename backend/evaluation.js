const path = require("path");
const fs = require("fs");
const { readJsonLines, readJsonFile } = require("./persistence/filePersistence");

const REQUIRED_GROUPS = ["recommendation", "comparison", "configurator", "service", "conversion"];
const MIN_RELEASE_PASS_RATE = 0.85;

function readScenarioDataset(backendDir) {
  const filePath = path.join(backendDir, "evals", "scenarios.json");
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function latestEvalResultPath(leadsDir) {
  return path.join(leadsDir, "eval-results.json");
}

function readLatestEvalResult(leadsDir) {
  return readJsonFile(latestEvalResultPath(leadsDir), null);
}

function latestSmokeResultPath(leadsDir) {
  return path.join(leadsDir, "smoke-results.json");
}

function readLatestSmokeResult(leadsDir) {
  return readJsonFile(latestSmokeResultPath(leadsDir), null);
}

function countBy(list, keySelector) {
  return list.reduce((acc, item) => {
    const key = keySelector(item);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return 0;
  const base = 10 ** digits;
  return Math.round(value * base) / base;
}

function summarizeLatestRun(latestRun) {
  if (!latestRun || !Array.isArray(latestRun.scenarios)) {
    return null;
  }

  const scenarios = latestRun.scenarios;
  const passed = scenarios.filter((item) => item.passed).length;
  const critical = scenarios.filter((item) => item.critical);
  const criticalPassed = critical.filter((item) => item.passed).length;
  const byGroup = {};
  for (const item of scenarios) {
    const group = item.group || "unknown";
    if (!byGroup[group]) {
      byGroup[group] = {
        total: 0,
        passed: 0,
        failed: 0,
        passRate: 0,
      };
    }
    byGroup[group].total += 1;
    if (item.passed) byGroup[group].passed += 1;
    else byGroup[group].failed += 1;
  }

  for (const entry of Object.values(byGroup)) {
    entry.passRate = entry.total ? round(entry.passed / entry.total) : 0;
  }

  return {
    runId: latestRun.runId || null,
    generatedAt: latestRun.generatedAt || null,
    total: scenarios.length,
    passed,
    failed: scenarios.length - passed,
    passRate: scenarios.length ? round(passed / scenarios.length) : 0,
    criticalTotal: critical.length,
    criticalPassed,
    criticalFailed: critical.length - criticalPassed,
    criticalPassRate: critical.length ? round(criticalPassed / critical.length) : 0,
    byGroup,
    releaseReady: latestRun.summary?.releaseReady === true,
    failedScenarios: scenarios
      .filter((item) => !item.passed)
      .map((item) => ({
        id: item.id,
        title: item.title,
        group: item.group,
        critical: item.critical === true,
        reason:
          item.checks?.find((check) => !check.passed)?.detail ||
          item.error ||
          "scenario failed",
      }))
      .slice(0, 10),
  };
}

function buildQualityGates({
  scenarios,
  latestRunSummary,
  latestSmoke,
  versions,
  businessDataStatus,
}) {
  const datasetGroups = new Set(scenarios.map((item) => item.group).filter(Boolean));
  const hasAllRequiredGroups = REQUIRED_GROUPS.every((group) => datasetGroups.has(group));
  const conversionPassRate = latestRunSummary?.byGroup?.conversion?.passRate ?? 0;
  const scenarioPassRate = latestRunSummary?.passRate ?? 0;
  const criticalFailed = latestRunSummary?.criticalFailed ?? null;
  const smokeChecks = new Set(Array.isArray(latestSmoke?.checks) ? latestSmoke.checks : []);
  const privacySmokePassed =
    latestSmoke?.ok === true &&
    smokeChecks.has("conversation_replay") &&
    smokeChecks.has("session_storage_masking") &&
    smokeChecks.has("privacy_validation");

  return [
    {
      id: "smoke-suite",
      label: "Smoke suite",
      status:
        latestSmoke == null
          ? "missing"
          : latestSmoke.ok === true
            ? "ready"
            : "partial",
      detail:
        latestSmoke == null
          ? "No smoke result snapshot has been recorded yet."
          : latestSmoke.ok === true
            ? `Smoke passed with ${(latestSmoke.checks || []).length} checks.`
            : `Smoke failed: ${latestSmoke.message || "unknown_error"}`,
    },
    {
      id: "offline-eval-dataset",
      label: "Offline eval dataset coverage",
      status:
        scenarios.length >= 8 && hasAllRequiredGroups
          ? "ready"
          : scenarios.length > 0
            ? "partial"
            : "missing",
      detail: `${scenarios.length} scenarios; groups=${[...datasetGroups].sort().join(", ") || "none"}`,
    },
    {
      id: "scenario-pass-threshold",
      label: "Scenario pass threshold",
      status:
        latestRunSummary == null
          ? "missing"
          : scenarioPassRate >= MIN_RELEASE_PASS_RATE
            ? "ready"
            : "partial",
      detail:
        latestRunSummary == null
          ? "No offline eval result has been recorded yet."
          : `Latest pass rate ${Math.round(scenarioPassRate * 100)}% (target ${Math.round(
              MIN_RELEASE_PASS_RATE * 100
            )}%).`,
    },
    {
      id: "critical-scenarios",
      label: "Critical scenario gate",
      status:
        latestRunSummary == null
          ? "missing"
          : criticalFailed === 0
            ? "ready"
            : "partial",
      detail:
        latestRunSummary == null
          ? "Critical scenarios have not been executed."
          : `${latestRunSummary.criticalPassed}/${latestRunSummary.criticalTotal} critical scenarios passed.`,
    },
    {
      id: "conversion-ready-fields",
      label: "Conversion-ready lead output",
      status:
        latestRunSummary == null
          ? "missing"
          : conversionPassRate === 1
            ? "ready"
            : conversionPassRate > 0
              ? "partial"
              : "missing",
      detail:
        latestRunSummary == null
          ? "No conversion eval result yet."
          : `Conversion group pass rate ${Math.round(conversionPassRate * 100)}%.`,
    },
    {
      id: "privacy-regression",
      label: "Privacy masking regression gate",
      status:
        latestSmoke == null
          ? "missing"
          : privacySmokePassed
            ? "ready"
            : "partial",
      detail:
        latestSmoke == null
          ? "No smoke result available for privacy checks."
          : privacySmokePassed
            ? "Replay and session-storage masking checks passed in smoke."
            : "Privacy-related smoke checks are incomplete or failed.",
    },
    {
      id: "versioned-agent",
      label: "Prompt / policy / eval version snapshot",
      status:
        versions.promptVersion && versions.policyVersion && versions.evalDatasetVersion
          ? "ready"
          : "missing",
      detail: `prompt=${versions.promptVersion || "missing"}, policy=${versions.policyVersion || "missing"}, eval=${versions.evalDatasetVersion || "missing"}`,
    },
    {
      id: "live-data-adapter",
      label: "Data adapter and freshness metadata",
      status:
        businessDataStatus.catalog?.source && businessDataStatus.stores?.source
          ? "ready"
          : "missing",
      detail: "Catalog and store sources expose freshness metadata through the adapter layer.",
    },
  ];
}

function buildEvalReport({ backendDir, leadsDir, versions, businessDataStatus, analyticsRecords }) {
  const scenarios = readScenarioDataset(backendDir);
  const analytics = Array.isArray(analyticsRecords)
    ? analyticsRecords
    : readJsonLines(path.join(leadsDir, "analytics.jsonl"));
  const latestRun = readLatestEvalResult(leadsDir);
  const latestSmoke = readLatestSmokeResult(leadsDir);
  const latestRunSummary = summarizeLatestRun(latestRun);
  const byGroup = countBy(scenarios, (item) => item.group || "unknown");
  const qualityGates = buildQualityGates({
    scenarios,
    latestRunSummary,
    latestSmoke,
    versions,
    businessDataStatus,
  });
  const releaseReady = qualityGates.every((gate) => gate.status === "ready");

  return {
    generatedAt: new Date().toISOString(),
    versions,
    dataset: {
      scenarioCount: scenarios.length,
      byGroup,
      requiredGroups: REQUIRED_GROUPS,
      scenarios: scenarios.map((item) => ({
        id: item.id,
        title: item.title,
        group: item.group,
        critical: item.critical === true,
        route: item.route,
        method: item.method || "POST",
      })),
    },
    latestRun: latestRunSummary,
    latestSmoke,
    runtimeSignals: {
      analyticsCount: analytics.length,
      avgLatencyMs: analytics.length
        ? Math.round(
            analytics.reduce((sum, item) => sum + Number(item.totalMs || 0), 0) / analytics.length
          )
        : 0,
      toolCoverage: [...new Set(analytics.flatMap((item) => item.toolsUsed || []))],
    },
    qualityGates,
    releaseGate: {
      status: releaseReady ? "ready" : "blocked",
      minPassRate: MIN_RELEASE_PASS_RATE,
      latestPassRate: latestRunSummary?.passRate ?? null,
      latestCriticalFailed: latestRunSummary?.criticalFailed ?? null,
    },
    nextSteps: [
      latestRunSummary
        ? "Fix failing scenarios first, then rerun offline eval until release gate is green."
        : "Run `npm run eval` in backend to generate the first offline eval result.",
      "Keep prompt/policy/eval version snapshots attached to every release candidate.",
      "Extend eval coverage with refusal, uncertainty, and escalation scenarios in later rounds.",
    ],
  };
}

module.exports = {
  buildEvalReport,
  readScenarioDataset,
  readLatestEvalResult,
  readLatestSmokeResult,
  latestEvalResultPath,
};
