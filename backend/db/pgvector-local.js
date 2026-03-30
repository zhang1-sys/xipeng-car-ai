const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.join(__dirname, "..", "..");
const DEPLOY_DIR = path.join(REPO_ROOT, "deploy");
const COMPOSE_FILE = "docker-compose.pgvector.yml";

function getHostPort() {
  return String(process.env.POSTGRES_PORT || "5432").trim() || "5432";
}

function resolveComposeCommand() {
  const docker = spawnSync("docker", ["compose", "version"], {
    cwd: DEPLOY_DIR,
    encoding: "utf8",
  });
  if (docker.status === 0) {
    return { command: "docker", argsPrefix: ["compose"] };
  }

  const dockerCompose = spawnSync("docker-compose", ["version"], {
    cwd: DEPLOY_DIR,
    encoding: "utf8",
  });
  if (dockerCompose.status === 0) {
    return { command: "docker-compose", argsPrefix: [] };
  }

  throw new Error(
    "Docker Compose is not available. Install Docker Desktop (or docker-compose) before running local pgvector."
  );
}

function runCompose(subArgs) {
  const compose = resolveComposeCommand();
  const args = [...compose.argsPrefix, "-f", COMPOSE_FILE, ...subArgs];
  const result = spawnSync(compose.command, args, {
    cwd: DEPLOY_DIR,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exitCode = result.status || 1;
    return false;
  }

  return true;
}

function printUsage() {
  console.log(
    [
      "Usage: node db/pgvector-local.js <up|down|ps|logs>",
      "",
      "Examples:",
      "  node db/pgvector-local.js up",
      "  node db/pgvector-local.js ps",
      "  node db/pgvector-local.js down",
    ].join("\n")
  );
}

function printConnectionHint() {
  const hostPort = getHostPort();
  console.log(
    JSON.stringify(
      {
        nextEnv: {
          STORAGE_PROVIDER: "postgres",
          KNOWLEDGE_RETRIEVAL_PROVIDER: "postgres",
          DATABASE_URL: `postgresql://xpeng:xpeng_dev_password@localhost:${hostPort}/xpeng_car_ai`,
          DATABASE_SSL: "false",
          EMBEDDING_ALLOW_LOCAL_FALLBACK: "true",
        },
        nextSteps: [
          "npm run db:schema",
          "npm run db:health",
          "npm run knowledge:prepare",
          "npm run knowledge:import",
          "npm run knowledge:embed",
          "npm run knowledge:verify",
        ],
      },
      null,
      2
    )
  );
}

function main() {
  const action = String(process.argv[2] || "").trim().toLowerCase();
  if (!action || ["-h", "--help", "help"].includes(action)) {
    printUsage();
    return;
  }

  if (action === "up") {
    if (runCompose(["up", "-d"])) {
      printConnectionHint();
    }
    return;
  }

  if (action === "down") {
    runCompose(["down"]);
    return;
  }

  if (action === "ps") {
    runCompose(["ps"]);
    return;
  }

  if (action === "logs") {
    runCompose(["logs", "--tail", "100"]);
    return;
  }

  throw new Error(`Unsupported action: ${action}`);
}

try {
  main();
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
}
