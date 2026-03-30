const fs = require("fs");
const path = require("path");
const { KNOWLEDGE_ITEMS } = require("../serviceKnowledge");

const outputRoot = path.join(__dirname, "sources", "service-knowledge");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function safeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function renderDoc(item) {
  return [
    `# ${item.title}`,
    "",
    `- 阶段: ${item.stage}`,
    `- ID: ${item.id}`,
    "",
    "## 摘要",
    "",
    item.summary,
    "",
    "## 关键词",
    "",
    (item.keywords || []).map((keyword) => `- ${keyword}`).join("\n"),
    "",
    "## 操作建议",
    "",
    (item.steps || []).map((step, index) => `${index + 1}. ${step}`).join("\n"),
    "",
    "## 注意事项",
    "",
    (item.notes || []).map((note) => `- ${note}`).join("\n"),
    "",
    "## 推荐追问",
    "",
    (item.followups || []).map((followup) => `- ${followup}`).join("\n"),
    "",
  ].join("\n");
}

function main() {
  ensureDir(outputRoot);
  const written = [];

  for (const item of KNOWLEDGE_ITEMS) {
    const fileName = `${safeName(item.id)}.md`;
    const filePath = path.join(outputRoot, fileName);
    fs.writeFileSync(filePath, renderDoc(item), "utf8");
    written.push(filePath);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputDir: outputRoot,
        filesWritten: written.length,
      },
      null,
      2
    )
  );
}

main();
