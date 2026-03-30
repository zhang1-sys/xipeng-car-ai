const fs = require("fs");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { query, closePool, getDatabaseUrl } = require("./postgresClient");

const DEFAULT_SCHEMA_FILE = path.join(__dirname, "schema.sql");

async function main() {
  const schemaFile = process.argv[2]
    ? path.resolve(process.cwd(), process.argv[2])
    : DEFAULT_SCHEMA_FILE;

  if (!getDatabaseUrl()) {
    throw new Error("DATABASE_URL is not set");
  }
  if (!fs.existsSync(schemaFile)) {
    throw new Error(`Schema file not found: ${schemaFile}`);
  }

  const sql = fs.readFileSync(schemaFile, "utf8").trim();
  if (!sql) {
    throw new Error(`Schema file is empty: ${schemaFile}`);
  }

  await query(sql);

  console.log(
    JSON.stringify(
      {
        ok: true,
        schemaFile,
        message: "Schema applied successfully",
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
    await closePool().catch(() => {});
  }
})();
