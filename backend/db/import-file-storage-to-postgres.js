const path = require("path");
const { randomUUID } = require("crypto");
const { readJsonFile, readJsonLines } = require("../persistence/filePersistence");
const { withTransaction, closePool } = require("./postgresClient");
const { createSessionState } = require("../commercialAgent");

const dataDir = path.join(__dirname, "..", "data");

function toIso(value, fallback = new Date().toISOString()) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : fallback;
}

function bool(value) {
  return value === true;
}

function loadSessionEntries() {
  const payload = readJsonFile(path.join(dataDir, "sessions.json"), { sessions: [] });
  return Array.isArray(payload.sessions) ? payload.sessions : [];
}

function loadLeads() {
  return readJsonLines(path.join(dataDir, "leads.jsonl"));
}

function loadAnalytics() {
  return readJsonLines(path.join(dataDir, "analytics.jsonl"));
}

function loadConversationEvents() {
  return readJsonLines(path.join(dataDir, "messages.jsonl"));
}

function loadCrmOutbox() {
  const payload = readJsonFile(path.join(dataDir, "crm-outbox.json"), { items: [] });
  return Array.isArray(payload.items) ? payload.items : [];
}

async function maybeTruncate(client) {
  if (String(process.env.IMPORT_TRUNCATE || "").trim().toLowerCase() !== "true") {
    return;
  }

  await client.query(`
    TRUNCATE TABLE
      tool_calls,
      agent_runs,
      crm_outbox,
      lead_events,
      leads,
      conversation_events,
      messages,
      memory_profiles,
      sessions
    RESTART IDENTITY CASCADE
  `);
}

async function importSessions(client, sessionEntries) {
  for (const entry of sessionEntries) {
    if (!entry?.id) continue;
    const baseState = createSessionState();
    const state = {
      ...baseState,
      ...(entry.state || {}),
    };
    const createdAt = toIso(state.createdAt);
    const updatedAt = toIso(state.lastActiveAt, createdAt);

    await client.query(
      `
        INSERT INTO sessions (
          id, channel, source, status, last_mode, memory_summary, metadata, created_at, updated_at
        )
        VALUES ($1, 'web', 'xpeng-car-ai-web', 'active', $2, $3, $4::jsonb, $5, $6)
        ON CONFLICT (id) DO UPDATE SET
          last_mode = EXCLUDED.last_mode,
          memory_summary = EXCLUDED.memory_summary,
          metadata = EXCLUDED.metadata,
          updated_at = EXCLUDED.updated_at
      `,
      [
        entry.id,
        state.lastMode || null,
        state.memorySummary || "",
        JSON.stringify({ turns: Array.isArray(state.turns) ? state.turns : [] }),
        createdAt,
        updatedAt,
      ]
    );

    await client.query(
      `
        INSERT INTO memory_profiles (id, session_id, profile, summary, version, created_at, updated_at)
        VALUES ($1, $2, $3::jsonb, $4, 1, $5, $6)
        ON CONFLICT (session_id) DO UPDATE SET
          profile = EXCLUDED.profile,
          summary = EXCLUDED.summary,
          updated_at = EXCLUDED.updated_at
      `,
      [
        randomUUID(),
        entry.id,
        JSON.stringify(state.profile || {}),
        state.memorySummary || "",
        createdAt,
        updatedAt,
      ]
    );

    await client.query("DELETE FROM messages WHERE session_id = $1", [entry.id]);
    for (const message of Array.isArray(state.messages) ? state.messages : []) {
      await client.query(
        `
          INSERT INTO messages (
            id, session_id, request_id, role, mode, content, structured, agent, metadata, created_at
          )
          VALUES ($1, $2, NULL, $3, $4, $5, NULL, NULL, '{"imported":true}'::jsonb, $6)
        `,
        [
          randomUUID(),
          entry.id,
          message.role || "assistant",
          state.lastMode || null,
          String(message.content || ""),
          updatedAt,
        ]
      );
    }
  }
}

async function importLeads(client, leads) {
  for (const lead of leads) {
    if (!lead?.id) continue;
    const createdAt = toIso(lead.createdAt);

    await client.query(
      `
        INSERT INTO leads (
          id, session_id, request_id, source, name, phone, preferred_time, car_model, remark,
          purchase_stage, buy_timeline, privacy_consent, contact_consent, user_city, user_lat, user_lng,
          inferred_brand, assigned_store_id, assigned_store_name, assigned_store_city, routing_method,
          distance_km, driving_duration_min, lead_score, lead_stage, lead_priority, next_best_actions,
          score_reasons, assigned_advisor, crm_payload, crm_sync, versions, metadata, created_at, updated_at
        )
        VALUES (
          $1, NULL, NULL, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12, $13, $14,
          $15, $16, $17, $18, $19,
          $20, $21, $22, $23, $24, $25::jsonb,
          $26::jsonb, $27::jsonb, $28::jsonb, $29::jsonb, $30::jsonb, $31::jsonb, $32, $33
        )
        ON CONFLICT (id) DO UPDATE SET
          lead_score = EXCLUDED.lead_score,
          lead_stage = EXCLUDED.lead_stage,
          lead_priority = EXCLUDED.lead_priority,
          crm_sync = EXCLUDED.crm_sync,
          updated_at = EXCLUDED.updated_at
      `,
      [
        lead.id,
        lead.source || "xpeng-car-ai-web",
        lead.name || "",
        lead.phone || "",
        lead.preferredTime || null,
        lead.carModel || null,
        lead.remark || null,
        lead.purchaseStage || null,
        lead.buyTimeline || null,
        bool(lead.privacyConsent),
        bool(lead.contactConsent),
        lead.userCity || null,
        lead.userLat ?? null,
        lead.userLng ?? null,
        lead.inferredBrand || null,
        lead.assignedStoreId || null,
        lead.assignedStoreName || null,
        lead.assignedStoreCity || null,
        lead.routingMethod || null,
        lead.distanceKm ?? null,
        lead.drivingDurationMin ?? null,
        lead.leadScore ?? null,
        lead.leadStage || null,
        lead.leadPriority || null,
        JSON.stringify(lead.nextBestActions || []),
        JSON.stringify(lead.scoreReasons || []),
        JSON.stringify(lead.assignedAdvisor || null),
        JSON.stringify(lead.crm || null),
        JSON.stringify(lead.crmSync || null),
        JSON.stringify(lead.versions || {}),
        JSON.stringify({ importedFrom: "leads.jsonl" }),
        createdAt,
        createdAt,
      ]
    );

    await client.query(
      `
        INSERT INTO lead_events (id, lead_id, event_type, event_status, payload, created_at)
        VALUES ($1, $2, 'lead_imported', $3, $4::jsonb, $5)
      `,
      [
        randomUUID(),
        lead.id,
        lead.leadStage || "captured",
        JSON.stringify({ source: "leads.jsonl" }),
        createdAt,
      ]
    );
  }
}

async function importAnalytics(client, analytics) {
  for (const record of analytics) {
    const agentRunId = randomUUID();
    const createdAt = toIso(record.ts);

    await client.query(
      `
        INSERT INTO agent_runs (
          id, session_id, request_id, route, mode, response_source, status,
          agent_release, prompt_version, policy_version, eval_dataset_version,
          total_ms, planning_ms, synthesis_ms, agent_turns, has_structured, stream,
          error_message, metadata, created_at
        )
        VALUES (
          $1, $2, $3, $4, $5, NULL, 'completed',
          $6, $7, $8, $9,
          $10, NULL, NULL, $11, $12, $13,
          NULL, $14::jsonb, $15
        )
      `,
      [
        agentRunId,
        record.sessionId || null,
        record.requestId || null,
        record.route || (record.stream ? "/api/chat/stream" : "/api/chat"),
        record.mode || null,
        record.agentRelease || null,
        record.promptVersion || null,
        record.policyVersion || null,
        record.evalDatasetVersion || null,
        record.totalMs ?? null,
        record.agentTurns ?? null,
        bool(record.hasStructured),
        bool(record.stream),
        JSON.stringify({ ip: record.ip || null, importedFrom: "analytics.jsonl" }),
        createdAt,
      ]
    );

    for (let index = 0; index < (record.toolsUsed || []).length; index += 1) {
      await client.query(
        `
          INSERT INTO tool_calls (
            id, agent_run_id, tool_name, call_order, status, latency_ms, summary, args, result, created_at
          )
          VALUES ($1, $2, $3, $4, 'completed', NULL, NULL, '{}'::jsonb, NULL, $5)
        `,
        [randomUUID(), agentRunId, String(record.toolsUsed[index]), index + 1, createdAt]
      );
    }
  }
}

async function importConversationEvents(client, events) {
  for (const item of events) {
    if (!item?.sessionId) continue;

    await client.query(
      `
        INSERT INTO conversation_events (
          id, session_id, request_id, route, mode, stream,
          user_message, assistant_reply, structured, agent, metadata, created_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12
        )
      `,
      [
        randomUUID(),
        item.sessionId,
        item.requestId || null,
        item.route || (item.stream ? "/api/chat/stream" : "/api/chat"),
        item.mode || null,
        bool(item.stream),
        String(item.userMessage || ""),
        String(item.assistantReply || ""),
        JSON.stringify(item.structured || null),
        JSON.stringify(item.agent || null),
        JSON.stringify({ importedFrom: "messages.jsonl" }),
        toIso(item.recordedAt),
      ]
    );
  }
}

async function importCrmOutbox(client, items) {
  for (const item of items) {
    if (!item?.id) continue;
    await client.query(
      `
        INSERT INTO crm_outbox (
          id, lead_id, request_id, external_lead_id, payload_version, status, attempts, sync_enabled,
          next_attempt_at, last_attempt_at, last_error, last_http_status, synced_at, customer_summary,
          payload, created_at, updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14::jsonb,
          $15::jsonb, $16, $17
        )
        ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status,
          attempts = EXCLUDED.attempts,
          updated_at = EXCLUDED.updated_at
      `,
      [
        item.id,
        item.externalLeadId || null,
        item.requestId || null,
        item.externalLeadId || null,
        item.payloadVersion || null,
        item.status || "queued",
        item.attempts ?? 0,
        bool(item.syncEnabled),
        item.nextAttemptAt ? toIso(item.nextAttemptAt) : null,
        item.lastAttemptAt ? toIso(item.lastAttemptAt) : null,
        item.lastError || null,
        item.lastHttpStatus ?? null,
        item.syncedAt ? toIso(item.syncedAt) : null,
        JSON.stringify(item.customer || {}),
        JSON.stringify(item.payload || {}),
        toIso(item.createdAt),
        toIso(item.updatedAt, toIso(item.createdAt)),
      ]
    );
  }
}

async function main() {
  const sessionEntries = loadSessionEntries();
  const leads = loadLeads();
  const analytics = loadAnalytics();
  const conversationEvents = loadConversationEvents();
  const crmOutbox = loadCrmOutbox();

  await withTransaction(async (client) => {
    await maybeTruncate(client);
    await importSessions(client, sessionEntries);
    await importConversationEvents(client, conversationEvents);
    await importLeads(client, leads);
    await importAnalytics(client, analytics);
    await importCrmOutbox(client, crmOutbox);
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        imported: {
        sessions: sessionEntries.length,
        conversationEvents: conversationEvents.length,
        leads: leads.length,
        analytics: analytics.length,
          crmOutbox: crmOutbox.length,
        },
        truncate: String(process.env.IMPORT_TRUNCATE || "").trim().toLowerCase() === "true",
      },
      null,
      2
    )
  );
}

(async () => {
  try {
    await main();
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
  } finally {
    await closePool();
  }
})();
