const fs = require("fs");
const path = require("path");
const { createHash, randomUUID } = require("crypto");

const SOURCE_DIR = process.env.KNOWLEDGE_SOURCE_DIR
  ? path.resolve(process.cwd(), process.env.KNOWLEDGE_SOURCE_DIR)
  : path.join(__dirname, "sources");
const OUTPUT_DIR = path.join(__dirname, "generated");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "chunks.jsonl");
const MAX_CHARS = Math.max(400, Number(process.env.KNOWLEDGE_CHUNK_MAX_CHARS || 900));

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function listFiles(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const nextPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(nextPath));
      continue;
    }
    if (/\.(md|txt)$/i.test(entry.name)) {
      files.push(nextPath);
    }
  }

  return files;
}

function sha1(value) {
  return createHash("sha1").update(value).digest("hex");
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function guessTitle(filePath, content) {
  const firstHeading = content.match(/^#\s+(.+)$/m);
  if (firstHeading?.[1]) return firstHeading[1].trim();
  return path.basename(filePath, path.extname(filePath));
}

function splitParagraphs(content) {
  return normalizeText(content)
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function chunkParagraphs(paragraphs, maxChars) {
  const chunks = [];
  let current = [];
  let currentLength = 0;

  for (const paragraph of paragraphs) {
    if (!paragraph) continue;

    if (paragraph.length > maxChars) {
      if (current.length) {
        chunks.push(current.join("\n\n"));
        current = [];
        currentLength = 0;
      }

      for (let start = 0; start < paragraph.length; start += maxChars) {
        chunks.push(paragraph.slice(start, start + maxChars).trim());
      }
      continue;
    }

    const nextLength = currentLength + paragraph.length + (current.length ? 2 : 0);
    if (nextLength > maxChars && current.length) {
      chunks.push(current.join("\n\n"));
      current = [paragraph];
      currentLength = paragraph.length;
      continue;
    }

    current.push(paragraph);
    currentLength = nextLength;
  }

  if (current.length) {
    chunks.push(current.join("\n\n"));
  }

  return chunks;
}

function buildDocumentRecord(filePath) {
  const rawContent = fs.readFileSync(filePath, "utf8");
  const content = normalizeText(rawContent);
  const title = guessTitle(filePath, content);
  const relativePath = path.relative(__dirname, filePath).replace(/\\/g, "/");
  const documentId = randomUUID();
  const paragraphs = splitParagraphs(content);
  const chunks = chunkParagraphs(paragraphs, MAX_CHARS);

  return {
    document: {
      id: documentId,
      title,
      source_type: "local_file",
      source_uri: relativePath,
      locale: "zh-CN",
      status: "active",
      tags: [],
      metadata: {
        contentHash: sha1(content),
        paragraphCount: paragraphs.length,
        chunkCount: chunks.length,
      },
    },
    chunks: chunks.map((chunk, index) => ({
      id: randomUUID(),
      document_id: documentId,
      chunk_index: index,
      content: chunk,
      content_tokens: null,
      embedding_model: null,
      metadata: {
        title,
        sourceUri: relativePath,
        contentHash: sha1(chunk),
      },
    })),
  };
}

function main() {
  ensureDir(OUTPUT_DIR);
  const files = listFiles(SOURCE_DIR);
  const lines = [];
  const summary = {
    documents: 0,
    chunks: 0,
    sourceDir: SOURCE_DIR,
    outputFile: OUTPUT_FILE,
  };

  for (const filePath of files) {
    const record = buildDocumentRecord(filePath);
    lines.push(
      JSON.stringify({
        type: "document",
        ...record.document,
      })
    );
    record.chunks.forEach((chunk) => {
      lines.push(
        JSON.stringify({
          type: "chunk",
          ...chunk,
        })
      );
    });

    summary.documents += 1;
    summary.chunks += record.chunks.length;
  }

  fs.writeFileSync(OUTPUT_FILE, lines.length ? `${lines.join("\n")}\n` : "", "utf8");
  console.log(JSON.stringify({ ok: true, ...summary }, null, 2));
}

main();
