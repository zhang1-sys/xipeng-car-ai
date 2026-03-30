const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

const dataDir = path.join(__dirname, "..", "data");
const outDir = path.join(__dirname, "seeds");

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return fallback;
  }
}

function readJsonLines(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    return fs
      .readFileSync(filePath, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean);
  } catch (_) {
    return [];
  }
}

function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "NULL";
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "object") {
    return `${sqlString(JSON.stringify(value))}::jsonb`;
  }
  return sqlString(String(value));
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function insertSql(tableName, row) {
  const columns = Object.keys(row);
  const values = columns.map((column) => sqlValue(row[column]));
  return `INSERT INTO ${tableName} (${columns.join(", ")}) VALUES (${values.join(", ")});`;
}

function toIso(value, fallback = null) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : fallback;
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function buildSessionRows() {
  const sessionsPayload = readJson(path.join(dataDir, "sessions.json"), { sessions: [] });
  const sessionRows = [];
  const profileRows = [];
  const messageRows = [];

  for (const entry of Array.isArray(sessionsPayload.sessions) ? sessionsPayload.sessions : []) {
    if (!entry?.id || !entry?.state) continue;

    const createdAt = toIso(entry.state.createdAt, new Date().toISOString());
    const updatedAt = toIso(entry.state.lastActiveAt, createdAt);

    sessionRows.push({
      id: entry.id,
      user_id: null,
      channel: "web",
      source: "xpeng-car-ai-web",
      status: "active",
      last_mode: entry.state.lastMode || null,
      memory_summary: entry.state.memorySummary || "",
      metadata: {},
      created_at: createdAt,
      updated_at: updatedAt,
      expires_at: null,
    });

    profileRows.push({
      id: randomUUID(),
      session_id: entry.id,
      profile: entry.state.profile || {},
      summary: entry.state.memorySummary || "",
      version: 1,
      created_at: createdAt,
      updated_at: updatedAt,
    });

    const messages = Array.isArray(entry.state.messages) ? entry.state.messages : [];
    messages.forEach((message, index) => {
      messageRows.push({
        id: randomUUID(),
        session_id: entry.id,
        request_id: null,
        role: message.role || "assistant",
        mode: entry.state.lastMode || null,
        content: String(message.content || ""),
        structured: null,
        agent: null,
        metadata: {
          importedFrom: "sessions.json",
          order: index,
        },
        created_at: updatedAt,
      });
    });
  }

  return { sessionRows, profileRows, messageRows };
}

function buildConversationEventRows() {
  const rows = [];
  const messages = readJsonLines(path.join(dataDir, "messages.jsonl"));

  for (const item of messages) {
    if (!item?.sessionId) continue;
    rows.push({
      id: randomUUID(),
      session_id: item.sessionId,
      request_id: item.requestId || null,
      route: item.route || (item.stream ? "/api/chat/stream" : "/api/chat"),
      mode: item.mode || null,
      stream: item.stream === true,
      user_message: String(item.userMessage || ""),
      assistant_reply: String(item.assistantReply || ""),
      structured: item.structured || null,
      agent: item.agent || null,
      metadata: {
        importedFrom: "messages.jsonl",
      },
      created_at: toIso(item.recordedAt, new Date().toISOString()),
    });
  }

  return rows;
}

function buildLeadRows() {
  const leads = readJsonLines(path.join(dataDir, "leads.jsonl"));
  const leadRows = [];
  const leadEventRows = [];

  for (const lead of leads) {
    if (!lead?.id) continue;

    const createdAt = toIso(lead.createdAt, new Date().toISOString());
    const updatedAt = createdAt;
    leadRows.push({
      id: lead.id,
      session_id: null,
      request_id: null,
      source: lead.source || "xpeng-car-ai-web",
      name: lead.name || "",
      phone: lead.phone || "",
      preferred_time: lead.preferredTime || null,
      car_model: lead.carModel || null,
      remark: lead.remark || null,
      purchase_stage: lead.purchaseStage || null,
      buy_timeline: lead.buyTimeline || null,
      privacy_consent: lead.privacyConsent === true,
      contact_consent: lead.contactConsent === true,
      user_city: lead.userCity || null,
      user_lat: lead.userLat ?? null,
      user_lng: lead.userLng ?? null,
      inferred_brand: lead.inferredBrand || null,
      assigned_store_id: lead.assignedStoreId || null,
      assigned_store_name: lead.assignedStoreName || null,
      assigned_store_city: lead.assignedStoreCity || null,
      routing_method: lead.routingMethod || null,
      distance_km: lead.distanceKm ?? null,
      driving_duration_min: lead.drivingDurationMin ?? null,
      lead_score: lead.leadScore ?? null,
      lead_stage: lead.leadStage || null,
      lead_priority: lead.leadPriority || null,
      next_best_actions: lead.nextBestActions || [],
      score_reasons: lead.scoreReasons || [],
      assigned_advisor: lead.assignedAdvisor || null,
      crm_payload: lead.crm || null,
      crm_sync: lead.crmSync || null,
      versions: lead.versions || {},
      metadata: {
        importedFrom: "leads.jsonl",
      },
      created_at: createdAt,
      updated_at: updatedAt,
    });

    leadEventRows.push({
      id: randomUUID(),
      lead_id: lead.id,
      event_type: "lead_imported",
      event_status: lead.leadStage || "captured",
      payload: {
        routingMethod: lead.routingMethod || null,
        assignedStoreId: lead.assignedStoreId || null,
      },
      created_at: createdAt,
    });
  }

  return { leadRows, leadEventRows };
}

function buildAgentRunRows() {
  const analytics = readJsonLines(path.join(dataDir, "analytics.jsonl"));
  const agentRunRows = [];
  const toolCallRows = [];

  for (const item of analytics) {
    const agentRunId = randomUUID();
    const createdAt = toIso(item.ts, new Date().toISOString());
    agentRunRows.push({
      id: agentRunId,
      session_id: item.sessionId || null,
      request_id: item.requestId || null,
      route: item.route || (item.stream ? "/api/chat/stream" : "/api/chat"),
      mode: item.mode || null,
      response_source: null,
      status: "completed",
      agent_release: item.agentRelease || null,
      prompt_version: item.promptVersion || null,
      policy_version: item.policyVersion || null,
      eval_dataset_version: item.evalDatasetVersion || null,
      total_ms: item.totalMs ?? null,
      planning_ms: null,
      synthesis_ms: null,
      agent_turns: item.agentTurns ?? null,
      has_structured: item.hasStructured === true,
      stream: item.stream === true,
      error_message: null,
      metadata: {
        importedFrom: "analytics.jsonl",
        ip: item.ip || null,
      },
      created_at: createdAt,
    });

    (Array.isArray(item.toolsUsed) ? item.toolsUsed : []).forEach((toolName, index) => {
      toolCallRows.push({
        id: randomUUID(),
        agent_run_id: agentRunId,
        tool_name: toolName,
        call_order: index + 1,
        status: "completed",
        latency_ms: null,
        summary: null,
        args: {},
        result: null,
        created_at: createdAt,
      });
    });
  }

  return { agentRunRows, toolCallRows };
}

function buildCrmOutboxRows() {
  const outbox = readJson(path.join(dataDir, "crm-outbox.json"), { items: [] });
  const rows = [];

  for (const item of Array.isArray(outbox.items) ? outbox.items : []) {
    if (!item?.id) continue;
    rows.push({
      id: item.id,
      lead_id: item.externalLeadId || null,
      request_id: item.requestId || null,
      external_lead_id: item.externalLeadId || null,
      payload_version: item.payloadVersion || null,
      status: item.status || "queued",
      attempts: item.attempts ?? 0,
      sync_enabled: item.syncEnabled === true,
      next_attempt_at: toIso(item.nextAttemptAt),
      last_attempt_at: toIso(item.lastAttemptAt),
      last_error: item.lastError || null,
      last_http_status: item.lastHttpStatus ?? null,
      synced_at: toIso(item.syncedAt),
      customer_summary: item.customer || {},
      payload: item.payload || {},
      created_at: toIso(item.createdAt, new Date().toISOString()),
      updated_at: toIso(item.updatedAt, new Date().toISOString()),
    });
  }

  return rows;
}

function main() {
  ensureDir(outDir);
  const outputPath =
    process.argv[2] && process.argv[2].trim()
      ? path.resolve(process.cwd(), process.argv[2])
      : path.join(outDir, "file-storage-export.sql");

  const statements = [];
  statements.push("-- Generated from local file-backed storage");
  statements.push("-- Review before applying to a live database");
  statements.push("BEGIN;");

  const { sessionRows, profileRows, messageRows } = buildSessionRows();
  const conversationEventRows = buildConversationEventRows();
  const { leadRows, leadEventRows } = buildLeadRows();
  const { agentRunRows, toolCallRows } = buildAgentRunRows();
  const crmOutboxRows = buildCrmOutboxRows();

  [
    ["sessions", sessionRows],
    ["memory_profiles", profileRows],
    ["messages", messageRows],
    ["conversation_events", conversationEventRows],
    ["leads", leadRows],
    ["lead_events", leadEventRows],
    ["agent_runs", agentRunRows],
    ["tool_calls", toolCallRows],
    ["crm_outbox", crmOutboxRows],
  ].forEach(([tableName, rows]) => {
    if (!rows.length) return;
    statements.push(`-- ${tableName}: ${rows.length} rows`);
    rows.forEach((row) => statements.push(insertSql(tableName, row)));
    statements.push("");
  });

  statements.push("COMMIT;");
  fs.writeFileSync(outputPath, `${statements.join("\n")}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputPath,
        counts: {
          sessions: sessionRows.length,
          memory_profiles: profileRows.length,
          messages: messageRows.length,
          conversation_events: conversationEventRows.length,
          leads: leadRows.length,
          lead_events: leadEventRows.length,
          agent_runs: agentRunRows.length,
          tool_calls: toolCallRows.length,
          crm_outbox: crmOutboxRows.length,
        },
      },
      null,
      2
    )
  );
}

main();
