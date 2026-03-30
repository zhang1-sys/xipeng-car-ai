const { query, closePool } = require("../db/postgresClient");

async function main() {
  const keyword = String(process.argv[2] || "").trim();
  const limit = Math.max(1, Math.min(10, Number(process.argv[3] || 5)));

  if (!keyword) {
    throw new Error("Usage: node knowledge/search-knowledge-postgres.js <keyword> [limit]");
  }

  const result = await query(
    `
      SELECT
        kc.id,
        kc.document_id,
        kc.chunk_index,
        kc.content,
        kd.title,
        kd.source_uri,
        kc.metadata
      FROM knowledge_chunks kc
      JOIN knowledge_documents kd ON kd.id = kc.document_id
      WHERE kc.content ILIKE $1
         OR kd.title ILIKE $1
      ORDER BY kd.updated_at DESC, kc.chunk_index ASC
      LIMIT $2
    `,
    [`%${keyword}%`, limit]
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        keyword,
        limit,
        count: result.rows.length,
        items: result.rows.map((row) => ({
          id: row.id,
          documentId: row.document_id,
          chunkIndex: row.chunk_index,
          title: row.title,
          sourceUri: row.source_uri,
          preview: String(row.content || "").slice(0, 180),
          metadata: row.metadata || {},
        })),
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
