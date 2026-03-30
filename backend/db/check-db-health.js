const { query, closePool, getDatabaseUrl } = require("./postgresClient");

async function main() {
  const startedAt = Date.now();
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  const result = await query(
    `
      SELECT NOW() AS now,
             current_database() AS database_name,
             current_user AS current_user,
             version() AS server_version
    `
  );
  const row = result.rows[0] || {};

  let vectorEnabled = false;
  try {
    const extensionResult = await query(
      `
        SELECT EXISTS (
          SELECT 1
          FROM pg_extension
          WHERE extname = 'vector'
        ) AS enabled
      `
    );
    vectorEnabled = extensionResult.rows[0]?.enabled === true;
  } catch (_) {}

  console.log(
    JSON.stringify(
      {
        ok: true,
        database: row.database_name || null,
        currentUser: row.current_user || null,
        now: row.now || null,
        vectorEnabled,
        durationMs: Date.now() - startedAt,
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
