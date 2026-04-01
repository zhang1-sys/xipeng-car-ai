const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const { spawn } = require("child_process");

require("dotenv").config({ path: path.join(__dirname, ".env") });

const { query, getDatabaseUrl, closePool } = require("./db/postgresClient");
const {
  latestEvalResultPath,
  readScenarioDataset,
} = require("./evaluation");
const {
  AGENT_RELEASE,
  PROMPT_VERSION,
  POLICY_VERSION,
  EVAL_DATASET_VERSION,
  DATA_ADAPTER_VERSION,
} = require("./agentVersioning");

const USE_EXISTING_SERVER = process.env.EVAL_USE_EXISTING_SERVER === "true";
const DEFAULT_APP_PORT = 3001;
const DEFAULT_EVAL_PORT = 3102;

function resolvePort(value, fallback) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 ? port : fallback;
}

const PORT = resolvePort(
  process.env.EVAL_PORT,
  USE_EXISTING_SERVER
    ? resolvePort(process.env.PORT, DEFAULT_APP_PORT)
    : DEFAULT_EVAL_PORT
);
const BASE = `http://127.0.0.1:${PORT}`;
const MIN_RELEASE_PASS_RATE = 0.85;
let serverProcess = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const health = await fetch(`${BASE}/health`).then((res) => res.json());
      if (health.ok === true) return;
    } catch (_) {}
    await sleep(300);
  }
  throw new Error("eval server failed to become healthy");
}

async function startServer() {
  if (USE_EXISTING_SERVER) {
    await waitForHealth();
    return;
  }

  serverProcess = spawn(process.execPath, ["server.js"], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: String(PORT),
    },
    stdio: "inherit",
  });

  await waitForHealth();
}

async function stopServer() {
  if (!serverProcess || serverProcess.killed) return;

  serverProcess.kill();
  await Promise.race([
    new Promise((resolve) => serverProcess.once("exit", resolve)),
    sleep(3000),
  ]);
}

function getByPath(source, dottedPath) {
  return String(dottedPath || "")
    .split(".")
    .filter(Boolean)
    .reduce((current, key) => (current == null ? undefined : current[key]), source);
}

function hasValue(value) {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function assertScenarioChecks(payload, response, assertions = {}) {
  const checks = [];

  if (assertions.status !== undefined) {
    checks.push({
      name: "status",
      passed: response.status === assertions.status,
      detail: `expected ${assertions.status}, got ${response.status}`,
    });
  }

  for (const [pathKey, expected] of Object.entries(assertions.equals || {})) {
    const actual = getByPath(payload, pathKey);
    checks.push({
      name: `equals:${pathKey}`,
      passed: actual === expected,
      detail: `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    });
  }

  for (const pathKey of assertions.requiredPaths || []) {
    const actual = getByPath(payload, pathKey);
    checks.push({
      name: `required:${pathKey}`,
      passed: hasValue(actual),
      detail: hasValue(actual) ? "present" : "missing",
    });
  }

  for (const [pathKey, minLength] of Object.entries(assertions.arrayMinLength || {})) {
    const actual = getByPath(payload, pathKey);
    const length = Array.isArray(actual) ? actual.length : 0;
    checks.push({
      name: `arrayMinLength:${pathKey}`,
      passed: Array.isArray(actual) && length >= Number(minLength || 0),
      detail: `expected >= ${minLength}, got ${length}`,
    });
  }

  for (const [pathKey, options] of Object.entries(assertions.includesAny || {})) {
    const actual = String(getByPath(payload, pathKey) || "");
    checks.push({
      name: `includesAny:${pathKey}`,
      passed: Array.isArray(options) && options.some((item) => actual.includes(String(item))),
      detail: `expected one of ${JSON.stringify(options)}, got ${JSON.stringify(actual.slice(0, 180))}`,
    });
  }

  return checks;
}

async function runScenario(scenario) {
  const startedAt = Date.now();
  const method = String(scenario.method || "POST").toUpperCase();
  const url = `${BASE}${scenario.route}`;
  const options = {
    method,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Internal-Test": "true",
    },
  };

  if (method !== "GET") {
    options.body = JSON.stringify(scenario.request || {});
  }

  let response;
  let payload;
  let error = null;

  try {
    response = await fetch(url, options);
    payload = await response.json();
  } catch (err) {
    error = err instanceof Error ? err.message : String(err || "request_failed");
  }

  const checks = error
    ? [
        {
          name: "request",
          passed: false,
          detail: error,
        },
      ]
    : assertScenarioChecks(payload, response, scenario.assertions || {});

  const passed = checks.every((check) => check.passed);
  return {
    id: scenario.id,
    title: scenario.title || scenario.id,
    group: scenario.group || "unknown",
    critical: scenario.critical === true,
    route: scenario.route,
    method,
    durationMs: Date.now() - startedAt,
    passed,
    score: passed ? 1 : 0,
    error,
    responseStatus: response?.status || null,
    responseSummary: payload
      ? {
          mode: payload.mode || null,
          stage: payload.stage || payload.agent?.stage || null,
          hasStructured: Boolean(payload.structured),
          requestId: payload.requestId || null,
        }
      : null,
    checks,
  };
}

function buildQualityGates(results) {
  const total = results.length;
  const passed = results.filter((item) => item.passed).length;
  const critical = results.filter((item) => item.critical);
  const criticalFailed = critical.filter((item) => !item.passed).length;
  const byGroup = {};

  for (const item of results) {
    const group = item.group || "unknown";
    if (!byGroup[group]) {
      byGroup[group] = { total: 0, passed: 0, failed: 0, passRate: 0 };
    }
    byGroup[group].total += 1;
    if (item.passed) byGroup[group].passed += 1;
    else byGroup[group].failed += 1;
  }

  for (const entry of Object.values(byGroup)) {
    entry.passRate = entry.total ? Math.round((entry.passed / entry.total) * 100) / 100 : 0;
  }

  const passRate = total ? Math.round((passed / total) * 100) / 100 : 0;
  const conversionPassRate = byGroup.conversion?.passRate ?? 0;
  const gates = [
    {
      id: "scenario-pass-threshold",
      passed: passRate >= MIN_RELEASE_PASS_RATE,
      detail: `passRate=${Math.round(passRate * 100)}% target=${Math.round(
        MIN_RELEASE_PASS_RATE * 100
      )}%`,
    },
    {
      id: "critical-scenarios",
      passed: criticalFailed === 0,
      detail: `criticalFailed=${criticalFailed}`,
    },
    {
      id: "conversion-ready-fields",
      passed: conversionPassRate === 1,
      detail: `conversionPassRate=${Math.round(conversionPassRate * 100)}%`,
    },
  ];

  return {
    byGroup,
    gates,
    summary: {
      total,
      passed,
      failed: total - passed,
      passRate,
      criticalTotal: critical.length,
      criticalPassed: critical.filter((item) => item.passed).length,
      criticalFailed,
      releaseReady: gates.every((gate) => gate.passed),
    },
  };
}

async function persistEvalRunsToPostgres(report) {
  if (!getDatabaseUrl()) {
    return { persisted: false, reason: "DATABASE_URL is not configured" };
  }

  for (const item of report.scenarios) {
    await query(
      `
        INSERT INTO eval_runs (
          id, scenario_id, run_status, route, mode, score, result, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())
      `,
      [
        randomUUID(),
        item.id,
        item.passed ? "passed" : "failed",
        item.route || null,
        item.responseSummary?.mode || item.group || null,
        item.score,
        JSON.stringify({
          runId: report.runId,
          title: item.title,
          group: item.group,
          critical: item.critical,
          durationMs: item.durationMs,
          checks: item.checks,
          responseSummary: item.responseSummary,
        }),
      ]
    );
  }

  return { persisted: true };
}

async function main() {
  await startServer();

  const scenarios = readScenarioDataset(__dirname);
  if (!scenarios.length) {
    throw new Error("no eval scenarios found");
  }

  const results = [];
  for (const scenario of scenarios) {
    const result = await runScenario(scenario);
    results.push(result);
  }

  const quality = buildQualityGates(results);
  const report = {
    runId: randomUUID(),
    generatedAt: new Date().toISOString(),
    versions: {
      agentRelease: AGENT_RELEASE,
      promptVersion: PROMPT_VERSION,
      policyVersion: POLICY_VERSION,
      evalDatasetVersion: EVAL_DATASET_VERSION,
      dataAdapterVersion: DATA_ADAPTER_VERSION,
    },
    environment: {
      baseUrl: BASE,
      useExistingServer: USE_EXISTING_SERVER,
      storageProvider: String(process.env.STORAGE_PROVIDER || "file"),
    },
    summary: quality.summary,
    qualityGates: quality.gates,
    byGroup: quality.byGroup,
    scenarios: results,
  };

  const outputPath = latestEvalResultPath(path.join(__dirname, "data"));
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf8");

  const dbPersistence = await persistEvalRunsToPostgres(report).catch((error) => ({
    persisted: false,
    reason: error.message,
  }));

  console.log(
    JSON.stringify(
      {
        ok: report.summary.releaseReady,
        outputPath,
        summary: report.summary,
        qualityGates: report.qualityGates,
        dbPersistence,
      },
      null,
      2
    )
  );

  if (!report.summary.releaseReady) {
    process.exitCode = 1;
  }
}

(async () => {
  try {
    await main();
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          message: error instanceof Error ? error.message : String(error || "eval failed"),
        },
        null,
        2
      )
    );
    process.exitCode = 1;
  } finally {
    await stopServer();
    await closePool().catch(() => {});
  }
})();
