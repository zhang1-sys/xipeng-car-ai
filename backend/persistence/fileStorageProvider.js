const fs = require("fs");
const {
  readJsonFile,
  readJsonLines,
  writeJsonFile,
  appendJsonLine,
} = require("./filePersistence");
const {
  applyCrmRetention,
  enqueueCrmOutbox: enqueueFileCrmOutbox,
  syncCrmOutbox: syncFileCrmOutbox,
  acknowledgeCrmOutbox: acknowledgeFileCrmOutbox,
  getCrmSyncSummary: getFileCrmSyncSummary,
  listCrmOutbox: listFileCrmOutbox,
} = require("../crmSync");
const {
  sanitizeAuditEvent,
  sanitizeConversationEvent,
  sanitizeLeadRecord,
  sanitizeSensitiveValue,
} = require("../privacy");
const { getRetentionPolicy } = require("../runtimePolicy");

function parseTimeMs(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : 0;
}

function rewriteJsonLines(filePath, items) {
  fs.writeFileSync(
    filePath,
    items.map((item) => JSON.stringify(item)).join("\n") + (items.length ? "\n" : ""),
    "utf8"
  );
}

function createFileStorageProvider({
  dataDir,
  sessionsFile,
  userProfilesFile,
  messagesFile,
  analyticsFile,
  leadsFile,
  auditFile,
  createSessionState,
  trimSessionMessages,
  maxPersistedSessions,
  sessionTtlMs,
}) {
  function retentionPolicy() {
    return getRetentionPolicy({ sessionTtlMs });
  }

  function loadSessions() {
    const policy = retentionPolicy();
    const sessionCutoffMs = Date.now() - policy.sessionMs;
    const raw = readJsonFile(sessionsFile, null);
    const entries = Array.isArray(raw?.sessions) ? raw.sessions : [];
    return entries
      .filter((entry) => {
        if (!entry?.id) return false;
        const ts = parseTimeMs(entry?.state?.lastActiveAt || entry?.state?.createdAt);
        return !ts || ts >= sessionCutoffMs;
      })
      .map((entry) => ({
        id: entry.id,
        state: {
          ...createSessionState(),
          ...entry.state,
        },
      }));
  }

  function persistSessions(sessionEntries) {
    const policy = retentionPolicy();
    const sessionCutoffMs = Date.now() - policy.sessionMs;
    const serialized = sessionEntries
      .filter(([, state]) => {
        const ts = parseTimeMs(state?.lastActiveAt || state?.createdAt);
        return !ts || ts >= sessionCutoffMs;
      })
      .map(([id, state]) => ({
        id,
        state: {
          ...createSessionState(),
          ...state,
          profile: sanitizeSensitiveValue(
            state?.profile && typeof state.profile === "object" ? state.profile : {}
          ),
          userProfile: sanitizeSensitiveValue(
            state?.userProfile && typeof state.userProfile === "object" ? state.userProfile : {}
          ),
          userMemorySummary: sanitizeSensitiveValue(state?.userMemorySummary || "", {
            maskPlainTextAddresses: true,
          }),
          taskMemory: sanitizeSensitiveValue(
            state?.taskMemory && typeof state.taskMemory === "object" ? state.taskMemory : {},
            {
              maskPlainTextAddresses: true,
            }
          ),
          clientProfileId: String(state?.clientProfileId || ""),
          memorySummary: sanitizeSensitiveValue(state?.memorySummary || "", {
            maskPlainTextAddresses: true,
          }),
          messages: sanitizeSensitiveValue(
            trimSessionMessages(Array.isArray(state?.messages) ? state.messages : []),
            {
              maskPlainTextAddresses: true,
            }
          ),
          turns: sanitizeSensitiveValue(Array.isArray(state?.turns) ? state.turns.slice(-20) : [], {
            maskPlainTextAddresses: true,
          }),
        },
      }))
      .sort((a, b) =>
        String(b.state?.lastActiveAt || "").localeCompare(String(a.state?.lastActiveAt || ""))
      )
      .slice(0, maxPersistedSessions);

    writeJsonFile(sessionsFile, {
      savedAt: new Date().toISOString(),
      sessions: serialized,
    });
  }

  function loadUserProfiles() {
    const raw = readJsonFile(userProfilesFile, null);
    const entries = Array.isArray(raw?.profiles) ? raw.profiles : [];
    return entries
      .filter((entry) => entry?.id)
      .map((entry) => ({
        id: entry.id,
        state: {
          profile: entry?.state?.profile && typeof entry.state.profile === "object" ? entry.state.profile : {},
          memorySummary: String(entry?.state?.memorySummary || ""),
          recentGoals: Array.isArray(entry?.state?.recentGoals) ? entry.state.recentGoals : [],
          lastMode: String(entry?.state?.lastMode || ""),
          lastTaskMemory:
            entry?.state?.lastTaskMemory && typeof entry.state.lastTaskMemory === "object"
              ? entry.state.lastTaskMemory
              : {},
          createdAt: String(entry?.state?.createdAt || ""),
          updatedAt: String(entry?.state?.updatedAt || ""),
        },
      }));
  }

  function persistUserProfiles(userEntries) {
    const serialized = userEntries
      .filter(([id]) => Boolean(id))
      .map(([id, state]) => ({
        id,
        state: {
          profile: sanitizeSensitiveValue(
            state?.profile && typeof state.profile === "object" ? state.profile : {}
          ),
          memorySummary: sanitizeSensitiveValue(state?.memorySummary || "", {
            maskPlainTextAddresses: true,
          }),
          recentGoals: sanitizeSensitiveValue(
            Array.isArray(state?.recentGoals) ? state.recentGoals.slice(-12) : [],
            { maskPlainTextAddresses: true }
          ),
          lastMode: String(state?.lastMode || ""),
          lastTaskMemory: sanitizeSensitiveValue(
            state?.lastTaskMemory && typeof state.lastTaskMemory === "object"
              ? state.lastTaskMemory
              : {},
            { maskPlainTextAddresses: true }
          ),
          createdAt: state?.createdAt || new Date().toISOString(),
          updatedAt: state?.updatedAt || new Date().toISOString(),
        },
      }))
      .sort((a, b) =>
        String(b.state?.updatedAt || "").localeCompare(String(a.state?.updatedAt || ""))
      )
      .slice(0, 1000);

    writeJsonFile(userProfilesFile, {
      savedAt: new Date().toISOString(),
      profiles: serialized,
    });
  }

  function appendConversationEvent(event) {
    appendJsonLine(messagesFile, {
      ...sanitizeConversationEvent(event),
      recordedAt: new Date().toISOString(),
    });
  }

  function appendAnalyticsEvent(event) {
    appendJsonLine(analyticsFile, event);
  }

  function listConversationEvents(limit = 200, sessionId = null) {
    const safeLimit = Math.max(1, Math.min(5000, Number(limit) || 200));
    const rows = readJsonLines(messagesFile).filter((item) => {
      if (!sessionId) return true;
      return item?.sessionId === sessionId;
    });
    return rows.slice(-safeLimit).reverse();
  }

  function listAnalyticsEvents() {
    return readJsonLines(analyticsFile);
  }

  function listLeadRecords() {
    return readJsonLines(leadsFile);
  }

  function appendLeadRecord(lead) {
    const records = readJsonLines(leadsFile).filter((item) => item?.id && item.id !== lead.id);
    records.push(sanitizeLeadRecord(lead));
    rewriteJsonLines(leadsFile, records);
  }

  function enqueueCrmOutbox(args) {
    return enqueueFileCrmOutbox({
      dataDir,
      ...args,
    });
  }

  function syncCrmOutbox(options = {}) {
    return syncFileCrmOutbox({
      dataDir,
      ...options,
    });
  }

  function getCrmSyncSummary() {
    return getFileCrmSyncSummary({ dataDir });
  }

  function acknowledgeCrmOutbox(options = {}) {
    return acknowledgeFileCrmOutbox({
      dataDir,
      ...options,
    });
  }

  function listCrmOutbox(limit = 20) {
    return listFileCrmOutbox({ dataDir, limit });
  }

  function appendAuditEvent(event) {
    appendJsonLine(auditFile, {
      ...sanitizeAuditEvent(event),
      createdAt: event?.createdAt || new Date().toISOString(),
    });
  }

  function listAuditEvents(limit = 50) {
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 50));
    return readJsonLines(auditFile).slice(-safeLimit).reverse();
  }

  function getAuditSummary() {
    const rows = readJsonLines(auditFile);
    const counts = rows.reduce(
      (acc, item) => {
        acc.total += 1;
        const outcome = String(item?.outcome || "unknown");
        acc.byOutcome[outcome] = (acc.byOutcome[outcome] || 0) + 1;
        return acc;
      },
      { total: 0, byOutcome: {} }
    );

    return {
      ...counts,
      recent: rows.slice(-10).reverse(),
    };
  }

  function applyRetentionPolicy() {
    const policy = retentionPolicy();
    const summary = {
      appliedAt: new Date().toISOString(),
      policy,
      removed: {
        sessions: 0,
        conversationEvents: 0,
        leads: 0,
        crmOutbox: 0,
        crmAttempts: 0,
        auditLog: 0,
      },
      removedTotal: 0,
    };
    const now = Date.now();

    const sessionsPayload = readJsonFile(sessionsFile, { sessions: [] });
    const originalSessions = Array.isArray(sessionsPayload.sessions) ? sessionsPayload.sessions : [];
    const keptSessions = originalSessions.filter((entry) => {
      const ts = parseTimeMs(entry?.state?.lastActiveAt || entry?.state?.createdAt);
      return !ts || ts >= now - policy.sessionMs;
    });
    summary.removed.sessions = Math.max(0, originalSessions.length - keptSessions.length);
    if (summary.removed.sessions > 0) {
      writeJsonFile(sessionsFile, {
        savedAt: new Date().toISOString(),
        sessions: keptSessions,
      });
    }

    const originalMessages = readJsonLines(messagesFile);
    const keptMessages = originalMessages.filter((item) => {
      const ts = parseTimeMs(item?.recordedAt || item?.createdAt);
      return !ts || ts >= now - policy.replayMs;
    });
    summary.removed.conversationEvents = Math.max(0, originalMessages.length - keptMessages.length);
    if (summary.removed.conversationEvents > 0) {
      rewriteJsonLines(messagesFile, keptMessages);
    }

    const originalLeads = readJsonLines(leadsFile);
    const keptLeads = originalLeads.filter((item) => {
      const ts = parseTimeMs(item?.createdAt || item?.updatedAt);
      return !ts || ts >= now - policy.leadMs;
    });
    summary.removed.leads = Math.max(0, originalLeads.length - keptLeads.length);
    if (summary.removed.leads > 0) {
      rewriteJsonLines(leadsFile, keptLeads);
    }

    const originalAudit = readJsonLines(auditFile);
    const keptAudit = originalAudit.filter((item) => {
      const ts = parseTimeMs(item?.createdAt);
      return !ts || ts >= now - policy.auditMs;
    });
    summary.removed.auditLog = Math.max(0, originalAudit.length - keptAudit.length);
    if (summary.removed.auditLog > 0) {
      rewriteJsonLines(auditFile, keptAudit);
    }

    const crmSummary = applyCrmRetention({ dataDir, retention: policy });
    summary.removed.crmOutbox = crmSummary.crmOutbox;
    summary.removed.crmAttempts = crmSummary.crmAttempts;
    summary.removedTotal = Object.values(summary.removed).reduce(
      (acc, value) => acc + Number(value || 0),
      0
    );

    return summary;
  }

  return {
    kind: "file",
    paths: {
      dataDir,
      sessionsFile,
      userProfilesFile,
      messagesFile,
      analyticsFile,
      leadsFile,
      auditFile,
    },
    loadSessions,
    persistSessions,
    loadUserProfiles,
    persistUserProfiles,
    appendConversationEvent,
    appendAnalyticsEvent,
    appendLeadRecord,
    listConversationEvents,
    listAnalyticsEvents,
    listLeadRecords,
    enqueueCrmOutbox,
    syncCrmOutbox,
    getCrmSyncSummary,
    acknowledgeCrmOutbox,
    listCrmOutbox,
    appendAuditEvent,
    listAuditEvents,
    getAuditSummary,
    applyRetentionPolicy,
  };
}

module.exports = {
  createFileStorageProvider,
};
