const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const root = process.cwd();
// Default to standalone build to align with Docker runtime and reduce
// environment-dependent behavior between local and container builds.
const standaloneEnabled = process.argv.includes("--standalone") || process.env.NEXT_STANDALONE === "1";
const nextCli = require.resolve("next/dist/bin/next");

function ensureStandaloneNodeModules() {
  const standaloneDir = path.join(root, ".next", "standalone");
  const standaloneServer = path.join(standaloneDir, "server.js");
  const standaloneNodeModules = path.join(standaloneDir, "node_modules");

  if (!fs.existsSync(standaloneServer) || fs.existsSync(standaloneNodeModules)) {
    return;
  }

  // Prefer a junction on Windows, but fall back to copying when symlinks are
  // restricted or behave inconsistently.
  try {
    fs.symlinkSync(path.join(root, "node_modules"), standaloneNodeModules, "junction");
  } catch (error) {
    const src = path.join(root, "node_modules");
    if (!fs.existsSync(src)) throw error;

    fs.mkdirSync(standaloneNodeModules, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const from = path.join(src, entry.name);
      const to = path.join(standaloneNodeModules, entry.name);
      if (entry.isDirectory()) {
        fs.cpSync(from, to, { recursive: true });
      } else {
        fs.copyFileSync(from, to);
      }
    }
  }
}

const child = spawn(process.execPath, [nextCli, "build"], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    ...(standaloneEnabled ? { NEXT_STANDALONE: "1" } : {}),
  },
});

child.on("error", (error) => {
  console.error("[build] Failed to spawn Next.js build process:", error);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  if (code === 0 && standaloneEnabled) {
    try {
      ensureStandaloneNodeModules();
    } catch (error) {
      console.error("[build] Failed to prepare standalone node_modules:", error);
      process.exit(1);
      return;
    }
  }

  process.exit(code ?? 0);
});
