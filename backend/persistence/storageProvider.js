const path = require("path");
const { createFileStorageProvider } = require("./fileStorageProvider");
const { createPostgresStorageProvider } = require("./postgresStorageProvider");

function createStorageProvider({
  dataDir,
  createSessionState,
  trimSessionMessages,
  maxPersistedSessions,
  sessionTtlMs,
}) {
  const kind = String(process.env.STORAGE_PROVIDER || "file").trim().toLowerCase() || "file";

  if (kind === "file") {
    return createFileStorageProvider({
      dataDir,
      sessionsFile: path.join(dataDir, "sessions.json"),
      userProfilesFile: path.join(dataDir, "userProfiles.json"),
      messagesFile: path.join(dataDir, "messages.jsonl"),
      analyticsFile: path.join(dataDir, "analytics.jsonl"),
      leadsFile: path.join(dataDir, "leads.jsonl"),
      auditFile: path.join(dataDir, "ops-audit.jsonl"),
      createSessionState,
      trimSessionMessages,
      maxPersistedSessions,
      sessionTtlMs,
    });
  }

  if (kind === "postgres") {
    return createPostgresStorageProvider({
      createSessionState,
      trimSessionMessages,
      maxPersistedSessions,
      sessionTtlMs,
    });
  }

  throw new Error(
    `unsupported STORAGE_PROVIDER=${kind}; supported providers: "file", "postgres"`
  );
}

module.exports = {
  createStorageProvider,
};
