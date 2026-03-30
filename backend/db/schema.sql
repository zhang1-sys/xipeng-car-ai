CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  external_id TEXT UNIQUE,
  display_name TEXT,
  phone_masked TEXT,
  city TEXT,
  consent_profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  channel TEXT NOT NULL DEFAULT 'web',
  source TEXT NOT NULL DEFAULT 'xpeng-car-ai-web',
  status TEXT NOT NULL DEFAULT 'active',
  last_mode TEXT,
  memory_summary TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at DESC);

CREATE TABLE IF NOT EXISTS memory_profiles (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  request_id UUID,
  role TEXT NOT NULL,
  mode TEXT,
  content TEXT NOT NULL,
  structured JSONB,
  agent JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_session_id_created_at
  ON messages(session_id, created_at ASC);

CREATE TABLE IF NOT EXISTS conversation_events (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  request_id UUID,
  route TEXT NOT NULL,
  mode TEXT,
  stream BOOLEAN NOT NULL DEFAULT FALSE,
  user_message TEXT NOT NULL,
  assistant_reply TEXT NOT NULL,
  structured JSONB,
  agent JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversation_events_session_id_created_at
  ON conversation_events(session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  request_id UUID,
  source TEXT NOT NULL DEFAULT 'xpeng-car-ai-web',
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  preferred_time TEXT,
  car_model TEXT,
  remark TEXT,
  purchase_stage TEXT,
  buy_timeline TEXT,
  privacy_consent BOOLEAN NOT NULL DEFAULT FALSE,
  contact_consent BOOLEAN NOT NULL DEFAULT FALSE,
  user_city TEXT,
  user_lat DOUBLE PRECISION,
  user_lng DOUBLE PRECISION,
  inferred_brand TEXT,
  assigned_store_id TEXT,
  assigned_store_name TEXT,
  assigned_store_city TEXT,
  routing_method TEXT,
  distance_km DOUBLE PRECISION,
  driving_duration_min INTEGER,
  lead_score INTEGER,
  lead_stage TEXT,
  lead_priority TEXT,
  next_best_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  score_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  assigned_advisor JSONB,
  crm_payload JSONB,
  crm_sync JSONB,
  versions JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_stage ON leads(lead_stage);
CREATE INDEX IF NOT EXISTS idx_leads_score ON leads(lead_score DESC);

CREATE TABLE IF NOT EXISTS lead_events (
  id UUID PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_status TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_events_lead_id_created_at
  ON lead_events(lead_id, created_at ASC);

CREATE TABLE IF NOT EXISTS crm_outbox (
  id UUID PRIMARY KEY,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  request_id UUID,
  external_lead_id UUID,
  payload_version TEXT,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  sync_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  next_attempt_at TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ,
  last_error TEXT,
  last_http_status INTEGER,
  sent_at TIMESTAMPTZ,
  ack_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ,
  dead_letter_at TIMESTAMPTZ,
  transport_status TEXT,
  provider TEXT,
  customer_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_outbox_status_next_attempt_at
  ON crm_outbox(status, next_attempt_at ASC);

ALTER TABLE crm_outbox
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ack_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dead_letter_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS transport_status TEXT,
  ADD COLUMN IF NOT EXISTS provider TEXT;

CREATE INDEX IF NOT EXISTS idx_crm_outbox_external_lead_id
  ON crm_outbox(external_lead_id);

CREATE TABLE IF NOT EXISTS agent_runs (
  id UUID PRIMARY KEY,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  request_id UUID,
  route TEXT NOT NULL,
  mode TEXT,
  response_source TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  agent_release TEXT,
  prompt_version TEXT,
  policy_version TEXT,
  eval_dataset_version TEXT,
  total_ms INTEGER,
  planning_ms INTEGER,
  synthesis_ms INTEGER,
  agent_turns INTEGER,
  has_structured BOOLEAN NOT NULL DEFAULT FALSE,
  stream BOOLEAN NOT NULL DEFAULT FALSE,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_session_id_created_at
  ON agent_runs(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_request_id ON agent_runs(request_id);

CREATE TABLE IF NOT EXISTS tool_calls (
  id UUID PRIMARY KEY,
  agent_run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  call_order INTEGER NOT NULL,
  status TEXT NOT NULL,
  latency_ms INTEGER,
  summary TEXT,
  args JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tool_calls_agent_run_id_call_order
  ON tool_calls(agent_run_id, call_order ASC);

CREATE TABLE IF NOT EXISTS ops_audit_log (
  id UUID PRIMARY KEY,
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  outcome TEXT NOT NULL,
  actor TEXT,
  actor_type TEXT,
  request_id UUID,
  ip TEXT,
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ops_audit_log_created_at
  ON ops_audit_log(created_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_documents (
  id UUID PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_uri TEXT,
  title TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'zh-CN',
  status TEXT NOT NULL DEFAULT 'active',
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  content_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id UUID PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  content_tokens INTEGER,
  embedding_model TEXT,
  embedding vector(1536),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_document_id
  ON knowledge_chunks(document_id, chunk_index ASC);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding_cosine
  ON knowledge_chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE TABLE IF NOT EXISTS eval_runs (
  id UUID PRIMARY KEY,
  scenario_id TEXT NOT NULL,
  run_status TEXT NOT NULL,
  route TEXT,
  mode TEXT,
  score NUMERIC(5,2),
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eval_runs_scenario_id_created_at
  ON eval_runs(scenario_id, created_at DESC);
