export type ChatMode = "recommendation" | "comparison" | "service" | "configurator";

export interface StructuredCar {
  brand?: string;
  name: string;
  image?: string;
  price?: string;
  range?: string;
  smart?: string;
  fitScore?: number;
  bestFor?: string;
  reasons?: string[];
  tradeoffs?: string[];
}

export interface RecommendationStructured {
  intro?: string;
  persona_summary?: string;
  decision_drivers?: string[];
  cars?: StructuredCar[];
  compare_note?: string;
  missing_info?: string[];
  next_steps?: string[];
  final_one_liner?: string;
  followups?: string[];
}

export interface ComparisonDimension {
  label: string;
  a?: string;
  b?: string;
}

export interface ComparisonStructured {
  carNames?: string[];
  intro?: string;
  decision_focus?: string[];
  dimensions?: ComparisonDimension[];
  conclusion?: string;
  next_steps?: string[];
  followups?: string[];
}

export interface ServiceStructured {
  citations?: Array<{
    title?: string | null;
    sourceUri?: string | null;
    provider?: string | null;
    chunkId?: string | null;
    chunkIndex?: number | null;
    similarity?: number | null;
  }>;
  title?: string;
  diagnosis?: string;
  steps?: string[];
  notes?: string[];
  when_to_escalate?: string[];
  next_steps?: string[];
  closing?: string;
  followups?: string[];
}

export interface ConfiguratorStructured {
  model?: string | null;
  variant?: string | null;
  exteriorColor?: string | null;
  interiorColor?: string | null;
  packages?: string[];
  notes?: string[];
  restrictionNotes?: string[];
  activeRestrictionNotes?: string[];
  estimatedPrice?: string | null;
  estimatedPriceNote?: string | null;
  summary_text?: string;
  sourceUrl?: string | null;
  fetchedAt?: string | null;
  version?: string | null;
  selectedModel?: string | null;
  selectedVariant?: string | null;
  selectedColor?: string | null;
  selectedInterior?: string | null;
  selectedPackages?: string[];
  done?: boolean;
}

export type StructuredPayload =
  | RecommendationStructured
  | ComparisonStructured
  | ServiceStructured
  | ConfiguratorStructured;

export interface AgentProfile {
  budget?: string;
  city?: string;
  charging?: string;
  seats?: string;
  bodyTypes?: string[];
  energyTypes?: string[];
  priorities?: string[];
  usage?: string[];
  preferredBrands?: string[];
  excludedBrands?: string[];
  mentionedCars?: string[];
}

export interface AgentTraceStep {
  type: "memory" | "plan" | "tool";
  status: "completed" | "failed";
  title: string;
  detail: string;
}

export interface ReActStep {
  type: "think" | "act" | "observe" | "reset" | "done";
  thought?: string;
  action?: string;
  actionInput?: unknown;
  observation?: string;
  turn?: number;
}

export interface ConfiguratorChoiceModel {
  key: string;
  name: string;
  brand?: string | null;
  sourceUrl?: string | null;
  fetchedAt?: string | null;
  version?: string | null;
  variants: number;
  colors: number;
  interiors: number;
  packages: number;
  highlight?: string | null;
  basePrice?: number | null;
}

export interface ConfiguratorChoiceVariant {
  name: string;
  price?: number | null;
  highlight?: string | null;
}

export interface ConfiguratorChoiceColor {
  name: string;
  premium?: number;
  availableVariants?: string[];
  allowedInteriors?: string[];
}

export interface ConfiguratorChoiceInterior {
  name: string;
  premium?: number;
  availableVariants?: string[];
}

export interface ConfiguratorChoicePackage {
  name: string;
  price?: number;
  desc?: string | null;
  items?: string[];
  availableVariants?: string[];
  conflictsWith?: string[];
}

export interface ConfiguratorChoicesPayload {
  models: ConfiguratorChoiceModel[];
  variants: ConfiguratorChoiceVariant[];
  colors: ConfiguratorChoiceColor[];
  interiors: ConfiguratorChoiceInterior[];
  packages: ConfiguratorChoicePackage[];
  notes?: string[];
  restrictionNotes?: string[];
  activeRestrictionNotes?: string[];
}

export interface ConfiguratorResponse {
  reply: string;
  sessionId: string;
  mode?: ChatMode;
  stage?: string;
  config?: ConfiguratorStructured | Record<string, unknown>;
  structured?: ConfiguratorStructured | null;
  configSummary?: ConfiguratorStructured | null;
  configState?: ConfiguratorStructured | null;
  choices?: ConfiguratorChoicesPayload | null;
  agent?: AgentPayload | null;
  requestId?: string;
}

export interface AgentChecklistItem {
  label: string;
  done: boolean;
}

export interface AgentTiming {
  planning: number;
  synthesis: number;
  total: number;
}

export interface AgentTransition {
  nextStageCandidates: string[];
  ready: boolean;
  reason: string;
}

export interface AgentRouting {
  requiredDataSource: string;
  allowedTools: string[];
  preferredTools: string[];
  escalation?: {
    needed: boolean;
    stageCode?: string;
    reason?: string;
    action?: string;
  } | null;
}

export interface AgentPayload {
  stage?: string;
  stageCode?: "discover" | "recommend" | "compare" | "configure" | "convert" | "service" | "handoff";
  confidence?: number;
  status?: "waiting_user" | "profiling" | "decision_ready" | "ready_to_convert" | "solution_ready";
  statusLabel?: string;
  statusReason?: string;
  executionMode?: string;
  responseSource?: "llm" | "local";
  goal?: string;
  memorySummary?: string;
  profile?: AgentProfile;
  missingInfo?: string[];
  blockers?: string[];
  checklist?: AgentChecklistItem[];
  nextActions?: string[];
  nextBestAction?: string | null;
  next_best_action?: string | null;
  toolCalls?: string[];
  tool_calls?: string[];
  toolsUsed?: string[];
  timingMs?: AgentTiming;
  trace?: AgentTraceStep[];
  transition?: AgentTransition | null;
  routing?: AgentRouting | null;
  fallback?: Record<string, unknown> | null;
}

export interface AgentReadinessDimension {
  key: string;
  title: string;
  score: number;
  maxScore: number;
  level: "strong" | "partial" | "weak";
  evidence: string[];
  gaps: string[];
  nextSteps: string[];
}

export interface AgentReadinessReport {
  generatedAt: string;
  overallScore: number;
  overallPercent: number;
  overallLevel: "launch-near" | "pilot-ready" | "prototype-plus";
  summary: string;
  versions?: Record<string, string>;
  metrics: {
    runtime: {
      activeSessions: number;
      llmConfigured: boolean;
      amapEnabled: boolean;
      storesLoaded: number;
      sessionTtlHours: number;
    };
    conversations: {
      total: number;
      structuredRate: number;
      avgTurns: number;
      avgMs: number;
      p95Ms: number;
    };
    conversion: {
      totalLeads: number;
      routedLeadRate: number;
      geoLeadRate: number;
      scoredLeadRate?: number;
      advisorAssignedRate?: number;
      crmReadyRate?: number;
      crmSyncedRate?: number;
      webhookEnabled: boolean;
    };
  };
  businessDataStatus?: Record<string, unknown>;
  milestones: string[];
  dimensions: AgentReadinessDimension[];
}

export interface RuntimeConfigCheck {
  id: string;
  status: "ok" | "warning" | "error";
  severity: string;
  detail: string;
}

export interface RuntimeConfigReport {
  generatedAt: string;
  storageProvider: string;
  nodeEnv: string;
  security: {
    opsTokenConfigured: boolean;
    localDevBypassEnabled: boolean;
    headerName: string;
    actorHeaderName: string;
  };
  retention: {
    sessionDays: number;
    replayDays: number;
    leadDays: number;
    crmAttemptDays: number;
    crmOutboxDays: number;
    auditDays: number;
  };
  ok: boolean;
  counts: {
    total: number;
    ok: number;
    warning: number;
    error: number;
  };
  checks: RuntimeConfigCheck[];
}

export interface BusinessDataSourceStatus {
  provider: string;
  providerType?: string;
  sourceType: string;
  label?: string;
  brand?: string | null;
  path?: string | null;
  remoteUrl?: string | null;
  remoteConfigured?: boolean;
  fallbackUsed?: boolean;
  fetchedAt?: string | null;
  expiresAt?: string | null;
  freshnessStatus?: string;
  ageHours?: number | null;
  staleAfterHours?: number | null;
  stale?: boolean;
  error?: string | null;
  lastError?: string | null;
  fallbackMode?: string | null;
}

export interface BusinessDataItemStatus {
  provider: string;
  sourceType: string;
  count: number;
  fetchedAt: string | null;
  expiresAt: string | null;
  freshnessStatus: string;
  lastError: string | null;
  errors: string[];
  remoteConfigured?: boolean;
  fallbackUsed?: boolean;
  brand?: string | null;
  source: BusinessDataSourceStatus;
  version?: string | null;
}

export interface BusinessDataStatusResponse {
  generatedAt: string;
  version: string;
  sources: Record<string, BusinessDataItemStatus>;
}

export interface BusinessDataRefreshResponse extends BusinessDataStatusResponse {
  ok: boolean;
  results: Array<{
    kind: string;
    ok: boolean;
    refreshed: boolean;
    mode: string;
    reason: string;
    error?: string;
  }>;
}

export interface KnowledgeStatusResponse {
  generatedAt: string;
  provider: string;
  generated: {
    exists: boolean;
    records: number;
    documents: number;
    chunks: number;
  };
  sourceFiles: number;
  embedding: {
    configured: boolean;
    model: string;
    dimensions: number;
  };
  database: {
    configured: boolean;
    vectorEnabled: boolean;
    documents: number;
    chunks: number;
    embeddedChunks: number;
    error: string | null;
  };
}

export interface HealthStatus {
  ok: boolean;
  service: {
    port: number;
    sessions: number;
    sessionTtlMs: number;
    maxActiveSessions: number;
    storesLoaded: number;
    amapEnabled: boolean;
  };
  llm?: {
    configured: boolean;
    available: boolean;
    provider: string;
    model: string;
    timeoutMs: number;
    failureCooldownMs: number;
    cooldownUntil?: string | null;
    lastFailureAt?: string | null;
    lastError?: string | null;
  };
  businessData?: Record<string, unknown>;
  businessDataRefresh?: Record<string, unknown>;
  crmSync?: {
    enabled?: boolean;
    counts?: CrmSyncCounts;
  };
  security?: Record<string, unknown>;
  retention?: Record<string, unknown>;
  audit?: AuditSummary | null;
  config?: RuntimeConfigReport | null;
}

export interface DatabaseHealthStatus {
  ok: boolean;
  configured?: boolean;
  storageProvider: string;
  database?: string | null;
  currentUser?: string | null;
  now?: string | null;
  vectorEnabled?: boolean;
  message?: string;
  error?: string;
}

export interface OpsAuditLogItem {
  id?: string;
  requestId?: string;
  createdAt?: string;
  action?: string;
  resource?: string;
  outcome?: string;
  actor?: string;
  actorType?: string | null;
  metadata?: Record<string, unknown>;
}

export interface OpsAuditLogResponse {
  generatedAt: string;
  summary: AuditSummary | null;
  items: OpsAuditLogItem[];
}

export interface OpsDashboardBreakdownItem {
  key: string;
  count: number;
}

export interface OpsDashboardResponse {
  generatedAt: string;
  traffic: {
    totalRuns: number;
    recent24h: number;
    structuredRate: number;
    fallbackRate: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
  };
  breakdowns: {
    routes: OpsDashboardBreakdownItem[];
    modes: OpsDashboardBreakdownItem[];
    responseSources: OpsDashboardBreakdownItem[];
    statuses: OpsDashboardBreakdownItem[];
    tools: OpsDashboardBreakdownItem[];
    fallbackReasons: OpsDashboardBreakdownItem[];
  };
  funnel: {
    totalLeads: number;
    routedLeadRate: number;
    advisorAssignedRate: number;
    crmReadyRate: number;
    crmSyncedRate: number;
    crmPending: number;
    crmSent: number;
    crmAcknowledged: number;
    crmSynced: number;
    crmFailed: number;
    crmDeadLetter: number;
    crmProvider: string | null;
    crmEnabled: boolean;
  };
  release: {
    status: string;
    latestPassRate: number | null;
    latestCriticalFailed: number | null;
    readyGateCount: number;
    blockedGateCount: number;
  };
  freshness: {
    staleBusinessSources: string[];
    sources: Record<string, unknown>;
    knowledgeProvider: string;
    knowledgeVectorEnabled: boolean;
    knowledgeEmbeddedChunks: number;
  };
}

export interface CrmSyncCounts {
  total: number;
  pending: number;
  sent: number;
  acknowledged: number;
  synced: number;
  failed: number;
  dead_letter: number;
}

export interface CrmSyncSummary {
  enabled: boolean;
  provider?: string;
  webhookUrlConfigured: boolean;
  timeoutMs: number;
  maxAttempts: number;
  retryBaseMs: number;
  counts: CrmSyncCounts;
  recent: Array<{
    id: string;
    externalLeadId?: string | null;
    status: string;
    transportStatus?: string | null;
    attempts: number;
    updatedAt?: string | null;
    sentAt?: string | null;
    ackAt?: string | null;
    syncedAt?: string | null;
    deadLetterAt?: string | null;
    lastError?: string | null;
    lastHttpStatus?: number | null;
    provider?: string | null;
    customer?: {
      name?: string;
      phoneMasked?: string;
      city?: string | null;
    };
  }>;
}

export interface CrmOutboxItem {
  id: string;
  requestId?: string | null;
  externalLeadId?: string | null;
  stage?: string | null;
  priority?: string | null;
  score?: number | null;
  status: string;
  transportStatus?: string | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  nextAttemptAt?: string | null;
  lastAttemptAt?: string | null;
  lastHttpStatus?: number | null;
  lastError?: string | null;
  provider?: string | null;
  customer?: {
    name?: string;
    phoneMasked?: string;
    city?: string | null;
  };
}

export interface CrmOutboxResponse {
  generatedAt: string;
  summary: CrmSyncSummary;
  items: CrmOutboxItem[];
}

export interface CrmSyncRunResponse {
  ok: boolean;
  generatedAt: string;
  attempted: number;
  processed: number;
  sent: number;
  acknowledged: number;
  synced: number;
  deadLetter: number;
  failed: number;
  skipped: number;
  byId: Record<string, unknown>;
  summary: CrmSyncSummary;
}

export interface ChatResponse {
  reply: string;
  mode: ChatMode;
  sessionId?: string;
  requestId?: string;
  structured?: StructuredPayload;
  agent?: AgentPayload;
  uiHints?: ChatUiHints;
}

export interface ChatUiHints {
  showRecommendationCards?: boolean;
  showRecommendationConversion?: boolean;
  showServiceConversion?: boolean;
  showTestDriveCard?: boolean;
  showAdvisorFollowupCard?: boolean;
  conversionCarName?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  requestId?: string;
  mode?: ChatMode;
  structured?: StructuredPayload;
  agent?: AgentPayload;
  uiHints?: ChatUiHints;
  isStreaming?: boolean;
  streamingLabel?: string;
  streamingSteps?: string[];
  traceSteps?: string[];
}

export interface StoreMeta {
  brand?: string;
  disclaimer?: string;
  officialLocator?: string;
  officialAppointment?: string;
  serviceHotline?: string;
  lastReviewed?: string;
  source_url?: string;
  fetched_at?: string;
  version?: string;
  locationHierarchy?: Array<{
    province?: string;
    provinceCode?: string | null;
    cities?: Array<{
      name?: string;
      cityCode?: string | null;
    }>;
  }>;
  counts?: {
    provinces?: number;
    cities?: number;
    stores?: number;
  };
}

export interface StoreItem {
  id: string;
  brand?: string;
  name: string;
  city: string;
  province?: string;
  district?: string;
  provinceCode?: string | null;
  cityCode?: string | null;
  districtCode?: string | null;
  type?: string;
  address: string;
  phone?: string;
  servicePhone?: string;
  hours?: string;
  services?: string[];
  mapQuery?: string;
  lat?: number;
  lng?: number;
  source_url?: string;
  fetched_at?: string;
  version?: string;
}

export interface RoutedStore {
  id: string;
  brand?: string;
  name: string;
  city?: string;
  address: string;
  phone?: string;
  mapQuery?: string;
}

export interface AdvisorAssignment {
  id: string;
  name: string;
  title: string;
  team: string;
  city: string;
  brand: string;
  phone?: string | null;
  channel: string;
  assignmentReason: string;
}

export interface CrmLeadPayload {
  payloadVersion: string;
  requestId: string;
  externalLeadId: string;
  source: string;
  status: string;
  stage: string;
  priority: string;
  score: number;
  nextBestActions: string[];
  customer: {
    name: string;
    phone: string;
    city: string | null;
    preferredTime: string | null;
  };
  consent: {
    privacyConsent: boolean;
    contactConsent: boolean;
  };
  intent: {
    brand: string | null;
    carModel: string | null;
    purchaseStage: string | null;
    buyTimeline: string | null;
    remark: string | null;
  };
  routing: {
    method: string | null;
    storeId: string | null;
    storeName: string | null;
    storeCity: string | null;
    distanceKm: number | null;
    drivingDurationMin: number | null;
  };
  owner: {
    advisorId: string;
    advisorName: string;
    advisorTeam: string;
    advisorPhone: string | null;
  } | null;
  versions: Record<string, string>;
  syncReady: boolean;
}

export interface CrmSyncState {
  id: string;
  status: string;
  attempts: number;
  syncEnabled: boolean;
  lastError?: string | null;
  lastHttpStatus?: number | null;
  lastAttemptAt?: string | null;
  nextAttemptAt?: string | null;
  sentAt?: string | null;
  ackAt?: string | null;
  syncedAt?: string | null;
  deadLetterAt?: string | null;
  provider?: string | null;
  transportStatus?: string | null;
}

export interface TestDriveRouting {
  inferredBrand: string;
  inferenceSource: string;
  llmConfidence: number | null;
  llmReason: string | null;
  assignedStore: RoutedStore | null;
  method: string;
  distanceKm: number | null;
  drivingDurationMin?: number | null;
  officialAppointmentUrl: string;
  leadScore?: number;
  leadStage?: string;
  leadPriority?: string;
  nextBestActions?: string[];
  advisor?: AdvisorAssignment | null;
  matchedRightsTitle?: string | null;
  crmSyncReady?: boolean;
  crmSyncStatus?: string;
}

export interface StoresResponse {
  meta: StoreMeta;
  stores: StoreItem[];
}

export interface AuditSummary {
  total: number;
  byOutcome: Record<string, number>;
  counts?: {
    total: number;
    success: number;
    denied: number;
    error: number;
  };
  recent?: Array<Record<string, unknown>>;
}

export interface RightsMeta {
  brand?: string;
  disclaimer?: string;
  source_url?: string;
  fetched_at?: string;
  version?: string;
}

export interface RightsItem {
  id: string;
  brand?: string;
  city?: string;
  title: string;
  summary?: string;
  validFrom?: string;
  validTo?: string;
  source_url?: string;
  fetched_at?: string;
  version?: string;
}

export interface RightsResponse {
  meta: RightsMeta;
  items: RightsItem[];
}
