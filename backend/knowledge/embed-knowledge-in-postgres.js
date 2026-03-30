const { query, closePool } = require("../db/postgresClient");
const { generateEmbedding } = require("./embeddingClient");

async function main() {
  const batchSize = Math.max(1, Math.min(50, Number(process.env.EMBEDDING_BATCH_SIZE || 10)));
  const limit = Math.max(1, Math.min(500, Number(process.env.EMBEDDING_LIMIT || 100)));

  const result = await query(
    `
      SELECT id, content
      FROM knowledge_chunks
      WHERE embedding IS NULL
      ORDER BY created_at ASC
      LIMIT $1
    `,
    [limit]
  );

  const rows = result.rows || [];
  let embedded = 0;

  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize);
    for (const row of batch) {
      const embedding = await generateEmbedding(row.content);
      await query(
        `
          UPDATE knowledge_chunks
          SET embedding = $2::vector,
              embedding_model = $3
          WHERE id = $1
        `,
        [row.id, `[${embedding.vector.join(",")}]`, embedding.model]
      );
      embedded += 1;
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        scanned: rows.length,
        embedded,
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
