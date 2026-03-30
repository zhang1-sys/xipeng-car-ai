const fs = require("fs");
const path = require("path");
const { query, withTransaction, closePool } = require("../db/postgresClient");

const INPUT_FILE = path.join(__dirname, "generated", "chunks.jsonl");

function readJsonLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean);
}

function splitRecords(records) {
  return {
    documents: records.filter((item) => item.type === "document"),
    chunks: records.filter((item) => item.type === "chunk"),
  };
}

async function ensureVectorExtension() {
  await query("CREATE EXTENSION IF NOT EXISTS vector");
}

async function main() {
  const records = readJsonLines(INPUT_FILE);
  const { documents, chunks } = splitRecords(records);

  if (!records.length) {
    throw new Error(`No generated knowledge records found at ${INPUT_FILE}`);
  }

  await ensureVectorExtension();

  await withTransaction(async (client) => {
    for (const doc of documents) {
      await client.query(
        `
          INSERT INTO knowledge_documents (
            id, source_type, source_uri, title, locale, status, tags, metadata, content_hash
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)
          ON CONFLICT (id) DO UPDATE SET
            source_type = EXCLUDED.source_type,
            source_uri = EXCLUDED.source_uri,
            title = EXCLUDED.title,
            locale = EXCLUDED.locale,
            status = EXCLUDED.status,
            tags = EXCLUDED.tags,
            metadata = EXCLUDED.metadata,
            content_hash = EXCLUDED.content_hash,
            updated_at = NOW()
        `,
        [
          doc.id,
          doc.source_type,
          doc.source_uri || null,
          doc.title,
          doc.locale || "zh-CN",
          doc.status || "active",
          JSON.stringify(doc.tags || []),
          JSON.stringify(doc.metadata || {}),
          doc.metadata?.contentHash || null,
        ]
      );
    }

    for (const chunk of chunks) {
      await client.query(
        `
          INSERT INTO knowledge_chunks (
            id, document_id, chunk_index, content, content_tokens, embedding_model, metadata
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
          ON CONFLICT (document_id, chunk_index) DO UPDATE SET
            content = EXCLUDED.content,
            content_tokens = EXCLUDED.content_tokens,
            embedding_model = EXCLUDED.embedding_model,
            metadata = EXCLUDED.metadata
        `,
        [
          chunk.id,
          chunk.document_id,
          chunk.chunk_index,
          chunk.content,
          chunk.content_tokens ?? null,
          chunk.embedding_model || null,
          JSON.stringify(chunk.metadata || {}),
        ]
      );
    }
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        inputFile: INPUT_FILE,
        documents: documents.length,
        chunks: chunks.length,
        note: "Embeddings are not populated yet. This import only loads documents and chunks.",
      },
      null,
      2
    )
  );
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
    await closePool();
  }
})();
