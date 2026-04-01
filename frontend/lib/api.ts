import type {
  AgentReadinessReport,
  BusinessDataRefreshResponse,
  BusinessDataStatusResponse,
  CrmOutboxResponse,
  CrmSyncRunResponse,
  DatabaseHealthStatus,
  HealthStatus,
  KnowledgeStatusResponse,
  OpsDashboardResponse,
  OpsAuditLogResponse,
  ChatResponse,
  ConfiguratorResponse,
  CrmLeadPayload,
  CrmSyncState,
  RuntimeConfigReport,
  StoresResponse,
  TestDriveRouting,
  RightsResponse,
} from "./types";

const defaultBase = "http://127.0.0.1:3001";
const DEFAULT_TIMEOUT_MS = 90000;

function apiBase(): string {
  return (process.env.NEXT_PUBLIC_API_URL || defaultBase).replace(/\/$/, "");
}

function opsHeaders(opsToken?: string | null): HeadersInit | undefined {
  const token = String(opsToken || "").trim();
  if (!token) return undefined;
  return {
    Authorization: `Bearer ${token}`,
  };
}

async function parseJsonSafely<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function protectedApiErrorMessage(
  status: number,
  data: { error?: string; code?: string } | null,
  fallback: string
) {
  if (status === 403) {
    return "未通过运维权限校验，请在 /ops 页面填写 Ops Token，或使用本机开发环境访问。";
  }
  return data?.error || fallback;
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS
) {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("请求超时，Agent 处理时间过长，请稍后重试。");
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timer);
  }
}

export async function fetchStores(params?: {
  q?: string;
  city?: string;
}): Promise<StoresResponse> {
  const sp = new URLSearchParams();
  if (params?.q) sp.set("q", params.q);
  if (params?.city) sp.set("city", params.city);

  const q = sp.toString();
  const res = await fetchWithTimeout(`${apiBase()}/api/stores${q ? `?${q}` : ""}`);
  const data = (await res.json()) as StoresResponse & { error?: string };

  if (!res.ok) {
    throw new Error(data.error || "加载门店失败。");
  }

  return data;
}

export async function fetchRightsSnapshot(): Promise<BusinessDataStatusResponse["sources"][string] | null> {
  const data = await fetchBusinessDataStatus();
  return data.sources?.rights || null;
}

export async function fetchRights(params?: {
  city?: string;
  brand?: string;
}): Promise<RightsResponse> {
  const sp = new URLSearchParams();
  if (params?.city) sp.set("city", params.city);
  if (params?.brand) sp.set("brand", params.brand);
  const q = sp.toString();
  const res = await fetchWithTimeout(`${apiBase()}/api/rights${q ? `?${q}` : ""}`);
  const data = (await res.json()) as RightsResponse & { error?: string };

  if (!res.ok) {
    throw new Error(data.error || "加载权益信息失败。");
  }

  return data;
}

export async function submitTestDrive(body: {
  name: string;
  phone: string;
  preferredTime?: string;
  carModel?: string;
  storeId?: string;
  remark?: string;
  purchaseStage?: string;
  buyTimeline?: string;
  privacyConsent: boolean;
  contactConsent?: boolean;
  userCity?: string;
  userLat?: number;
  userLng?: number;
}): Promise<{
  ok: boolean;
  message?: string;
  routing?: TestDriveRouting;
  crm?: CrmLeadPayload;
  crmSync?: CrmSyncState;
  error?: string;
}> {
  const res = await fetchWithTimeout(`${apiBase()}/api/test-drive`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = (await res.json()) as {
    ok?: boolean;
    message?: string;
    routing?: TestDriveRouting;
    crm?: CrmLeadPayload;
    crmSync?: CrmSyncState;
    error?: string;
  };

  if (!res.ok) {
    throw new Error(data.error || `提交失败 (${res.status})`);
  }

  return data as {
    ok: boolean;
    message?: string;
    routing?: TestDriveRouting;
    crm?: CrmLeadPayload;
    crmSync?: CrmSyncState;
  };
}

export async function streamChat(
  message: string,
  sessionId: string | null | undefined,
  clientProfileId: string | null | undefined,
  mode: ChatResponse["mode"] | undefined,
  onStep: (step: { type: string; thought?: string; action?: string; observation?: string }) => void,
  onDone: (result: Partial<ChatResponse> & { reply: string; sessionId: string; meta?: unknown }) => void,
  onError: (err: string) => void
): Promise<void> {
  const fallbackToPostChat = async (reason?: string) => {
    try {
      const data = await postChat(message, sessionId, clientProfileId, mode);
      onDone({
        reply: data.reply,
        sessionId: data.sessionId || sessionId || "",
        mode: data.mode,
        structured: data.structured,
        agent: data.agent,
        uiHints: data.uiHints,
        requestId: data.requestId,
        meta: {
          fallbackReason: reason || "stream_unavailable",
        },
      });
    } catch (error) {
      onError(error instanceof Error ? error.message : reason || "stream_and_post_chat_failed");
    }
  };

  const res = await fetch(`${apiBase()}/api/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      ...(sessionId ? { sessionId } : {}),
      ...(clientProfileId ? { clientProfileId } : {}),
      ...(mode ? { mode } : {}),
    }),
  });

  if (!res.ok || !res.body) {
    await fallbackToPostChat(`stream_http_${res.status}`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("event:")) {
        currentEvent = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        try {
          const data = JSON.parse(line.slice(5).trim());
          if (currentEvent === "step") onStep(data as { type: string });
          else if (currentEvent === "done") onDone(data as { reply: string; sessionId: string });
          else if (currentEvent === "error") {
            await fallbackToPostChat((data as { message?: string }).message || "stream_error");
          }
        } catch (_) {}
        currentEvent = "";
      }
    }
  }
}

export async function fetchGeocodeCity(lat: number, lng: number): Promise<{
  city: string | null;
  district?: string | null;
  province?: string | null;
  formattedAddress?: string | null;
  error?: string;
}> {
  const res = await fetchWithTimeout(
    `${apiBase()}/api/geocode/city?lat=${lat}&lng=${lng}`
  );
  const data = await res.json() as {
    city: string | null;
    district?: string | null;
    province?: string | null;
    formattedAddress?: string | null;
    error?: string;
  };
  return data;
}

export async function fetchHealthStatus(): Promise<HealthStatus> {
  const res = await fetchWithTimeout(`${apiBase()}/health`);
  const data = (await res.json()) as HealthStatus & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `健康检查请求失败 (${res.status})`);
  }
  return data;
}

export async function fetchDbHealth(): Promise<DatabaseHealthStatus> {
  const res = await fetchWithTimeout(`${apiBase()}/api/db/health`);
  const data = (await res.json()) as DatabaseHealthStatus & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `数据库状态请求失败 (${res.status})`);
  }
  return data;
}

export async function fetchBusinessDataStatus(): Promise<BusinessDataStatusResponse> {
  const res = await fetchWithTimeout(`${apiBase()}/api/business-data/status`);
  const data = (await res.json()) as BusinessDataStatusResponse & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `业务数据状态请求失败 (${res.status})`);
  }
  return data;
}

export async function refreshBusinessData(
  opsToken?: string | null,
  body: { kinds?: string[] } = {}
): Promise<BusinessDataRefreshResponse> {
  const res = await fetchWithTimeout(`${apiBase()}/api/business-data/refresh`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(opsHeaders(opsToken) || {}),
    },
    body: JSON.stringify(body),
  });
  const data = await parseJsonSafely<BusinessDataRefreshResponse & { error?: string; code?: string }>(res);
  if (!res.ok) {
    throw new Error(protectedApiErrorMessage(res.status, data, `业务数据刷新失败 (${res.status})`));
  }
  return data as BusinessDataRefreshResponse;
}

export async function fetchKnowledgeStatus(): Promise<KnowledgeStatusResponse> {
  const res = await fetchWithTimeout(`${apiBase()}/api/knowledge/status`);
  const data = (await res.json()) as KnowledgeStatusResponse & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `知识库状态请求失败 (${res.status})`);
  }
  return data;
}

export async function postConfigurator(
  message: string,
  sessionId?: string | null
): Promise<ConfiguratorResponse> {
  const res = await fetchWithTimeout(`${apiBase()}/api/configurator`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, ...(sessionId ? { sessionId } : {}) }),
  });
  const data = (await res.json()) as ConfiguratorResponse & { error?: string };
  if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
  return data;
}

export async function postChat(
  message: string,
  sessionId?: string | null,
  clientProfileId?: string | null,
  mode?: ChatResponse["mode"]
): Promise<ChatResponse> {
  const res = await fetchWithTimeout(`${apiBase()}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      ...(sessionId ? { sessionId } : {}),
      ...(clientProfileId ? { clientProfileId } : {}),
      ...(mode ? { mode } : {}),
    }),
  });

  const data = (await res.json()) as ChatResponse & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `请求失败 (${res.status})`);
  }

  return data;
}

export async function fetchAgentReadiness(
  opsToken?: string | null
): Promise<AgentReadinessReport> {
  const res = await fetchWithTimeout(`${apiBase()}/api/agent/readiness`, {
    headers: opsHeaders(opsToken),
  });
  const data = await parseJsonSafely<AgentReadinessReport & { error?: string; code?: string }>(res);
  if (!res.ok) {
    throw new Error(protectedApiErrorMessage(res.status, data, `运营面板加载失败 (${res.status})`));
  }
  return data as AgentReadinessReport;
}

export async function fetchOpsConfigStatus(
  opsToken?: string | null
): Promise<RuntimeConfigReport> {
  const res = await fetchWithTimeout(`${apiBase()}/api/ops/config-status`, {
    headers: opsHeaders(opsToken),
  });
  const data = await parseJsonSafely<RuntimeConfigReport & { error?: string; code?: string }>(res);
  if (!res.ok) {
    throw new Error(protectedApiErrorMessage(res.status, data, `配置状态加载失败 (${res.status})`));
  }
  return data as RuntimeConfigReport;
}

export async function fetchOpsAuditLog(
  opsToken?: string | null,
  limit = 20
): Promise<OpsAuditLogResponse> {
  const res = await fetchWithTimeout(`${apiBase()}/api/ops/audit-log?limit=${limit}`, {
    headers: opsHeaders(opsToken),
  });
  const data = await parseJsonSafely<OpsAuditLogResponse & { error?: string; code?: string }>(res);
  if (!res.ok) {
    throw new Error(protectedApiErrorMessage(res.status, data, `审计日志加载失败 (${res.status})`));
  }
  return data as OpsAuditLogResponse;
}

export async function fetchOpsDashboard(
  opsToken?: string | null
): Promise<OpsDashboardResponse> {
  const res = await fetchWithTimeout(`${apiBase()}/api/ops/dashboard`, {
    headers: opsHeaders(opsToken),
  });
  const data = await parseJsonSafely<OpsDashboardResponse & { error?: string; code?: string }>(res);
  if (!res.ok) {
    throw new Error(protectedApiErrorMessage(res.status, data, `运营概览加载失败 (${res.status})`));
  }
  return data as OpsDashboardResponse;
}

export async function fetchCrmOutbox(
  opsToken?: string | null,
  params: {
    status?: string;
    limit?: number;
  } = {}
): Promise<CrmOutboxResponse> {
  const sp = new URLSearchParams();
  if (params.status) sp.set("status", params.status);
  if (params.limit) sp.set("limit", String(params.limit));
  const query = sp.toString();
  const res = await fetchWithTimeout(`${apiBase()}/api/crm/outbox${query ? `?${query}` : ""}`, {
    headers: opsHeaders(opsToken),
  });
  const data = await parseJsonSafely<CrmOutboxResponse & { error?: string; code?: string }>(res);
  if (!res.ok) {
    throw new Error(protectedApiErrorMessage(res.status, data, `CRM 队列加载失败 (${res.status})`));
  }
  return data as CrmOutboxResponse;
}

export async function runCrmSync(
  opsToken?: string | null,
  body: {
    limit?: number;
    force?: boolean;
    ids?: string[];
  } = {}
): Promise<CrmSyncRunResponse> {
  const res = await fetchWithTimeout(`${apiBase()}/api/crm/sync/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(opsHeaders(opsToken) || {}),
    },
    body: JSON.stringify(body),
  });
  const data = await parseJsonSafely<CrmSyncRunResponse & { error?: string; code?: string }>(res);
  if (!res.ok) {
    throw new Error(protectedApiErrorMessage(res.status, data, `CRM 同步执行失败 (${res.status})`));
  }
  return data as CrmSyncRunResponse;
}
