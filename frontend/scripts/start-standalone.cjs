const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const root = process.cwd();
const standaloneServer = path.join(root, ".next", "standalone", "server.js");
const standaloneStatic = path.join(root, ".next", "standalone", ".next", "static");
const buildStatic = path.join(root, ".next", "static");
const nextCli = require.resolve("next/dist/bin/next");

function copyDir(source, target) {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(target, { recursive: true });

  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const src = path.join(source, entry.name);
    const dest = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyDir(src, dest);
    } else {
      fs.copyFileSync(src, dest);
    }
  }
}

const env = {
  ...process.env,
  PORT: process.env.PORT || "3000",
  HOSTNAME: process.env.HOSTNAME || "0.0.0.0",
};

let child;
if (fs.existsSync(standaloneServer)) {
  copyDir(buildStatic, standaloneStatic);
  child = spawn(process.execPath, [standaloneServer], {
    cwd: path.dirname(standaloneServer),
    stdio: "inherit",
    env,
  });
} else {
  child = spawn(process.execPath, [nextCli, "start", "-H", env.HOSTNAME, "-p", env.PORT], {
    cwd: root,
    stdio: "inherit",
    env,
  });
}

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
