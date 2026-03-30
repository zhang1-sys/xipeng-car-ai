const fs = require("fs");
const path = require("path");

const dataDir = path.join(__dirname, "..", "data");
const targets = [
  "sessions.json",
  "messages.jsonl",
  "analytics.jsonl",
  "leads.jsonl",
  "crm-outbox.json",
  "crm-attempts.jsonl",
  "ops-audit.jsonl",
  "eval-results.json",
  "smoke-results.json",
];

function resetFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jsonl") {
    fs.writeFileSync(filePath, "", "utf8");
    return;
  }
  fs.writeFileSync(filePath, JSON.stringify([], null, 2), "utf8");
}

function main() {
  fs.mkdirSync(dataDir, { recursive: true });
  const touched = [];

  for (const name of targets) {
    const filePath = path.join(dataDir, name);
    if (name.endsWith("results.json")) {
      fs.rmSync(filePath, { force: true });
      touched.push({ file: name, action: "removed" });
      continue;
    }
    resetFile(filePath);
    touched.push({ file: name, action: "reset" });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        dataDir,
        touched,
        note: "Only runtime demo data was reset. Static business data files were not changed.",
      },
      null,
      2
    )
  );
}

main();
