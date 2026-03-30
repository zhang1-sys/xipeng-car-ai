const fs = require("fs");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { getDatabaseUrl, query } = require("../db/postgresClient");
const { getEmbeddingConfig } = require("./embeddingClient");
const { getKnowledgeProvider } = require("./retrievalService");

const GENERATED_CHUNKS_FILE = path.join(__dirname, "generated", "chunks.jsonl");
const SOURCE_DIR = path.join(__dirname, "sources");

function countJsonlByType(filePath) {
  const summary = {
    exists: false,
    records: 0,
    documents: 0,
    chunks: 0,
  };
  if (!fs.existsSync(filePath)) return summary;

  summary.exists = true;
  const lines = fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  summary.records = lines.length;

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === "document") summary.documents += 1;
      if (parsed.type === "chunk") summary.chunks += 1;
    } catch (_) {}
  }

  return summary;
}

function countKnowledgeSourceFiles(dirPath) {
  if (!fs.existsSync(dirPath)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const nextPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      count += countKnowledgeSourceFiles(nextPath);
      continue;
    }
    if (/\.(md|txt)$/i.test(entry.name)) {
      count += 1;
    }
  }
  return count;
}

async function getKnowledgeStatus() {
  const provider = getKnowledgeProvider();
  const embedding = getEmbeddingConfig();
  const generated = countJsonlByType(GENERATED_CHUNKS_FILE);
  const databaseConfigured = Boolean(getDatabaseUrl());

  const status = {
    generatedAt: new Date().toISOString(),
    provider,
    generated,
    sourceFiles: countKnowledgeSourceFiles(SOURCE_DIR),
    embedding: {
      configured: Boolean(embedding.apiKey),
      model: embedding.model,
      dimensions: embedding.dimensions,
    },
    database: {
      configured: databaseConfigured,
      vectorEnabled: false,
      documents: 0,
      chunks: 0,
      embeddedChunks: 0,
      error: null,
    },
  };

  if (!databaseConfigured) {
    return status;
  }

  try {
    const extension = await query(
      `
        SELECT EXISTS (
          SELECT 1
          FROM pg_extension
          WHERE extname = 'vector'
        ) AS enabled
      `
    );
    const documents = await query("SELECT COUNT(*)::int AS count FROM knowledge_documents");
    const chunks = await query("SELECT COUNT(*)::int AS count FROM knowledge_chunks");
    const embeddings = await query(
      "SELECT COUNT(*)::int AS count FROM knowledge_chunks WHERE embedding IS NOT NULL"
    );

    status.database.vectorEnabled = extension.rows[0]?.enabled === true;
    status.database.documents = Number(documents.rows[0]?.count || 0);
    status.database.chunks = Number(chunks.rows[0]?.count || 0);
    status.database.embeddedChunks = Number(embeddings.rows[0]?.count || 0);
  } catch (error) {
    status.database.error = error.message;
  }

  return status;
}

module.exports = {
  getKnowledgeStatus,
};
