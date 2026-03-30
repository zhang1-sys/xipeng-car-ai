const path = require("path");
const crypto = require("crypto");
const OpenAI = require("openai");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

let cachedClient = null;
let cachedKey = "";

function readBoolEnv(name) {
  const raw = String(process.env[name] || "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(raw);
}

function normalizeLocalVector(vector) {
  let norm = 0;
  for (const value of vector) {
    norm += value * value;
  }

  if (!norm) {
    vector[0] = 1;
    return vector;
  }

  const scale = Math.sqrt(norm);
  return vector.map((value) => Number((value / scale).toFixed(8)));
}

function generateLocalEmbedding(text, dimensions) {
  const safeDimensions = Math.max(1, Number(dimensions || 1536));
  const vector = new Array(safeDimensions).fill(0);
  const normalizedText = String(text || "").trim().toLowerCase();
  const tokens =
    normalizedText.match(/[\p{L}\p{N}]+/gu) ||
    normalizedText.split(/\s+/).map((item) => item.trim()).filter(Boolean);

  if (!tokens.length) {
    return {
      vector: normalizeLocalVector(vector),
      model: `local-hash-${safeDimensions}`,
      dimensions: safeDimensions,
      provider: "local",
    };
  }

  for (const token of tokens) {
    const digest = crypto.createHash("sha256").update(token).digest();
    const bucket = digest.readUInt16BE(0) % safeDimensions;
    const sign = digest[2] % 2 === 0 ? 1 : -1;
    const magnitude = 1 + (digest[3] % 5);
    vector[bucket] += sign * magnitude;
  }

  return {
    vector: normalizeLocalVector(vector),
    model: `local-hash-${safeDimensions}`,
    dimensions: safeDimensions,
    provider: "local",
  };
}

function getEmbeddingConfig() {
  const requestedProvider = String(process.env.EMBEDDING_PROVIDER || "")
    .trim()
    .toLowerCase();
  const apiKey =
    process.env.EMBEDDING_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.MOONSHOT_API_KEY ||
    "";
  const baseURL =
    process.env.EMBEDDING_BASE_URL ||
    process.env.OPENAI_BASE_URL ||
    (process.env.MOONSHOT_API_KEY ? process.env.MOONSHOT_BASE_URL || "https://api.moonshot.cn/v1" : "");
  const model =
    process.env.EMBEDDING_MODEL ||
    process.env.OPENAI_EMBEDDING_MODEL ||
    "text-embedding-3-small";
  const dimensions = Math.max(1, Number(process.env.EMBEDDING_DIMENSION || 1536));
  const allowLocalFallback = readBoolEnv("EMBEDDING_ALLOW_LOCAL_FALLBACK");
  const provider = requestedProvider === "local" ? "local" : "remote";
  return {
    apiKey,
    baseURL: baseURL || undefined,
    model,
    dimensions,
    provider,
    allowLocalFallback,
  };
}

function getEmbeddingClient() {
  const config = getEmbeddingConfig();
  if (config.provider === "local") {
    return { client: null, config };
  }
  if (!config.apiKey) {
    return { client: null, config };
  }

  const cacheKey = `${config.apiKey}|${config.baseURL || ""}`;
  if (!cachedClient || cachedKey !== cacheKey) {
    cachedClient = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      maxRetries: 1,
      timeout: Math.max(3000, Number(process.env.EMBEDDING_TIMEOUT_MS || 15000)),
    });
    cachedKey = cacheKey;
  }

  return { client: cachedClient, config };
}

async function generateEmbedding(text) {
  const { client, config } = getEmbeddingClient();
  if (config.provider === "local") {
    return generateLocalEmbedding(text, config.dimensions);
  }

  const fallbackToLocal = () => generateLocalEmbedding(text, config.dimensions);

  if (!config.apiKey) {
    if (config.allowLocalFallback) {
      return fallbackToLocal();
    }
    throw new Error("Embedding API key is not configured");
  }

  try {
    const response = await client.embeddings.create({
      model: config.model,
      input: String(text || ""),
    });
    const vector = response.data?.[0]?.embedding;
    if (!Array.isArray(vector) || !vector.length) {
      throw new Error("Embedding response did not include a usable vector");
    }
    return {
      vector,
      model: config.model,
      dimensions: vector.length,
      provider: "remote",
    };
  } catch (error) {
    if (config.allowLocalFallback) {
      return fallbackToLocal();
    }
    throw error;
  }
}

module.exports = {
  getEmbeddingConfig,
  generateEmbedding,
};
