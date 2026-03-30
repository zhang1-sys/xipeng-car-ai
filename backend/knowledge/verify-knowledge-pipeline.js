const fs = require("fs");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { getDatabaseUrl, query, closePool } = require("../db/postgresClient");
const { getEmbeddingConfig } = require("./embeddingClient");
const { getKnowledgeProvider } = require("./retrievalService");
const { searchServiceKnowledgeRuntime } = require("../serviceKnowledge");

const GENERATED_CHUNKS_FILE = path.join(__dirname, "generated", "chunks.jsonl");
const DEFAULT_QUERY = String(process.argv[2] || "冬季续航怎么管理").trim();

function baseCheck(id, label, passed, detail, extra = {}) {
  return { id, label, passed, detail, ...extra };
}

function countJsonLines(filePath) {
  if (!fs.existsSync(filePath)) return 0;
  return fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean).length;
}

async function verifyDatabase() {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    return {
      configured: false,
      checks: [
        baseCheck("database_url", "DATABASE_URL", false, "DATABASE_URL not configured"),
        baseCheck("vector_extension", "pgvector extension", false, "Database is not reachable"),
        baseCheck("knowledge_documents", "knowledge import", false, "Database is not reachable"),
        baseCheck("knowledge_embeddings", "embedding writeback", false, "Database is not reachable"),
      ],
    };
  }

  const extension = await query(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_extension
      WHERE extname = 'vector'
    ) AS enabled
  `);
  const documents = await query("SELECT COUNT(*)::int AS count FROM knowledge_documents");
  const chunks = await query("SELECT COUNT(*)::int AS count FROM knowledge_chunks");
  const embeddings = await query(
    "SELECT COUNT(*)::int AS count FROM knowledge_chunks WHERE embedding IS NOT NULL"
  );

  return {
    configured: true,
    checks: [
      baseCheck("database_url", "DATABASE_URL", true, "Database connection configured"),
      baseCheck(
        "vector_extension",
        "pgvector extension",
        extension.rows[0]?.enabled === true,
        extension.rows[0]?.enabled === true ? "vector extension enabled" : "vector extension missing"
      ),
      baseCheck(
        "knowledge_documents",
        "knowledge import",
        Number(documents.rows[0]?.count || 0) > 0 && Number(chunks.rows[0]?.count || 0) > 0,
        `documents=${documents.rows[0]?.count || 0}, chunks=${chunks.rows[0]?.count || 0}`,
        {
          documents: Number(documents.rows[0]?.count || 0),
          chunks: Number(chunks.rows[0]?.count || 0),
        }
      ),
      baseCheck(
        "knowledge_embeddings",
        "embedding writeback",
        Number(embeddings.rows[0]?.count || 0) > 0,
        `embeddedChunks=${embeddings.rows[0]?.count || 0}`,
        {
          embeddedChunks: Number(embeddings.rows[0]?.count || 0),
        }
      ),
    ],
  };
}

async function verifyRetrieval(queryText) {
  const provider = getKnowledgeProvider();
  const items = await searchServiceKnowledgeRuntime({
    message: queryText,
    profile: {},
    limit: 3,
  });
  const first = items[0] || null;

  return baseCheck(
    "retrieval_runtime",
    "retrieval runtime",
    items.length > 0,
    items.length > 0
      ? `provider=${provider}, hits=${items.length}, topTitle=${first?.title || "unknown"}`
      : `provider=${provider}, hits=0`,
    {
      provider,
      query: queryText,
      hits: items.length,
      topHit: first
        ? {
            title: first.title || null,
            source: first.source || null,
            sourceUri: first.sourceUri || null,
            similarity: first.similarity ?? null,
          }
        : null,
    }
  );
}

async function main() {
  const embeddingConfig = getEmbeddingConfig();
  const chunkLines = countJsonLines(GENERATED_CHUNKS_FILE);
  const db = await verifyDatabase();
  const retrieval = await verifyRetrieval(DEFAULT_QUERY);
  const embeddingConfigured =
    embeddingConfig.provider === "local" ||
    embeddingConfig.allowLocalFallback ||
    Boolean(embeddingConfig.apiKey);
  const embeddingMode =
    embeddingConfig.provider === "local"
      ? "local"
      : embeddingConfig.allowLocalFallback
        ? "remote+local-fallback"
        : "remote";

  const checks = [
    baseCheck(
      "knowledge_chunks_file",
      "prepared chunks file",
      chunkLines > 0,
      chunkLines > 0
        ? `generated/chunks.jsonl exists, records=${chunkLines}`
        : "generated/chunks.jsonl is missing or empty",
      { generatedFile: GENERATED_CHUNKS_FILE, records: chunkLines }
    ),
    baseCheck(
      "embedding_config",
      "embedding config",
      embeddingConfigured,
      embeddingConfigured
        ? `embedding mode=${embeddingMode}, model=${embeddingConfig.model}, dimensions=${embeddingConfig.dimensions}`
        : "Embedding API key not configured",
      {
        mode: embeddingMode,
        model: embeddingConfig.model,
        dimensions: embeddingConfig.dimensions,
      }
    ),
    ...db.checks,
    retrieval,
  ];

  const passed = checks.filter((item) => item.passed).length;
  const report = {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    provider: getKnowledgeProvider(),
    summary: {
      total: checks.length,
      passed,
      failed: checks.length - passed,
    },
    checks,
  };

  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) {
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
          message: error.message,
        },
        null,
        2
      )
    );
    process.exitCode = 1;
  } finally {
    await closePool().catch(() => {});
  }
})();
