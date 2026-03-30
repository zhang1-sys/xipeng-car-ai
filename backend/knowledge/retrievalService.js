const { query } = require("../db/postgresClient");
const { generateEmbedding } = require("./embeddingClient");

function buildSearchTerms(message) {
  const text = String(message || "").trim().toLowerCase();
  if (!text) return [];

  const baseTerms = text.match(/[\p{L}\p{N}]+/gu) || [];
  const terms = new Set(baseTerms.filter((term) => term.length >= 2));

  for (const term of baseTerms) {
    if (/^[\p{Script=Han}]+$/u.test(term) && term.length > 2) {
      for (let index = 0; index < term.length - 1; index += 1) {
        terms.add(term.slice(index, index + 2));
      }
    }
  }

  if (!terms.size && text.length >= 2) {
    terms.add(text);
  }

  return [...terms].slice(0, 12);
}

function getKnowledgeProvider() {
  return (
    String(process.env.KNOWLEDGE_RETRIEVAL_PROVIDER || process.env.STORAGE_PROVIDER || "local")
      .trim()
      .toLowerCase() || "local"
  );
}

async function searchKnowledgeInPostgres({ message, limit = 3 }) {
  const keyword = String(message || "").trim();
  const safeLimit = Math.max(1, Math.min(8, Number(limit) || 3));
  const terms = buildSearchTerms(keyword);
  if (!keyword) return [];

  const result = await query(
    `
      WITH terms AS (
        SELECT UNNEST($1::text[]) AS term
      )
      SELECT
        kd.id AS document_id,
        kd.title,
        kd.source_uri,
        kd.metadata AS document_metadata,
        kc.id AS chunk_id,
        kc.chunk_index,
        kc.content,
        kc.metadata AS chunk_metadata,
        SUM(
          CASE WHEN kc.content ILIKE ('%' || terms.term || '%') THEN 2 ELSE 0 END +
          CASE WHEN kd.title ILIKE ('%' || terms.term || '%') THEN 3 ELSE 0 END
        )::int AS keyword_score
      FROM knowledge_chunks kc
      JOIN knowledge_documents kd ON kd.id = kc.document_id
      JOIN terms ON TRUE
      WHERE kd.status = 'active'
      GROUP BY
        kd.id,
        kd.title,
        kd.source_uri,
        kd.metadata,
        kc.id,
        kc.chunk_index,
        kc.content,
        kc.metadata
      HAVING SUM(
        CASE WHEN kc.content ILIKE ('%' || terms.term || '%') THEN 2 ELSE 0 END +
        CASE WHEN kd.title ILIKE ('%' || terms.term || '%') THEN 3 ELSE 0 END
      ) > 0
      ORDER BY keyword_score DESC, kd.updated_at DESC, kc.chunk_index ASC
      LIMIT $2
    `,
    [terms.length ? terms : [keyword], safeLimit]
  );

  return result.rows.map((row) => ({
    id: row.document_id,
    stage: "知识库检索",
    title: row.title,
    summary: String(row.content || "").slice(0, 180),
    keywords: [],
    steps: [String(row.content || "").trim()],
    notes: [
      row.source_uri ? `来源: ${row.source_uri}` : "来源: Postgres knowledge store",
    ],
    followups: [],
    source: "postgres",
    sourceUri: row.source_uri || null,
    chunkId: row.chunk_id,
    chunkIndex: row.chunk_index,
    similarity: null,
    metadata: {
      document: row.document_metadata || {},
      chunk: row.chunk_metadata || {},
      keywordScore: row.keyword_score ?? null,
    },
  }));
}

async function searchKnowledgeByVectorInPostgres({ message, limit = 3 }) {
  const safeLimit = Math.max(1, Math.min(8, Number(limit) || 3));
  const text = String(message || "").trim();
  if (!text) return [];

  const embedding = await generateEmbedding(text);
  const vectorLiteral = `[${embedding.vector.join(",")}]`;
  const result = await query(
    `
      SELECT
        kd.id AS document_id,
        kd.title,
        kd.source_uri,
        kd.metadata AS document_metadata,
        kc.id AS chunk_id,
        kc.chunk_index,
        kc.content,
        kc.metadata AS chunk_metadata,
        1 - (kc.embedding <=> $1::vector) AS similarity
      FROM knowledge_chunks kc
      JOIN knowledge_documents kd ON kd.id = kc.document_id
      WHERE kd.status = 'active'
        AND kc.embedding IS NOT NULL
      ORDER BY kc.embedding <=> $1::vector
      LIMIT $2
    `,
    [vectorLiteral, safeLimit]
  );

  return result.rows.map((row) => ({
    id: row.document_id,
    stage: "向量检索",
    title: row.title,
    summary: String(row.content || "").slice(0, 180),
    keywords: [],
    steps: [String(row.content || "").trim()],
    notes: [
      row.source_uri ? `来源: ${row.source_uri}` : "来源: Postgres knowledge store",
      typeof row.similarity === "number"
        ? `相似度: ${row.similarity.toFixed(3)}`
        : "相似度: unavailable",
    ],
    followups: [],
    source: "postgres_vector",
    sourceUri: row.source_uri || null,
    chunkId: row.chunk_id,
    chunkIndex: row.chunk_index,
    similarity: row.similarity ?? null,
    metadata: {
      document: row.document_metadata || {},
      chunk: row.chunk_metadata || {},
    },
  }));
}

module.exports = {
  getKnowledgeProvider,
  searchKnowledgeInPostgres,
  searchKnowledgeByVectorInPostgres,
};
