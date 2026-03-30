"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AgentReadinessPanel } from "@/components/AgentReadinessPanel";
import {
  fetchBusinessDataStatus,
  fetchCrmOutbox,
  fetchDbHealth,
  fetchHealthStatus,
  fetchKnowledgeStatus,
  fetchOpsAuditLog,
  fetchOpsConfigStatus,
  fetchOpsDashboard,
  refreshBusinessData,
  runCrmSync,
} from "@/lib/api";
import type {
  AuditSummary,
  BusinessDataStatusResponse,
  CrmOutboxResponse,
  DatabaseHealthStatus,
  HealthStatus,
  KnowledgeStatusResponse,
  OpsAuditLogResponse,
  OpsDashboardResponse,
  RuntimeConfigReport,
} from "@/lib/types";

const OPS_TOKEN_KEY = "xpeng_ops_token";

function formatTime(value?: string | null) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatRate(value?: number | null) {
  if (typeof value !== "number") return "--";
  return `${Math.round(value * 100)}%`;
}

function freshnessLabel(status?: string | null) {
  if (status === "fresh") return "实时";
  if (status === "mock_active") return "Mock 生效";
  if (status === "stale") return "待刷新";
  if (status === "degraded") return "降级";
  if (status === "unavailable") return "未接通";
  return "未知";
}

function freshnessOk(status?: string | null) {
  return status === "fresh" || status === "mock_active";
}

function tone(ok: boolean) {
  return ok
    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
    : "border-amber-200 bg-amber-50 text-amber-900";
}

function auditCounts(summary?: AuditSummary | null) {
  return summary?.counts || {
    total: summary?.total || 0,
    success: summary?.byOutcome?.success || 0,
    denied: summary?.byOutcome?.denied || 0,
    error: summary?.byOutcome?.error || 0,
  };
}

export default function OpsPage() {
  const [draftToken, setDraftToken] = useState("");
  const [opsToken, setOpsToken] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncingCrm, setSyncingCrm] = useState(false);
  const [refreshingBusinessData, setRefreshingBusinessData] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [businessRefreshMessage, setBusinessRefreshMessage] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [dbHealth, setDbHealth] = useState<DatabaseHealthStatus | null>(null);
  const [config, setConfig] = useState<RuntimeConfigReport | null>(null);
  const [audit, setAudit] = useState<OpsAuditLogResponse | null>(null);
  const [businessData, setBusinessData] = useState<BusinessDataStatusResponse | null>(null);
  const [knowledge, setKnowledge] = useState<KnowledgeStatusResponse | null>(null);
  const [crmOutbox, setCrmOutbox] = useState<CrmOutboxResponse | null>(null);
  const [dashboard, setDashboard] = useState<OpsDashboardResponse | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    try {
      const savedToken = sessionStorage.getItem(OPS_TOKEN_KEY);
      if (savedToken) {
        setDraftToken(savedToken);
        setOpsToken(savedToken);
      }
    } catch {}
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const nextErrors: Record<string, string> = {};
      const results = await Promise.allSettled([
        fetchHealthStatus(),
        fetchDbHealth(),
        fetchOpsConfigStatus(opsToken),
        fetchOpsAuditLog(opsToken, 12),
        fetchBusinessDataStatus(),
        fetchKnowledgeStatus(),
        fetchCrmOutbox(opsToken, { limit: 10 }),
        fetchOpsDashboard(opsToken),
      ]);
      if (cancelled) return;

      const [healthResult, dbResult, configResult, auditResult, businessResult, knowledgeResult, crmResult, dashboardResult] = results;

      if (healthResult.status === "fulfilled") setHealth(healthResult.value);
      else nextErrors.health = healthResult.reason instanceof Error ? healthResult.reason.message : "基础健康状态加载失败。";

      if (dbResult.status === "fulfilled") setDbHealth(dbResult.value);
      else nextErrors.db = dbResult.reason instanceof Error ? dbResult.reason.message : "数据库状态加载失败。";

      if (configResult.status === "fulfilled") setConfig(configResult.value);
      else nextErrors.config = configResult.reason instanceof Error ? configResult.reason.message : "运行配置状态加载失败。";

      if (auditResult.status === "fulfilled") setAudit(auditResult.value);
      else nextErrors.audit = auditResult.reason instanceof Error ? auditResult.reason.message : "审计日志加载失败。";

      if (businessResult.status === "fulfilled") setBusinessData(businessResult.value);
      else nextErrors.business = businessResult.reason instanceof Error ? businessResult.reason.message : "业务数据状态加载失败。";

      if (knowledgeResult.status === "fulfilled") setKnowledge(knowledgeResult.value);
      else nextErrors.knowledge = knowledgeResult.reason instanceof Error ? knowledgeResult.reason.message : "知识库状态加载失败。";

      if (crmResult.status === "fulfilled") setCrmOutbox(crmResult.value);
      else nextErrors.crm = crmResult.reason instanceof Error ? crmResult.reason.message : "CRM outbox 加载失败。";

      if (dashboardResult.status === "fulfilled") setDashboard(dashboardResult.value);
      else nextErrors.dashboard = dashboardResult.reason instanceof Error ? dashboardResult.reason.message : "运营看板加载失败。";

      setErrors(nextErrors);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [opsToken, refreshKey]);

  const auditSummary = auditCounts(audit?.summary);
  const configIssues = useMemo(() => (config?.checks || []).filter((item) => item.status !== "ok"), [config]);
  const businessEntries = Object.entries(businessData?.sources || {});
  const topTools = dashboard?.breakdowns.tools.slice(0, 4) || [];

  function applyToken() {
    const value = draftToken.trim();
    try {
      if (value) sessionStorage.setItem(OPS_TOKEN_KEY, value);
      else sessionStorage.removeItem(OPS_TOKEN_KEY);
    } catch {}
    setOpsToken(value || null);
    setRefreshKey((current) => current + 1);
  }

  async function handleCrmSync() {
    setSyncingCrm(true);
    setSyncMessage(null);
    try {
      const result = await runCrmSync(opsToken, { limit: 10, force: true });
      setSyncMessage(`已触发同步：尝试 ${result.attempted} 条，成功 ${result.synced} 条，失败 ${result.failed} 条。`);
      setRefreshKey((current) => current + 1);
    } catch (error) {
      setSyncMessage(error instanceof Error ? error.message : "CRM 同步失败。");
    } finally {
      setSyncingCrm(false);
    }
  }

  async function handleBusinessDataRefresh() {
    setRefreshingBusinessData(true);
    setBusinessRefreshMessage(null);
    try {
      const result = await refreshBusinessData(opsToken);
      const failed = result.results.filter((item) => item.ok === false).length;
      setBusinessRefreshMessage(failed ? `刷新完成，但有 ${failed} 个数据源回退本地缓存。` : "业务数据已刷新完成。");
      setRefreshKey((current) => current + 1);
    } catch (error) {
      setBusinessRefreshMessage(error instanceof Error ? error.message : "业务数据刷新失败。");
    } finally {
      setRefreshingBusinessData(false);
    }
  }

  return (
    <main className="app-mesh-bg min-h-screen">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="rounded-[32px] border border-white/80 bg-[linear-gradient(135deg,rgba(26,32,44,0.95),rgba(15,23,42,0.92))] p-6 text-white shadow-[0_28px_80px_-40px_rgba(15,23,42,0.6)]">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-[11px] font-semibold tracking-[0.24em] text-[#f4b183]">内部运营页</p>
              <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">运营与安全控制台</h1>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-white/78">
                这里集中查看运行状态、发布门禁、CRM 同步、审计和数据新鲜度。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link href="/" className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/16">返回首页</Link>
              <button type="button" onClick={() => setRefreshKey((current) => current + 1)} className="rounded-full bg-[#eb5b2a] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#d94d20]">刷新面板</button>
            </div>
          </div>
          <div className="mt-5 grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-[24px] border border-white/12 bg-white/8 p-4 text-sm text-white/78">
              如果后端配置了 `OPS_ACCESS_TOKEN`，请在右侧填入后刷新；未配置时，localhost 开发环境可直接访问。
            </div>
            <div className="rounded-[24px] border border-white/12 bg-white/8 p-4">
              <div className="flex flex-col gap-2 sm:flex-row">
                <input value={draftToken} onChange={(event) => setDraftToken(event.target.value)} placeholder="留空则尝试本机开发访问" className="min-w-0 flex-1 rounded-2xl border border-white/16 bg-[#0f172a]/70 px-4 py-2.5 text-sm text-white outline-none placeholder:text-white/35 focus:border-[#ffb36b]" />
                <button type="button" onClick={applyToken} className="rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-[#fff0e5]">保存并刷新</button>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-5">
          <div className="rounded-[28px] border border-white/80 bg-white/95 p-5 shadow-card">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-ink-900">系统概览</p>
              <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${tone(Boolean(health?.ok))}`}>
                {health?.ok ? "运行中" : "待检查"}
              </span>
            </div>
            <div className="mt-4 space-y-2 text-sm text-ink-700">
              <p>门店数：{health?.service.storesLoaded ?? "--"}</p>
              <p>活跃会话：{health?.service.sessions ?? "--"}</p>
              <p>会话 TTL：{health ? Math.round(health.service.sessionTtlMs / 3600000) : "--"} 小时</p>
              <p>地图能力：{health?.service.amapEnabled ? "已启用" : "未启用"}</p>
            </div>
          </div>

          <div className="rounded-[28px] border border-white/80 bg-white/95 p-5 shadow-card">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-ink-900">模型状态</p>
              <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${tone(Boolean(health?.llm?.available))}`}>
                {health?.llm?.available ? "可用" : "兜底"}
              </span>
            </div>
            <div className="mt-4 space-y-2 text-sm text-ink-700">
              <p>模型：{health?.llm?.model || "未配置"}</p>
              <p>提供方：{health?.llm?.provider || "--"}</p>
              <p>超时阈值：{health?.llm?.timeoutMs ?? "--"} ms</p>
              <p>最近故障：{formatTime(health?.llm?.lastFailureAt)}</p>
            </div>
          </div>

          <div className="rounded-[28px] border border-white/80 bg-white/95 p-5 shadow-card">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-ink-900">数据库</p>
              <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${tone(Boolean(dbHealth?.ok))}`}>
                {dbHealth?.ok ? "已连接" : "未连接"}
              </span>
            </div>
            <div className="mt-4 space-y-2 text-sm text-ink-700">
              <p>模式：{dbHealth?.storageProvider || "--"}</p>
              <p>库名：{dbHealth?.database || dbHealth?.message || "--"}</p>
              <p>用户：{dbHealth?.currentUser || "--"}</p>
              <p>pgvector：{dbHealth?.vectorEnabled ? "已启用" : "未启用"}</p>
            </div>
          </div>

          <div className="rounded-[28px] border border-white/80 bg-white/95 p-5 shadow-card">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-ink-900">CRM 同步</p>
              <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${tone(Boolean(crmOutbox?.summary?.enabled || health?.crmSync?.enabled))}`}>
                {crmOutbox?.summary?.enabled || health?.crmSync?.enabled ? "已开启" : "未开启"}
              </span>
            </div>
            <div className="mt-4 space-y-2 text-sm text-ink-700">
              <p>待同步：{crmOutbox?.summary.counts.pending ?? health?.crmSync?.counts?.pending ?? 0}</p>
              <p>已发送：{crmOutbox?.summary.counts.sent ?? health?.crmSync?.counts?.sent ?? 0}</p>
              <p>已回执：{crmOutbox?.summary.counts.acknowledged ?? health?.crmSync?.counts?.acknowledged ?? 0}</p>
              <p>已入库：{crmOutbox?.summary.counts.synced ?? health?.crmSync?.counts?.synced ?? 0}</p>
              <p>失败：{crmOutbox?.summary.counts.failed ?? health?.crmSync?.counts?.failed ?? 0}</p>
              <p>死信：{crmOutbox?.summary.counts.dead_letter ?? health?.crmSync?.counts?.dead_letter ?? 0}</p>
            </div>
          </div>

          <div className="rounded-[28px] border border-white/80 bg-white/95 p-5 shadow-card">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-ink-900">发布门禁</p>
              <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${tone(dashboard?.release.status === "ready")}`}>
                {dashboard?.release.status === "ready" ? "可发布" : "阻塞中"}
              </span>
            </div>
            <div className="mt-4 space-y-2 text-sm text-ink-700">
              <p>通过门禁：{dashboard?.release.readyGateCount ?? "--"}</p>
              <p>阻塞门禁：{dashboard?.release.blockedGateCount ?? "--"}</p>
              <p>最近通过率：{formatRate(dashboard?.release.latestPassRate)}</p>
              <p>关键失败数：{dashboard?.release.latestCriticalFailed ?? "--"}</p>
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr_1fr]">
          <div className="rounded-[28px] border border-white/80 bg-white/95 p-5 shadow-card">
            <p className="text-sm font-semibold text-ink-900">运行指标</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-ink-100 bg-ink-50/70 p-3">
                <p className="text-xs text-ink-500">总运行</p>
                <p className="mt-1 text-lg font-semibold text-ink-900">{dashboard?.traffic.totalRuns ?? "--"}</p>
              </div>
              <div className="rounded-2xl border border-ink-100 bg-ink-50/70 p-3">
                <p className="text-xs text-ink-500">近 24 小时</p>
                <p className="mt-1 text-lg font-semibold text-ink-900">{dashboard?.traffic.recent24h ?? "--"}</p>
              </div>
              <div className="rounded-2xl border border-ink-100 bg-ink-50/70 p-3">
                <p className="text-xs text-ink-500">结构化输出率</p>
                <p className="mt-1 text-lg font-semibold text-ink-900">{formatRate(dashboard?.traffic.structuredRate)}</p>
              </div>
              <div className="rounded-2xl border border-ink-100 bg-ink-50/70 p-3">
                <p className="text-xs text-ink-500">兜底率</p>
                <p className="mt-1 text-lg font-semibold text-ink-900">{formatRate(dashboard?.traffic.fallbackRate)}</p>
              </div>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <div className="rounded-2xl border border-ink-100 bg-white p-4 text-sm text-ink-700">
                <p>平均延迟：{dashboard?.traffic.avgLatencyMs ?? "--"} ms</p>
                <p className="mt-1">P95 延迟：{dashboard?.traffic.p95LatencyMs ?? "--"} ms</p>
                <p className="mt-2 text-xs text-ink-500">高频工具：{topTools.map((item) => `${item.key} ${item.count}`).join(" / ") || "暂无"}</p>
              </div>
              <div className="rounded-2xl border border-ink-100 bg-white p-4 text-sm text-ink-700">
                <p>线索总量：{dashboard?.funnel.totalLeads ?? "--"}</p>
                <p className="mt-1">顾问分配率：{formatRate(dashboard?.funnel.advisorAssignedRate)}</p>
                <p className="mt-1">CRM 就绪率：{formatRate(dashboard?.funnel.crmReadyRate)}</p>
                <p className="mt-1">CRM 同步率：{formatRate(dashboard?.funnel.crmSyncedRate)}</p>
                <p className="mt-2 text-xs text-ink-500">
                  生命周期：待同步 {dashboard?.funnel.crmPending ?? 0} / 已发送 {dashboard?.funnel.crmSent ?? 0} /
                  已回执 {dashboard?.funnel.crmAcknowledged ?? 0} / 已入库 {dashboard?.funnel.crmSynced ?? 0} /
                  失败 {dashboard?.funnel.crmFailed ?? 0} / 死信 {dashboard?.funnel.crmDeadLetter ?? 0}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-[28px] border border-white/80 bg-white/95 p-5 shadow-card">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-ink-900">业务数据</p>
              <button type="button" onClick={handleBusinessDataRefresh} disabled={refreshingBusinessData} className="rounded-full border border-[#f3c9a8] bg-[#fff3e8] px-3 py-1.5 text-xs font-semibold text-[#8f431f] transition hover:bg-[#ffe6d1] disabled:opacity-50">
                {refreshingBusinessData ? "刷新中..." : "手动刷新"}
              </button>
            </div>
            {businessRefreshMessage ? <p className="mt-3 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">{businessRefreshMessage}</p> : null}
            <div className="mt-4 space-y-3">
              {businessEntries.map(([key, item]) => (
                <div key={key} className="rounded-2xl border border-ink-100 bg-ink-50/60 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-ink-900">{key}</p>
                    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${tone(freshnessOk(item.freshnessStatus))}`}>
                      {freshnessLabel(item.freshnessStatus)}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-6 text-ink-600">
                    数量 {item.count} / Provider {item.provider} / Source {item.sourceType}
                  </p>
                  <p className="text-xs leading-6 text-ink-500">
                    fetchedAt {formatTime(item.fetchedAt)} / expiresAt {formatTime(item.expiresAt)}
                  </p>
                  <p className="text-xs leading-6 text-ink-500">
                    brand {item.brand || item.source.brand || "小鹏 only"}
                    {item.fallbackUsed ? " / fallback 已启用" : ""}
                    {item.remoteConfigured === false ? " / live 未配置" : ""}
                  </p>
                  {item.lastError || item.errors?.length ? (
                    <p className="text-xs leading-6 text-rose-700">
                      {(item.lastError || item.errors?.[0]) ?? "数据源异常"}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[28px] border border-white/80 bg-white/95 p-5 shadow-card">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-ink-900">知识与 CRM</p>
              <button type="button" onClick={handleCrmSync} disabled={syncingCrm} className="rounded-full bg-[#eb5b2a] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#d94d20] disabled:opacity-50">
                {syncingCrm ? "同步中..." : "触发 CRM 同步"}
              </button>
            </div>
            {syncMessage ? <p className="mt-3 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">{syncMessage}</p> : null}
            <div className="mt-4 space-y-3 text-sm text-ink-700">
              <p>知识提供方：{knowledge?.provider || "--"}</p>
              <p>数据库文档：{knowledge?.database.documents ?? "--"} / 已嵌入切片：{knowledge?.database.embeddedChunks ?? "--"}</p>
              <p>Webhook：{crmOutbox?.summary.webhookUrlConfigured ? "已配置" : "未配置"}</p>
              <p>最近 outbox：{crmOutbox?.items[0] ? `${crmOutbox.items[0].customer?.name || "匿名线索"} / ${crmOutbox.items[0].status}` : "暂无"}</p>
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-[28px] border border-white/80 bg-white/95 p-5 shadow-card">
            <p className="text-sm font-semibold text-ink-900">运行配置</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-ink-100 bg-ink-50/70 p-3">
                <p className="text-xs text-ink-500">运行环境</p>
                <p className="mt-1 text-sm font-semibold text-ink-900">{config?.nodeEnv || "--"} / {config?.storageProvider || "--"}</p>
              </div>
              <div className="rounded-2xl border border-ink-100 bg-ink-50/70 p-3">
                <p className="text-xs text-ink-500">审计事件</p>
                <p className="mt-1 text-sm font-semibold text-ink-900">{auditSummary.total}</p>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {configIssues.length === 0 ? (
                <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">当前没有待处理的配置告警。</p>
              ) : (
                configIssues.slice(0, 5).map((item) => (
                  <div key={item.id} className={`rounded-2xl border px-4 py-3 text-sm ${item.status === "error" ? "border-rose-200 bg-rose-50 text-rose-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
                    <p className="font-semibold">{item.id}</p>
                    <p className="mt-1 leading-relaxed">{item.detail}</p>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-[28px] border border-white/80 bg-white/95 p-5 shadow-card">
            <p className="text-sm font-semibold text-ink-900">最近审计事件</p>
            <div className="mt-4 space-y-3">
              {(audit?.items || []).slice(0, 6).map((item) => (
                <div key={`${item.createdAt}-${item.action}-${item.requestId || ""}`} className="rounded-2xl border border-ink-100 bg-ink-50/60 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-ink-900">{item.action} / {item.resource}</p>
                    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${item.outcome === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : item.outcome === "denied" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-rose-200 bg-rose-50 text-rose-900"}`}>
                      {item.outcome}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-6 text-ink-600">{formatTime(item.createdAt)} / {item.actor || "--"} / {item.actorType || "--"}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <AgentReadinessPanel opsToken={opsToken} refreshKey={refreshKey} />

        {loading ? <p className="text-center text-sm text-ink-500">控制台加载中...</p> : null}
        {Object.keys(errors).length ? <p className="text-center text-sm text-amber-700">{Object.values(errors)[0]}</p> : null}
      </div>
    </main>
  );
}
