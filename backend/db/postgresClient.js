const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

let pool = null;

function requirePg() {
  try {
    // Lazy load so file mode does not require the dependency at runtime.
    return require("pg");
  } catch (error) {
    const wrapped = new Error(
      'Postgres storage requires the "pg" package. Run `npm install` in backend before using STORAGE_PROVIDER=postgres.'
    );
    wrapped.cause = error;
    throw wrapped;
  }
}

function getSslConfig() {
  const raw = String(process.env.DATABASE_SSL || "").trim().toLowerCase();
  if (!raw || raw === "false" || raw === "0" || raw === "off") {
    return false;
  }
  if (raw === "require") {
    return { rejectUnauthorized: false };
  }
  return true;
}

function getDatabaseUrl() {
  return String(process.env.DATABASE_URL || "").trim();
}

function getPool() {
  if (pool) return pool;

  const connectionString = getDatabaseUrl();
  if (!connectionString) {
    throw new Error("DATABASE_URL is required when STORAGE_PROVIDER=postgres");
  }

  const { Pool } = requirePg();
  pool = new Pool({
    connectionString,
    ssl: getSslConfig(),
    max: Math.max(1, Number(process.env.DATABASE_POOL_MAX || 10)),
    idleTimeoutMillis: Math.max(1000, Number(process.env.DATABASE_IDLE_TIMEOUT_MS || 30000)),
    connectionTimeoutMillis: Math.max(
      1000,
      Number(process.env.DATABASE_CONNECT_TIMEOUT_MS || 5000)
    ),
  });

  return pool;
}

async function query(text, params) {
  return getPool().query(text, params);
}

async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

async function closePool() {
  if (!pool) return;
  const current = pool;
  pool = null;
  await current.end();
}

module.exports = {
  getDatabaseUrl,
  getPool,
  query,
  withTransaction,
  closePool,
};
