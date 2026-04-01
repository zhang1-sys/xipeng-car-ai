const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const root = process.cwd();
const standaloneServer = path.join(root, ".next", "standalone", "server.js");
const standaloneStatic = path.join(root, ".next", "standalone", ".next", "static");
const buildStatic = path.join(root, ".next", "static");
const standaloneServerDir = path.join(root, ".next", "standalone", ".next", "server");
const buildServerDir = path.join(root, ".next", "server");
const publicDir = path.join(root, "public");
const standalonePublic = path.join(root, ".next", "standalone", "public");
const nextCli = require.resolve("next/dist/bin/next");
const requiredNextFiles = [
  "BUILD_ID",
  "app-build-manifest.json",
  "build-manifest.json",
  "middleware-manifest.json",
  "prerender-manifest.json",
  "react-loadable-manifest.json",
  "routes-manifest.json",
];

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

function copyFileIfExists(source, target) {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

const env = {
  ...process.env,
  PORT: process.env.PORT || "3000",
  HOSTNAME: process.env.HOSTNAME || "0.0.0.0",
};

let child;
if (fs.existsSync(standaloneServer)) {
  copyDir(buildStatic, standaloneStatic);
  copyDir(buildServerDir, standaloneServerDir);
  copyDir(publicDir, standalonePublic);
  for (const fileName of requiredNextFiles) {
    copyFileIfExists(
      path.join(root, ".next", fileName),
      path.join(root, ".next", "standalone", ".next", fileName)
    );
  }
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
