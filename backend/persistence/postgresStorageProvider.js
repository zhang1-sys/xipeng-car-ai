const { randomUUID } = require("crypto");
const { query, withTransaction, getDatabaseUrl } = require("../db/postgresClient");
const { getCrmProvider } = require("../crm/providerRegistry");
const { CRM_OUTBOX_STATUS, resolveCrmProvider } = require("../crm/types");
const { webhookConfig, retryDelayMs, summarizeRecord, maskPhone } = require("../crmSync");
const {
  sanitizeAuditEvent,
  sanitizeConversationEvent,
  sanitizeLeadRecord,
  sanitizeSensitiveValue,
} = require("../privacy");
const { getRetentionPolicy } = require("../runtimePolicy");

function normalizeSessionState(createSessionState, state) {
  const base = createSessionState();
  return {
    ...base,
    ...state,
    messages: Array.isArray(state?.messages) ? state.messages : [],
    turns: Array.isArray(state?.turns) ? state.turns : [],
    profile: state?.profile && typeof state.profile === "object" ? state.profile : {},
    userProfile: state?.userProfile && typeof state.userProfile === "object" ? state.userProfile : {},
    userMemorySummary: typeof state?.userMemorySummary === "string" ? state.userMemorySummary : "",
    taskMemory: state?.taskMemory && typeof state.taskMemory === "object" ? state.taskMemory : {},
    clientProfileId: typeof state?.clientProfileId === "string" ? state.clientProfileId : "",
    memorySummary: typeof state?.memorySummary === "string" ? state.memorySummary : "",
  };
}

function buildSessionRows(createSessionState, trimSessionMessages, sessionEntries) {
  return sessionEntries.map(([id, rawState]) => {
    const state = normalizeSessionState(createSessionState, rawState);
    return {
      id,
      state: {
        ...state,
        profile: sanitizeSensitiveValue(state.profile || {}),
        userProfile: sanitizeSensitiveValue(state.userProfile || {}),
        userMemorySummary: sanitizeSensitiveValue(state.userMemorySummary || "", {
          maskPlainTextAddresses: true,
        }),
        taskMemory: sanitizeSensitiveValue(state.taskMemory || {}, {
          maskPlainTextAddresses: true,
        }),
        clientProfileId: state.clientProfileId || "",
        memorySummary: sanitizeSensitiveValue(state.memorySummary || "", {
          maskPlainTextAddresses: true,
        }),
        messages: sanitizeSensitiveValue(trimSessionMessages(state.messages), {
          maskPlainTextAddresses: true,
        }),
        turns: sanitizeSensitiveValue(state.turns.slice(-20), {
          maskPlainTextAddresses: true,
        }),
      },
    };
  });
}

function toIsoString(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function buildCrmCustomerSummary(payload, lead) {
  return {
    name: payload?.customer?.name || lead?.name || "",
    phoneMasked: maskPhone(payload?.customer?.phone || lead?.phone || ""),
    city: payload?.customer?.city || lead?.userCity || null,
  };
}

function parsePgJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch (_) {
    return fallback;
  }
}

function getCrmProviderSummary(config) {
  const provider = resolveCrmProvider();
  return {
    provider,
    enabled: config.enabled || provider === "mock",
    webhookUrlConfigured: config.enabled,
  };
}

function normalizeCrmOutboxRow(row) {
  return {
    id: row.id,
    leadId: row.lead_id || null,
    requestId: row.request_id || null,
    externalLeadId: row.external_lead_id || null,
    payloadVersion: row.payload_version || null,
    status: row.status,
    transportStatus: row.transport_status || row.status,
    provider: row.provider || resolveCrmProvider(),
    attempts: Number(row.attempts || 0),
    syncEnabled: row.sync_enabled === true,
    nextAttemptAt: toIsoString(row.next_attempt_at),
    lastAttemptAt: toIsoString(row.last_attempt_at),
    lastError: row.last_error || null,
    lastHttpStatus: row.last_http_status ?? null,
    sentAt: toIsoString(row.sent_at),
    ackAt: toIsoString(row.ack_at),
    syncedAt: toIsoString(row.synced_at),
    deadLetterAt: toIsoString(row.dead_letter_at),
    customer: parsePgJson(row.customer_summary, {}),
    payload: parsePgJson(row.payload, {}),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function createPostgresStorageProvider({
  createSessionState,
  trimSessionMessages,
  sessionTtlMs,
}) {
  function retentionPolicy() {
    return getRetentionPolicy({ sessionTtlMs });
  }

  async function loadSessions() {
    const policy = retentionPolicy();
    const sessionResult = await query(
      `
        SELECT s.id,
               s.created_at,
               s.updated_at,
               s.last_mode,
               s.memory_summary,
               s.metadata,
               u.external_id AS client_profile_id,
               mp.profile,
               COALESCE(mp.summary, s.memory_summary, '') AS profile_summary
        FROM sessions s
        LEFT JOIN memory_profiles mp ON mp.session_id = s.id
        LEFT JOIN users u ON u.id = s.user_id
        WHERE s.status = 'active'
          AND (s.updated_at IS NULL OR s.updated_at >= NOW() - ($1::bigint * INTERVAL '1 millisecond'))
        ORDER BY s.updated_at DESC
      `,
      [policy.sessionMs]
    );

    const messageResult = await query(
      `
        SELECT session_id, role, content, mode, created_at
        FROM messages
        ORDER BY created_at ASC
      `
    );

    const messagesBySession = new Map();
    for (const row of messageResult.rows) {
      if (!messagesBySession.has(row.session_id)) {
        messagesBySession.set(row.session_id, []);
      }
      messagesBySession.get(row.session_id).push({
        role: row.role,
        content: row.content,
        mode: row.mode || undefined,
      });
    }

    return sessionResult.rows.map((row) => ({
      id: row.id,
      state: normalizeSessionState(createSessionState, {
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : undefined,
        lastActiveAt: row.updated_at ? new Date(row.updated_at).toISOString() : undefined,
        messages: messagesBySession.get(row.id) || [],
        profile: row.profile || {},
        userProfile: row.metadata?.userProfile || {},
        userMemorySummary: row.metadata?.userMemorySummary || "",
        memorySummary: row.profile_summary || row.memory_summary || "",
        taskMemory: row.metadata?.taskMemory || {},
        clientProfileId: row.client_profile_id || row.metadata?.clientProfileId || "",
        lastMode: row.last_mode || "service",
        turns: Array.isArray(row.metadata?.turns) ? row.metadata.turns : [],
      }),
    }));
  }

  async function persistSessions(sessionEntries) {
    const rows = buildSessionRows(createSessionState, trimSessionMessages, sessionEntries);
    await withTransaction(async (client) => {
      for (const item of rows) {
        const state = item.state;
        await client.query(
          `
            INSERT INTO sessions (
              id, user_id, channel, source, status, last_mode, memory_summary, metadata, created_at, updated_at
            )
            VALUES (
              $1,
              (SELECT id FROM users WHERE external_id = $2 LIMIT 1),
              'web',
              'xpeng-car-ai-web',
              'active',
              $3,
              $4,
              $5::jsonb,
              $6,
              $7
            )
            ON CONFLICT (id) DO UPDATE SET
              user_id = EXCLUDED.user_id,
              last_mode = EXCLUDED.last_mode,
              memory_summary = EXCLUDED.memory_summary,
              metadata = EXCLUDED.metadata,
              updated_at = EXCLUDED.updated_at
          `,
          [
            item.id,
            state.clientProfileId || null,
            state.lastMode || null,
            state.memorySummary || "",
            JSON.stringify({
              turns: state.turns || [],
              taskMemory: state.taskMemory || {},
              userProfile: state.userProfile || {},
              userMemorySummary: state.userMemorySummary || "",
              clientProfileId: state.clientProfileId || "",
            }),
            state.createdAt || new Date().toISOString(),
            state.lastActiveAt || new Date().toISOString(),
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
            item.id,
            JSON.stringify(state.profile || {}),
            state.memorySummary || "",
            state.createdAt || new Date().toISOString(),
            state.lastActiveAt || new Date().toISOString(),
          ]
        );

        await client.query("DELETE FROM messages WHERE session_id = $1", [item.id]);

        for (const message of state.messages) {
          await client.query(
            `
              INSERT INTO messages (id, session_id, request_id, role, mode, content, structured, agent, metadata, created_at)
              VALUES ($1, $2, NULL, $3, $4, $5, NULL, NULL, '{}'::jsonb, NOW())
            `,
            [
              randomUUID(),
              item.id,
              message.role || "assistant",
              message.mode || state.lastMode || null,
              String(message.content || ""),
            ]
          );
        }
      }
    });
  }

  async function loadUserProfiles() {
    const result = await query(
      `
        SELECT external_id, city, consent_profile, created_at, updated_at
        FROM users
        WHERE external_id IS NOT NULL AND external_id <> ''
        ORDER BY updated_at DESC
      `
    );

    return result.rows.map((row) => {
      const agentMemory =
        row.consent_profile && typeof row.consent_profile === "object"
          ? row.consent_profile.agentMemory || {}
          : {};
      return {
        id: row.external_id,
        state: {
          profile: agentMemory.profile || (row.city ? { city: row.city } : {}),
          memorySummary: agentMemory.memorySummary || "",
          recentGoals: Array.isArray(agentMemory.recentGoals) ? agentMemory.recentGoals : [],
          lastMode: agentMemory.lastMode || "",
          lastTaskMemory: agentMemory.lastTaskMemory || {},
          createdAt: toIsoString(row.created_at) || "",
          updatedAt: toIsoString(row.updated_at) || "",
        },
      };
    });
  }

  async function persistUserProfiles(userEntries) {
    await withTransaction(async (client) => {
      for (const [externalId, state] of userEntries) {
        if (!externalId) continue;
        const createdAt = state?.createdAt || new Date().toISOString();
        const updatedAt = state?.updatedAt || new Date().toISOString();
        await client.query(
          `
            INSERT INTO users (
              id, external_id, city, consent_profile, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4::jsonb, $5, $6)
            ON CONFLICT (external_id) DO UPDATE SET
              city = EXCLUDED.city,
              consent_profile = EXCLUDED.consent_profile,
              updated_at = EXCLUDED.updated_at
          `,
          [
            randomUUID(),
            externalId,
            state?.profile?.city || null,
            JSON.stringify({
              agentMemory: {
                profile: state?.profile || {},
                memorySummary: state?.memorySummary || "",
                recentGoals: Array.isArray(state?.recentGoals) ? state.recentGoals.slice(-12) : [],
                lastMode: state?.lastMode || "",
                lastTaskMemory: state?.lastTaskMemory || {},
              },
            }),
            createdAt,
            updatedAt,
          ]
        );
      }
    });
  }

  async function appendConversationEvent(event) {
    const sanitized = sanitizeConversationEvent(event);
    await query(
      `
        INSERT INTO conversation_events (
          id, session_id, request_id, route, mode, stream,
          user_message, assistant_reply, structured, agent, metadata, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, NOW())
      `,
      [
        randomUUID(),
        sanitized.sessionId,
        sanitized.requestId || null,
        sanitized.route || "unknown",
        sanitized.mode || null,
        sanitized.stream === true,
        String(sanitized.userMessage || ""),
        String(sanitized.assistantReply || ""),
        JSON.stringify(sanitized.structured || null),
        JSON.stringify(sanitized.agent || null),
        JSON.stringify({
          provider: "postgres",
          ...sanitizeSensitiveValue(sanitized.metadata || {}),
        }),
      ]
    );
  }

  async function appendAnalyticsEvent(event) {
    await withTransaction(async (client) => {
      const agentRunId = randomUUID();
      await client.query(
        `
          INSERT INTO agent_runs (
            id, session_id, request_id, route, mode, response_source, status,
            agent_release, prompt_version, policy_version, eval_dataset_version,
            total_ms, planning_ms, synthesis_ms, agent_turns, has_structured, stream,
            error_message, metadata, created_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7,
            $8, $9, $10, $11,
            $12, NULL, NULL, $13, $14, $15,
            $16, $17::jsonb, $18
          )
        `,
        [
          agentRunId,
          event.sessionId || null,
          event.requestId || null,
          event.route || (event.stream ? "/api/chat/stream" : "/api/chat"),
          event.mode || null,
          event.responseSource || null,
          event.status || "completed",
          event.agentRelease || null,
          event.promptVersion || null,
          event.policyVersion || null,
          event.evalDatasetVersion || null,
          event.totalMs ?? null,
          event.agentTurns ?? null,
          event.hasStructured === true,
          event.stream === true,
          event.errorMessage || null,
          JSON.stringify({
            ip: event.ip || null,
            fallbackReason: event.fallbackReason || null,
          }),
          event.ts || new Date().toISOString(),
        ]
      );

      const toolsUsed = Array.isArray(event.toolsUsed) ? event.toolsUsed : [];
      for (let index = 0; index < toolsUsed.length; index += 1) {
        await client.query(
          `
            INSERT INTO tool_calls (
              id, agent_run_id, tool_name, call_order, status, latency_ms, summary, args, result, created_at
            )
            VALUES ($1, $2, $3, $4, 'completed', NULL, NULL, '{}'::jsonb, NULL, $5)
          `,
          [randomUUID(), agentRunId, String(toolsUsed[index]), index + 1, event.ts || new Date().toISOString()]
        );
      }
    });
  }

  async function listConversationEvents(limit = 200, sessionId = null) {
    const safeLimit = Math.max(1, Math.min(5000, Number(limit) || 200));
    const values = [safeLimit];
    let sessionClause = "";
    if (sessionId) {
      values.unshift(sessionId);
      sessionClause = "WHERE session_id = $1";
    }

    const result = await query(
      `
        SELECT
          session_id,
          request_id,
          route,
          mode,
          stream,
          user_message,
          assistant_reply,
          structured,
          agent,
          metadata,
          created_at
        FROM conversation_events
        ${sessionClause}
        ORDER BY created_at DESC
        LIMIT $${values.length}
      `,
      values
    );

    return result.rows.map((row) => ({
      recordedAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
      sessionId: row.session_id,
      requestId: row.request_id || null,
      route: row.route || null,
      mode: row.mode || null,
      stream: row.stream === true,
      userMessage: row.user_message || "",
      assistantReply: row.assistant_reply || "",
      structured: row.structured || null,
      agent: row.agent || null,
      metadata: row.metadata || {},
    }));
  }

  async function listAnalyticsEvents(limit = 500) {
    const safeLimit = Math.max(1, Math.min(5000, Number(limit) || 500));
    const result = await query(
      `
        SELECT
          ar.session_id,
          ar.request_id,
          ar.route,
          ar.mode,
          ar.response_source,
          ar.status,
          ar.agent_release,
          ar.prompt_version,
          ar.policy_version,
          ar.eval_dataset_version,
          ar.agent_turns,
          ar.total_ms,
          ar.has_structured,
          ar.stream,
          ar.error_message,
          ar.metadata,
          ar.created_at,
          COALESCE(
            json_agg(tc.tool_name ORDER BY tc.call_order)
              FILTER (WHERE tc.tool_name IS NOT NULL),
            '[]'::json
          ) AS tools_used
        FROM agent_runs ar
        LEFT JOIN tool_calls tc ON tc.agent_run_id = ar.id
        GROUP BY ar.id
        ORDER BY ar.created_at DESC
        LIMIT $1
      `,
      [safeLimit]
    );

    return result.rows.map((row) => ({
      ts: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
      sessionId: row.session_id || null,
      requestId: row.request_id || null,
      mode: row.mode || null,
      route: row.route || null,
      responseSource: row.response_source || null,
      status: row.status || null,
      toolsUsed: Array.isArray(row.tools_used) ? row.tools_used : [],
      agentTurns: row.agent_turns ?? 0,
      totalMs: row.total_ms ?? 0,
      hasStructured: row.has_structured === true,
      agentRelease: row.agent_release || null,
      promptVersion: row.prompt_version || null,
      policyVersion: row.policy_version || null,
      evalDatasetVersion: row.eval_dataset_version || null,
      stream: row.stream === true,
      ip: row.metadata?.ip || null,
      fallbackReason: row.metadata?.fallbackReason || null,
      errorMessage: row.error_message || null,
    }));
  }

  async function listLeadRecords(limit = 1000) {
    const safeLimit = Math.max(1, Math.min(5000, Number(limit) || 1000));
    const result = await query(
      `
        SELECT
          id,
          source,
          name,
          phone,
          preferred_time,
          car_model,
          remark,
          purchase_stage,
          buy_timeline,
          privacy_consent,
          contact_consent,
          user_city,
          user_lat,
          user_lng,
          inferred_brand,
          assigned_store_id,
          assigned_store_name,
          assigned_store_city,
          routing_method,
          distance_km,
          driving_duration_min,
          lead_score,
          lead_stage,
          lead_priority,
          next_best_actions,
          score_reasons,
          assigned_advisor,
          crm_payload,
          crm_sync,
          versions,
          created_at
        FROM leads
        ORDER BY created_at DESC
        LIMIT $1
      `,
      [safeLimit]
    );

    return result.rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
      source: row.source || "xpeng-car-ai-web",
      name: row.name || "",
      phone: row.phone || "",
      preferredTime: row.preferred_time || null,
      carModel: row.car_model || null,
      remark: row.remark || null,
      purchaseStage: row.purchase_stage || null,
      buyTimeline: row.buy_timeline || null,
      privacyConsent: row.privacy_consent === true,
      contactConsent: row.contact_consent === true,
      userCity: row.user_city || null,
      userLat: row.user_lat ?? null,
      userLng: row.user_lng ?? null,
      inferredBrand: row.inferred_brand || null,
      assignedStoreId: row.assigned_store_id || null,
      assignedStoreName: row.assigned_store_name || null,
      assignedStoreCity: row.assigned_store_city || null,
      routingMethod: row.routing_method || null,
      distanceKm: row.distance_km ?? null,
      drivingDurationMin: row.driving_duration_min ?? null,
      leadScore: row.lead_score ?? null,
      leadStage: row.lead_stage || null,
      leadPriority: row.lead_priority || null,
      nextBestActions: row.next_best_actions || [],
      scoreReasons: row.score_reasons || [],
      assignedAdvisor: row.assigned_advisor || null,
      crm: row.crm_payload || null,
      crmSync: row.crm_sync || null,
      versions: row.versions || {},
    }));
  }

  async function appendLeadRecord(lead) {
    const sanitizedLead = sanitizeLeadRecord(lead);
    await query(
      `
        INSERT INTO leads (
          id, session_id, request_id, source, name, phone, preferred_time, car_model, remark,
          purchase_stage, buy_timeline, privacy_consent, contact_consent, user_city, user_lat,
          user_lng, inferred_brand, assigned_store_id, assigned_store_name, assigned_store_city,
          routing_method, distance_km, driving_duration_min, lead_score, lead_stage, lead_priority,
          next_best_actions, score_reasons, assigned_advisor, crm_payload, crm_sync, versions,
          metadata, created_at, updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9,
          $10, $11, $12, $13, $14, $15,
          $16, $17, $18, $19, $20,
          $21, $22, $23, $24, $25, $26,
          $27::jsonb, $28::jsonb, $29::jsonb, $30::jsonb, $31::jsonb, $32::jsonb,
          $33::jsonb, $34, $35
        )
        ON CONFLICT (id) DO UPDATE SET
          session_id = EXCLUDED.session_id,
          request_id = EXCLUDED.request_id,
          source = EXCLUDED.source,
          name = EXCLUDED.name,
          phone = EXCLUDED.phone,
          preferred_time = EXCLUDED.preferred_time,
          car_model = EXCLUDED.car_model,
          remark = EXCLUDED.remark,
          purchase_stage = EXCLUDED.purchase_stage,
          buy_timeline = EXCLUDED.buy_timeline,
          privacy_consent = EXCLUDED.privacy_consent,
          contact_consent = EXCLUDED.contact_consent,
          user_city = EXCLUDED.user_city,
          user_lat = EXCLUDED.user_lat,
          user_lng = EXCLUDED.user_lng,
          inferred_brand = EXCLUDED.inferred_brand,
          assigned_store_id = EXCLUDED.assigned_store_id,
          assigned_store_name = EXCLUDED.assigned_store_name,
          assigned_store_city = EXCLUDED.assigned_store_city,
          routing_method = EXCLUDED.routing_method,
          distance_km = EXCLUDED.distance_km,
          driving_duration_min = EXCLUDED.driving_duration_min,
          lead_score = EXCLUDED.lead_score,
          lead_stage = EXCLUDED.lead_stage,
          lead_priority = EXCLUDED.lead_priority,
          next_best_actions = EXCLUDED.next_best_actions,
          score_reasons = EXCLUDED.score_reasons,
          assigned_advisor = EXCLUDED.assigned_advisor,
          crm_payload = EXCLUDED.crm_payload,
          crm_sync = EXCLUDED.crm_sync,
          versions = EXCLUDED.versions,
          metadata = EXCLUDED.metadata,
          updated_at = EXCLUDED.updated_at
      `,
      [
        sanitizedLead.id,
        sanitizedLead.sessionId || null,
        sanitizedLead.requestId || null,
        sanitizedLead.source || "xpeng-car-ai-web",
        sanitizedLead.name,
        sanitizedLead.phone,
        sanitizedLead.preferredTime || null,
        sanitizedLead.carModel || null,
        sanitizedLead.remark || null,
        sanitizedLead.purchaseStage || null,
        sanitizedLead.buyTimeline || null,
        sanitizedLead.privacyConsent === true,
        sanitizedLead.contactConsent === true,
        sanitizedLead.userCity || null,
        sanitizedLead.userLat ?? null,
        sanitizedLead.userLng ?? null,
        sanitizedLead.inferredBrand || null,
        sanitizedLead.assignedStoreId || null,
        sanitizedLead.assignedStoreName || null,
        sanitizedLead.assignedStoreCity || null,
        sanitizedLead.routingMethod || null,
        sanitizedLead.distanceKm ?? null,
        sanitizedLead.drivingDurationMin ?? null,
        sanitizedLead.leadScore ?? null,
        sanitizedLead.leadStage || null,
        sanitizedLead.leadPriority || null,
        JSON.stringify(sanitizedLead.nextBestActions || []),
        JSON.stringify(sanitizedLead.scoreReasons || []),
        JSON.stringify(sanitizedLead.assignedAdvisor || null),
        JSON.stringify(sanitizedLead.crm || null),
        JSON.stringify(sanitizedLead.crmSync || null),
        JSON.stringify(sanitizedLead.versions || {}),
        JSON.stringify({}),
        toIsoString(sanitizedLead.createdAt) || new Date().toISOString(),
        new Date().toISOString(),
      ]
    );

    await query(
      `
        UPDATE crm_outbox
        SET lead_id = $2
        WHERE lead_id IS NULL
          AND external_lead_id = $1
      `,
      [sanitizedLead.id, sanitizedLead.id]
    );

    await query(
      `
        INSERT INTO lead_events (id, lead_id, event_type, event_status, payload, created_at)
        VALUES ($1, $2, 'lead_captured', $3, $4::jsonb, NOW())
      `,
      [
        randomUUID(),
        sanitizedLead.id,
        sanitizedLead.leadStage || "captured",
        JSON.stringify({
          source: sanitizedLead.source || "xpeng-car-ai-web",
          assignedStoreId: sanitizedLead.assignedStoreId || null,
          assignedAdvisorId: sanitizedLead.assignedAdvisor?.id || null,
        }),
      ]
    );
  }

  async function enqueueCrmOutbox({ payload, lead, requestId }) {
    const config = webhookConfig();
    const provider = resolveCrmProvider();
    const now = new Date().toISOString();
    const item = {
      id: randomUUID(),
      requestId,
      externalLeadId: payload.externalLeadId,
      payloadVersion: payload.payloadVersion,
      source: payload.source,
      stage: payload.stage,
      priority: payload.priority,
      score: payload.score,
      createdAt: now,
      updatedAt: now,
      status: CRM_OUTBOX_STATUS.PENDING,
      transportStatus: null,
      provider,
      attempts: 0,
      nextAttemptAt: now,
      lastAttemptAt: null,
      lastError: null,
      lastHttpStatus: null,
      sentAt: null,
      ackAt: null,
      syncedAt: null,
      deadLetterAt: null,
      syncEnabled: config.enabled || provider === "mock",
      customer: buildCrmCustomerSummary(payload, lead),
      payload,
      leadId: lead?.id || null,
    };

    await query(
      `
        INSERT INTO crm_outbox (
          id, lead_id, request_id, external_lead_id, payload_version,
          status, transport_status, provider,
          attempts, sync_enabled,
          next_attempt_at, last_attempt_at,
          last_error, last_http_status,
          sent_at, ack_at, synced_at, dead_letter_at,
          customer_summary, payload,
          created_at, updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8,
          $9, $10,
          $11, $12,
          $13, $14,
          $15, $16, $17, $18,
          $19::jsonb, $20::jsonb,
          $21, $22
        )
      `,
      [
        item.id,
        item.leadId,
        requestId || null,
        payload.externalLeadId || null,
        payload.payloadVersion || null,
        item.status,
        item.transportStatus,
        item.provider,
        item.attempts,
        item.syncEnabled === true,
        item.nextAttemptAt,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        JSON.stringify(item.customer),
        JSON.stringify(payload),
        item.createdAt,
        item.updatedAt,
      ]
    );

    if (item.leadId) {
      await query(
        `
          INSERT INTO lead_events (id, lead_id, event_type, event_status, payload, created_at)
          VALUES ($1, $2, 'crm_outbox_enqueued', $3, $4::jsonb, NOW())
        `,
        [
          randomUUID(),
          item.leadId,
          item.status,
          JSON.stringify({
            crmOutboxId: item.id,
            syncEnabled: item.syncEnabled,
            externalLeadId: item.externalLeadId || null,
            provider: item.provider,
          }),
        ]
      );
    }

    return item;
  }

  async function syncCrmOutbox({ limit = 5, ids = null, force = false } = {}) {
    const config = webhookConfig();
    const provider = getCrmProvider();
    const providerSummary = getCrmProviderSummary(config);
    const nowMs = Date.now();
    const summary = {
      provider: provider.kind,
      syncEnabled: providerSummary.enabled,
      attempted: 0,
      sent: 0,
      acknowledged: 0,
      synced: 0,
      retried: 0,
      failed: 0,
      deadLetter: 0,
      skipped: 0,
      byId: {},
    };

    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 5));
    const filters = [];
    const params = [CRM_OUTBOX_STATUS.PENDING, CRM_OUTBOX_STATUS.FAILED];

    if (Array.isArray(ids) && ids.length) {
      params.push(ids);
      filters.push(`id = ANY($${params.length}::uuid[])`);
    }

    params.push(safeLimit);

    const result = await query(
      `
        SELECT
          id,
          lead_id,
          request_id,
          external_lead_id,
          payload_version,
          status,
          transport_status,
          provider,
          attempts,
          sync_enabled,
          next_attempt_at,
          last_attempt_at,
          last_error,
          last_http_status,
          sent_at,
          ack_at,
          synced_at,
          dead_letter_at,
          customer_summary,
          payload,
          created_at,
          updated_at
        FROM crm_outbox
        WHERE status IN ($1, $2)
          ${filters.length ? `AND ${filters.join(" AND ")}` : ""}
        ORDER BY created_at DESC
        LIMIT $${params.length}
      `,
      params
    );

    const items = result.rows.map(normalizeCrmOutboxRow);

    for (const item of items) {
      if (!force && item.nextAttemptAt && new Date(item.nextAttemptAt).getTime() > nowMs) {
        summary.skipped += 1;
        continue;
      }

      summary.attempted += 1;
      const updatedAt = new Date().toISOString();

      try {
        const sendResult = await provider.send({
          outboxItem: item,
          payload: item.payload,
          lead: item.customer,
        });
        item.attempts += 1;
        item.lastAttemptAt = updatedAt;
        item.lastHttpStatus = sendResult.httpStatus ?? null;
        item.lastError = sendResult.error || null;
        item.updatedAt = updatedAt;
        item.provider = provider.kind;
        if (sendResult.ok) {
          item.status = sendResult.nextStatus || CRM_OUTBOX_STATUS.SENT;
          item.transportStatus = item.status;
          item.sentAt = updatedAt;
          item.nextAttemptAt = null;
          summary.sent += 1;
        } else if (item.attempts >= Number(process.env.CRM_SYNC_MAX_ATTEMPTS || 5)) {
          item.status = CRM_OUTBOX_STATUS.DEAD_LETTER;
          item.transportStatus = CRM_OUTBOX_STATUS.DEAD_LETTER;
          item.deadLetterAt = updatedAt;
          item.nextAttemptAt = null;
          summary.deadLetter += 1;
        } else {
          item.status = CRM_OUTBOX_STATUS.FAILED;
          item.transportStatus = CRM_OUTBOX_STATUS.FAILED;
          item.nextAttemptAt = new Date(Date.now() + retryDelayMs(item.attempts)).toISOString();
          summary.failed += 1;
        }
      } catch (error) {
        item.attempts += 1;
        item.lastAttemptAt = updatedAt;
        item.lastHttpStatus = error?.httpStatus ?? null;
        item.lastError = error instanceof Error ? error.message : String(error || "unknown_error");
        item.updatedAt = updatedAt;
        item.provider = provider.kind;
        if (item.attempts >= Number(process.env.CRM_SYNC_MAX_ATTEMPTS || 5)) {
          item.status = CRM_OUTBOX_STATUS.DEAD_LETTER;
          item.transportStatus = CRM_OUTBOX_STATUS.DEAD_LETTER;
          item.deadLetterAt = updatedAt;
          item.nextAttemptAt = null;
          summary.deadLetter += 1;
        } else {
          item.status = CRM_OUTBOX_STATUS.FAILED;
          item.transportStatus = CRM_OUTBOX_STATUS.FAILED;
          item.nextAttemptAt = new Date(Date.now() + retryDelayMs(item.attempts)).toISOString();
          summary.failed += 1;
        }
      }

      await withTransaction(async (client) => {
        await client.query(
          `
            UPDATE crm_outbox
            SET status = $2,
                transport_status = $3,
                provider = $4,
                attempts = $5,
                next_attempt_at = $6,
                last_attempt_at = $7,
                last_error = $8,
                last_http_status = $9,
                sent_at = $10,
                ack_at = $11,
                synced_at = $12,
                dead_letter_at = $13,
                updated_at = $14
            WHERE id = $1
          `,
          [
            item.id,
            item.status,
            item.transportStatus,
            item.provider,
            item.attempts,
            item.nextAttemptAt,
            item.lastAttemptAt,
            item.lastError,
            item.lastHttpStatus,
            item.sentAt,
            item.ackAt,
            item.syncedAt,
            item.deadLetterAt,
            item.updatedAt,
          ]
        );

        if (item.leadId) {
          await client.query(
            `
              UPDATE leads
              SET crm_sync = $2::jsonb,
                  updated_at = NOW()
              WHERE id = $1
            `,
            [item.leadId, JSON.stringify(summarizeRecord(item))]
          );
        }

        if (item.leadId) {
          await client.query(
            `
              INSERT INTO lead_events (id, lead_id, event_type, event_status, payload, created_at)
              VALUES ($1, $2, 'crm_sync_attempt', $3, $4::jsonb, NOW())
            `,
            [
              randomUUID(),
              item.leadId,
              item.status,
              JSON.stringify({
                crmOutboxId: item.id,
                attempts: item.attempts,
                httpStatus: item.lastHttpStatus,
                error: item.lastError,
                provider: item.provider,
              }),
            ]
          );
        }
      });

      summary.byId[item.id] = summarizeRecord(item);
    }

    return summary;
  }

  async function getCrmSyncSummary() {
    const config = webhookConfig();
    const providerSummary = getCrmProviderSummary(config);

    const countsResult = await query(
      `
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = $1)::int AS pending,
          COUNT(*) FILTER (WHERE status = $2)::int AS sent,
          COUNT(*) FILTER (WHERE status = $3)::int AS acknowledged,
          COUNT(*) FILTER (WHERE status = $4)::int AS synced,
          COUNT(*) FILTER (WHERE status = $5)::int AS failed,
          COUNT(*) FILTER (WHERE status = $6)::int AS dead_letter
        FROM crm_outbox
      `,
      [
        CRM_OUTBOX_STATUS.PENDING,
        CRM_OUTBOX_STATUS.SENT,
        CRM_OUTBOX_STATUS.ACKNOWLEDGED,
        CRM_OUTBOX_STATUS.SYNCED,
        CRM_OUTBOX_STATUS.FAILED,
        CRM_OUTBOX_STATUS.DEAD_LETTER,
      ]
    );

    const recentResult = await query(
      `
        SELECT
          id,
          external_lead_id,
          status,
          transport_status,
          provider,
          attempts,
          updated_at,
          sent_at,
          ack_at,
          synced_at,
          dead_letter_at,
          last_error,
          last_http_status,
          customer_summary
        FROM crm_outbox
        ORDER BY updated_at DESC
        LIMIT 10
      `
    );

    return {
      ...providerSummary,
      timeoutMs: config.timeoutMs,
      maxAttempts: Math.max(1, Number(process.env.CRM_SYNC_MAX_ATTEMPTS || 5)),
      retryBaseMs: Math.max(5000, Number(process.env.CRM_SYNC_RETRY_BASE_MS || 30000)),
      counts: countsResult.rows[0] || {
        total: 0,
        pending: 0,
        sent: 0,
        acknowledged: 0,
        synced: 0,
        failed: 0,
        dead_letter: 0,
      },
      recent: recentResult.rows.map((row) => ({
        id: row.id,
        externalLeadId: row.external_lead_id || null,
        status: row.status,
        transportStatus: row.transport_status || row.status,
        provider: row.provider || providerSummary.provider,
        attempts: Number(row.attempts || 0),
        updatedAt: toIsoString(row.updated_at),
        sentAt: toIsoString(row.sent_at),
        ackAt: toIsoString(row.ack_at),
        syncedAt: toIsoString(row.synced_at),
        deadLetterAt: toIsoString(row.dead_letter_at),
        lastError: row.last_error || null,
        lastHttpStatus: row.last_http_status ?? null,
        customer: parsePgJson(row.customer_summary, {}),
      })),
    };
  }

  async function acknowledgeCrmOutbox({
    outboxId,
    externalLeadId,
    status = CRM_OUTBOX_STATUS.ACKNOWLEDGED,
    message = null,
    metadata = null,
  }) {
    const values = [];
    const filters = [];

    if (outboxId) {
      values.push(outboxId);
      filters.push(`id = $${values.length}`);
    }
    if (externalLeadId) {
      values.push(externalLeadId);
      filters.push(`external_lead_id = $${values.length}`);
    }
    if (!filters.length) {
      return { ok: false, error: "crm_outbox_not_found" };
    }

    const result = await query(
      `
        SELECT
          id,
          lead_id,
          request_id,
          external_lead_id,
          payload_version,
          status,
          transport_status,
          provider,
          attempts,
          sync_enabled,
          next_attempt_at,
          last_attempt_at,
          last_error,
          last_http_status,
          sent_at,
          ack_at,
          synced_at,
          dead_letter_at,
          customer_summary,
          payload,
          created_at,
          updated_at
        FROM crm_outbox
        WHERE ${filters.map((item) => `(${item})`).join(" OR ")}
        ORDER BY updated_at DESC
        LIMIT 1
      `,
      values
    );

    if (!result.rows.length) {
      return { ok: false, error: "crm_outbox_not_found" };
    }

    const item = normalizeCrmOutboxRow(result.rows[0]);
    const updatedAt = new Date().toISOString();
    item.updatedAt = updatedAt;
    item.lastError = message || null;
    item.provider = item.provider || resolveCrmProvider();

    if (status === CRM_OUTBOX_STATUS.ACKNOWLEDGED) {
      item.status = CRM_OUTBOX_STATUS.ACKNOWLEDGED;
      item.transportStatus = CRM_OUTBOX_STATUS.ACKNOWLEDGED;
      item.ackAt = updatedAt;
    } else if (status === CRM_OUTBOX_STATUS.SYNCED) {
      item.status = CRM_OUTBOX_STATUS.SYNCED;
      item.transportStatus = CRM_OUTBOX_STATUS.SYNCED;
      item.syncedAt = updatedAt;
      item.ackAt = item.ackAt || updatedAt;
    } else if (status === CRM_OUTBOX_STATUS.FAILED) {
      item.status = CRM_OUTBOX_STATUS.FAILED;
      item.transportStatus = CRM_OUTBOX_STATUS.FAILED;
      item.nextAttemptAt = new Date(Date.now() + retryDelayMs(item.attempts || 1)).toISOString();
    } else if (status === CRM_OUTBOX_STATUS.DEAD_LETTER) {
      item.status = CRM_OUTBOX_STATUS.DEAD_LETTER;
      item.transportStatus = CRM_OUTBOX_STATUS.DEAD_LETTER;
      item.deadLetterAt = updatedAt;
      item.nextAttemptAt = null;
    }

    await withTransaction(async (client) => {
      await client.query(
        `
          UPDATE crm_outbox
          SET status = $2,
              transport_status = $3,
              provider = $4,
              next_attempt_at = $5,
              last_error = $6,
              ack_at = $7,
              synced_at = $8,
              dead_letter_at = $9,
              updated_at = $10
          WHERE id = $1
        `,
        [
          item.id,
          item.status,
          item.transportStatus,
          item.provider,
          item.nextAttemptAt,
          item.lastError,
          item.ackAt,
          item.syncedAt,
          item.deadLetterAt,
          item.updatedAt,
        ]
      );

      if (item.leadId) {
        await client.query(
          `
            UPDATE leads
            SET crm_sync = $2::jsonb,
                updated_at = NOW()
            WHERE id = $1
          `,
          [item.leadId, JSON.stringify(summarizeRecord(item))]
        );

        await client.query(
          `
            INSERT INTO lead_events (id, lead_id, event_type, event_status, payload, created_at)
            VALUES ($1, $2, 'crm_status_callback', $3, $4::jsonb, NOW())
          `,
          [
            randomUUID(),
            item.leadId,
            item.status,
            JSON.stringify({
              crmOutboxId: item.id,
              message: message || null,
              metadata: metadata || null,
              provider: item.provider,
            }),
          ]
        );
      }
    });

    return {
      ok: true,
      item: summarizeRecord(item),
      summary: await getCrmSyncSummary(),
    };
  }

  async function listCrmOutbox(limit = 20) {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    const itemsResult = await query(
      `
        SELECT
          id,
          request_id,
          external_lead_id,
          payload,
          status,
          transport_status,
          provider,
          attempts,
          created_at,
          updated_at,
          next_attempt_at,
          last_error,
          last_http_status,
          sent_at,
          ack_at,
          synced_at,
          dead_letter_at,
          customer_summary
        FROM crm_outbox
        ORDER BY created_at DESC
        LIMIT $1
      `,
      [safeLimit]
    );

    return {
      summary: await getCrmSyncSummary(),
      items: itemsResult.rows.map((row) => {
        const payload = parsePgJson(row.payload, {});
        return {
          id: row.id,
          requestId: row.request_id || null,
          externalLeadId: row.external_lead_id || null,
          stage: payload?.stage || null,
          priority: payload?.priority || null,
          score: payload?.score ?? null,
          status: row.status,
          transportStatus: row.transport_status || row.status,
          provider: row.provider || resolveCrmProvider(),
          attempts: Number(row.attempts || 0),
          createdAt: toIsoString(row.created_at),
          updatedAt: toIsoString(row.updated_at),
          nextAttemptAt: toIsoString(row.next_attempt_at),
          lastError: row.last_error || null,
          lastHttpStatus: row.last_http_status ?? null,
          sentAt: toIsoString(row.sent_at),
          ackAt: toIsoString(row.ack_at),
          syncedAt: toIsoString(row.synced_at),
          deadLetterAt: toIsoString(row.dead_letter_at),
          customer: parsePgJson(row.customer_summary, {}),
        };
      }),
    };
  }

  async function appendAuditEvent(event) {
    const sanitized = sanitizeAuditEvent(event);
    await query(
      `
        INSERT INTO ops_audit_log (
          id, action, resource, outcome, actor, actor_type, request_id, ip, user_agent, metadata, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
      `,
      [
        randomUUID(),
        sanitized.action || "unknown",
        sanitized.resource || "unknown",
        sanitized.outcome || "unknown",
        sanitized.actor || null,
        sanitized.actorType || null,
        sanitized.requestId || null,
        sanitized.ip || null,
        sanitized.userAgent || null,
        JSON.stringify(sanitized.metadata || {}),
        sanitized.createdAt || new Date().toISOString(),
      ]
    );
  }

  async function listAuditEvents(limit = 50) {
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 50));
    const result = await query(
      `
        SELECT
          action,
          resource,
          outcome,
          actor,
          actor_type,
          request_id,
          ip,
          user_agent,
          metadata,
          created_at
        FROM ops_audit_log
        ORDER BY created_at DESC
        LIMIT $1
      `,
      [safeLimit]
    );

    return result.rows.map((row) => ({
      action: row.action,
      resource: row.resource,
      outcome: row.outcome,
      actor: row.actor || null,
      actorType: row.actor_type || null,
      requestId: row.request_id || null,
      ip: row.ip || null,
      userAgent: row.user_agent || null,
      metadata: row.metadata || {},
      createdAt: toIsoString(row.created_at),
    }));
  }

  async function getAuditSummary() {
    const countsResult = await query(
      `
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE outcome = 'success')::int AS success,
          COUNT(*) FILTER (WHERE outcome = 'denied')::int AS denied,
          COUNT(*) FILTER (WHERE outcome = 'error')::int AS error
        FROM ops_audit_log
      `
    );

    return {
      counts: countsResult.rows[0] || {
        total: 0,
        success: 0,
        denied: 0,
        error: 0,
      },
      recent: await listAuditEvents(10),
    };
  }

  async function applyRetentionPolicy() {
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

    const sessionDelete = await query(
      `DELETE FROM sessions WHERE updated_at < NOW() - ($1::bigint * INTERVAL '1 millisecond')`,
      [policy.sessionMs]
    );
    summary.removed.sessions = sessionDelete.rowCount || 0;

    const conversationDelete = await query(
      `DELETE FROM conversation_events WHERE created_at < NOW() - ($1::bigint * INTERVAL '1 millisecond')`,
      [policy.replayMs]
    );
    summary.removed.conversationEvents = conversationDelete.rowCount || 0;

    const leadDelete = await query(
      `DELETE FROM leads WHERE created_at < NOW() - ($1::bigint * INTERVAL '1 millisecond')`,
      [policy.leadMs]
    );
    summary.removed.leads = leadDelete.rowCount || 0;

    const crmAttemptDelete = await query(
      `
        DELETE FROM lead_events
        WHERE event_type = 'crm_sync_attempt'
          AND created_at < NOW() - ($1::bigint * INTERVAL '1 millisecond')
      `,
      [policy.crmAttemptMs]
    );
    summary.removed.crmAttempts = crmAttemptDelete.rowCount || 0;

    const crmOutboxDelete = await query(
      `
        DELETE FROM crm_outbox
        WHERE status IN ('synced', 'failed')
          AND COALESCE(synced_at, updated_at, created_at)
            < NOW() - ($1::bigint * INTERVAL '1 millisecond')
      `,
      [policy.crmOutboxMs]
    );
    summary.removed.crmOutbox = crmOutboxDelete.rowCount || 0;

    const auditDelete = await query(
      `DELETE FROM ops_audit_log WHERE created_at < NOW() - ($1::bigint * INTERVAL '1 millisecond')`,
      [policy.auditMs]
    );
    summary.removed.auditLog = auditDelete.rowCount || 0;
    summary.removedTotal = Object.values(summary.removed).reduce(
      (acc, value) => acc + Number(value || 0),
      0
    );

    return summary;
  }

  return {
    kind: "postgres",
    paths: {
      databaseUrl: getDatabaseUrl(),
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
  createPostgresStorageProvider,
};
