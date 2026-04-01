const fs = require("fs");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { query, closePool, getDatabaseUrl } = require("./postgresClient");

const DEFAULT_SCHEMA_FILE = path.join(__dirname, "schema.sql");

function resolveSchemaFile(schemaFile) {
  if (!schemaFile) return DEFAULT_SCHEMA_FILE;
  return path.resolve(process.cwd(), schemaFile);
}

function readSchemaSql(schemaFile = DEFAULT_SCHEMA_FILE) {
  const resolvedFile = resolveSchemaFile(schemaFile);
  if (!getDatabaseUrl()) {
    throw new Error("DATABASE_URL is not set");
  }
  if (!fs.existsSync(resolvedFile)) {
    throw new Error(`Schema file not found: ${resolvedFile}`);
  }

  const sql = fs.readFileSync(resolvedFile, "utf8").trim();
  if (!sql) {
    throw new Error(`Schema file is empty: ${resolvedFile}`);
  }

  return {
    schemaFile: resolvedFile,
    sql,
  };
}

async function applySchema(schemaFile = DEFAULT_SCHEMA_FILE) {
  const { schemaFile: resolvedFile, sql } = readSchemaSql(schemaFile);

  await query(sql);

  return {
    ok: true,
    schemaFile: resolvedFile,
    message: "Schema applied successfully",
  };
}

async function main() {
  const result = await applySchema(process.argv[2]);

  console.log(
    JSON.stringify(result, null, 2)
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

module.exports = {
  DEFAULT_SCHEMA_FILE,
  applySchema,
  readSchemaSql,
  resolveSchemaFile,
};
