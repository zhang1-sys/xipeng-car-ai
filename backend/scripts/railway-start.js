const path = require("path");
const { spawnSync } = require("child_process");
const { query } = require("../db/postgresClient");

function isTruthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function runNodeScript(label, relativeFile) {
  const backendRoot = path.join(__dirname, "..");
  const filePath = path.join(backendRoot, relativeFile);
  const result = spawnSync(process.execPath, [filePath], {
    cwd: backendRoot,
    stdio: "inherit",
    env: process.env,
  });

  if (result.status !== 0) {
    const code = typeof result.status === "number" ? result.status : 1;
    throw new Error(`${label} failed with exit code ${code}`);
  }
}

function shouldUsePostgres() {
  return String(process.env.STORAGE_PROVIDER || "file").trim().toLowerCase() === "postgres";
}

async function readKnowledgeStatus() {
  const result = await query(
    `
      SELECT
        (SELECT COUNT(*)::int FROM knowledge_documents) AS documents,
        (SELECT COUNT(*)::int FROM knowledge_chunks) AS chunks,
        (SELECT COUNT(*)::int FROM knowledge_chunks WHERE embedding IS NULL) AS chunks_without_embedding
    `
  );
  return result.rows?.[0] || {
    documents: 0,
    chunks: 0,
    chunks_without_embedding: 0,
  };
}

async function main() {
  const usePostgres = shouldUsePostgres();
  const autoApplyDbSchema =
    usePostgres && Boolean(String(process.env.DATABASE_URL || "").trim()) && isTruthy(process.env.AUTO_APPLY_DB_SCHEMA);
  const autoBootstrapKnowledge =
    usePostgres &&
    Boolean(String(process.env.DATABASE_URL || "").trim()) &&
    isTruthy(process.env.AUTO_BOOTSTRAP_KNOWLEDGE);

  if (autoApplyDbSchema) {
    console.log("[railway] applying database schema before starting server");
    runNodeScript("database schema apply", "db/apply-schema.js");
    process.env.AUTO_APPLY_DB_SCHEMA = "0";
  }

  if (autoBootstrapKnowledge) {
    const knowledgeStatus = await readKnowledgeStatus();
    const hasKnowledgeData =
      Number(knowledgeStatus.documents || 0) > 0 && Number(knowledgeStatus.chunks || 0) > 0;

    if (!hasKnowledgeData) {
      console.log("[railway] knowledge tables are empty; running first-time bootstrap");
      runNodeScript("knowledge source bootstrap", "knowledge/bootstrap-service-knowledge-sources.js");
      runNodeScript("knowledge chunk preparation", "knowledge/prepare-knowledge-chunks.js");
      runNodeScript("knowledge import", "knowledge/import-knowledge-to-postgres.js");
    } else {
      console.log("[railway] knowledge tables already populated; skipping import bootstrap");
    }

    if (!hasKnowledgeData || Number(knowledgeStatus.chunks_without_embedding || 0) > 0) {
      runNodeScript("knowledge embedding", "knowledge/embed-knowledge-in-postgres.js");
    }

    runNodeScript("knowledge verification", "knowledge/verify-knowledge-pipeline.js");
  }

  require(path.join(__dirname, "..", "server.js"));
}

main().catch((error) => {
  console.error(`[railway] startup bootstrap failed: ${error.message}`);
  process.exit(1);
});
