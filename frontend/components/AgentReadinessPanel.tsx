"use client";

import { useEffect, useState } from "react";
import { fetchAgentReadiness } from "@/lib/api";
import type { AgentReadinessReport } from "@/lib/types";

function levelTone(level: AgentReadinessReport["overallLevel"]) {
  if (level === "launch-near") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (level === "pilot-ready") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-sky-200 bg-sky-50 text-sky-900";
}

function levelLabel(level: AgentReadinessReport["overallLevel"]) {
  if (level === "launch-near") return "接近正式上线";
  if (level === "pilot-ready") return "适合试点验证";
  return "原型增强阶段";
}

function dimensionTone(level: "strong" | "partial" | "weak") {
  if (level === "strong") return "border-emerald-200 bg-emerald-50/70 text-emerald-900";
  if (level === "partial") return "border-amber-200 bg-amber-50/70 text-amber-900";
  return "border-rose-200 bg-rose-50/70 text-rose-900";
}

function dimensionLabel(level: "strong" | "partial" | "weak") {
  if (level === "strong") return "较强";
  if (level === "partial") return "待补齐";
  return "较弱";
}

function formatRate(value?: number) {
  if (typeof value !== "number") return "--";
  return `${Math.round(value * 100)}%`;
}

function formatDateTime(value?: string) {
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

export function AgentReadinessPanel({
  opsToken,
  refreshKey = 0,
}: {
  opsToken?: string | null;
  refreshKey?: number;
}) {
  const [report, setReport] = useState<AgentReadinessReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);

    (async () => {
      try {
        const result = await fetchAgentReadiness(opsToken);
        if (!cancelled) {
          setReport(result);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "运营成熟度加载失败。");
          setReport(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [opsToken, refreshKey]);

  if (error) {
    return (
      <section className="rounded-[28px] border border-rose-200/80 bg-white/95 p-5 shadow-card">
        <p className="text-sm font-semibold text-rose-900">运营成熟度面板暂不可用</p>
        <p className="mt-2 text-sm leading-relaxed text-rose-700">{error}</p>
      </section>
    );
  }

  if (!report) {
    return (
      <section className="rounded-[28px] border border-white/80 bg-white/95 p-5 shadow-card">
        <p className="text-sm font-semibold text-ink-900">正在加载运营成熟度...</p>
      </section>
    );
  }

  return (
    <section className="rounded-[32px] border border-white/80 bg-white/95 p-5 shadow-float ring-1 ring-sky-100/60 backdrop-blur-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <p className="text-[11px] font-semibold tracking-[0.22em] text-[#9f5b34]">
            Agent 运营成熟度
          </p>
          <h3 className="mt-2 text-2xl font-bold tracking-tight text-ink-900">
            从演示版走向可运营产品
          </h3>
          <p className="mt-3 text-sm leading-7 text-ink-600">{report.summary}</p>
          <p className="mt-3 text-xs text-ink-500">生成时间：{formatDateTime(report.generatedAt)}</p>
        </div>

        <div className={`min-w-[176px] rounded-[24px] border px-4 py-4 text-right ${levelTone(report.overallLevel)}`}>
          <p className="text-[11px] font-semibold tracking-[0.18em]">当前评分</p>
          <p className="mt-2 text-3xl font-bold">{report.overallPercent}/100</p>
          <p className="mt-1 text-sm font-medium">{levelLabel(report.overallLevel)}</p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <div className="rounded-[24px] border border-ink-100 bg-ink-50/70 p-4">
          <p className="text-[11px] font-semibold tracking-[0.16em] text-ink-500">运行态</p>
          <p className="mt-2 text-sm text-ink-800">
            活跃会话 {report.metrics.runtime.activeSessions} 个
          </p>
          <p className="mt-1 text-xs text-ink-500">
            已加载门店 {report.metrics.runtime.storesLoaded} 家，TTL {report.metrics.runtime.sessionTtlHours} 小时
          </p>
          <p className="mt-1 text-xs text-ink-500">
            大模型 {report.metrics.runtime.llmConfigured ? "已配置" : "本地兜底"} · 地图能力{" "}
            {report.metrics.runtime.amapEnabled ? "已启用" : "未启用"}
          </p>
        </div>

        <div className="rounded-[24px] border border-ink-100 bg-ink-50/70 p-4">
          <p className="text-[11px] font-semibold tracking-[0.16em] text-ink-500">会话质量</p>
          <p className="mt-2 text-sm text-ink-800">
            已记录对话回合 {report.metrics.conversations.total} 次
          </p>
          <p className="mt-1 text-xs text-ink-500">
            平均响应 {report.metrics.conversations.avgMs}ms · P95 {report.metrics.conversations.p95Ms}ms
          </p>
          <p className="mt-1 text-xs text-ink-500">
            平均 Agent 回合 {report.metrics.conversations.avgTurns} 次 · 结构化输出率{" "}
            {Math.round(report.metrics.conversations.structuredRate * 100)}%
          </p>
        </div>

        <div className="rounded-[24px] border border-ink-100 bg-ink-50/70 p-4">
          <p className="text-[11px] font-semibold tracking-[0.16em] text-ink-500">线索转化</p>
          <p className="mt-2 text-sm text-ink-800">
            已提交试驾线索 {report.metrics.conversion.totalLeads} 条
          </p>
          <p className="mt-1 text-xs text-ink-500">
            已推荐门店 {Math.round(report.metrics.conversion.routedLeadRate * 100)}% · 带定位线索{" "}
            {Math.round(report.metrics.conversion.geoLeadRate * 100)}%
          </p>
          <p className="mt-1 text-xs text-ink-500">
            评分完成 {formatRate(report.metrics.conversion.scoredLeadRate)} · 顾问分配{" "}
            {formatRate(report.metrics.conversion.advisorAssignedRate)} · CRM 就绪{" "}
            {formatRate(report.metrics.conversion.crmReadyRate)}
          </p>
          <p className="mt-1 text-xs text-ink-500">
            CRM 已同步 {formatRate(report.metrics.conversion.crmSyncedRate)} · Webhook{" "}
            {report.metrics.conversion.webhookEnabled ? "已连接" : "未连接"}
          </p>
        </div>
      </div>

      {report.versions ? (
        <div className="mt-5 rounded-[24px] border border-ink-100 bg-white/90 p-4">
          <p className="text-[11px] font-semibold tracking-[0.16em] text-ink-500">版本快照</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-ink-700">
            {Object.entries(report.versions).map(([key, value]) => (
              <span key={key} className="rounded-full border border-ink-200 bg-ink-50 px-3 py-1">
                {key}: {value}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {report.businessDataStatus ? (
        <div className="mt-5 rounded-[24px] border border-ink-100 bg-white/90 p-4">
          <p className="text-[11px] font-semibold tracking-[0.16em] text-ink-500">业务数据接入状态</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {Object.entries(report.businessDataStatus).map(([key, value]) => {
              const item = value as {
                count?: number;
                provider?: string;
                sourceType?: string;
                freshnessStatus?: string;
                fetchedAt?: string | null;
              };
              return (
                <div key={key} className="rounded-[20px] border border-ink-100 bg-ink-50/70 p-3">
                  <p className="text-sm font-semibold text-ink-900">{key}</p>
                  <p className="mt-2 text-sm text-ink-700">记录数 {item.count ?? 0}</p>
                  <p className="mt-1 text-xs text-ink-500">Provider {item.provider || "unknown"}</p>
                  <p className="mt-1 text-xs text-ink-500">Source {item.sourceType || "unknown"}</p>
                  <p className="mt-1 text-xs text-ink-500">状态 {item.freshnessStatus || "unknown"}</p>
                  <p className="mt-1 text-xs text-ink-500">抓取时间 {formatDateTime(item.fetchedAt || undefined)}</p>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        {report.dimensions.map((dimension) => (
          <article
            key={dimension.key}
            className="rounded-[24px] border border-ink-100/90 bg-white/90 p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold text-ink-900">{dimension.title}</h4>
                <p className="mt-1 text-xs text-ink-500">
                  得分 {dimension.score}/{dimension.maxScore}
                </p>
              </div>
              <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${dimensionTone(dimension.level)}`}>
                {dimensionLabel(dimension.level)}
              </span>
            </div>

            <div className="mt-3">
              <p className="text-[11px] font-semibold tracking-[0.14em] text-emerald-700">已有能力</p>
              <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-ink-700">
                {dimension.evidence.map((item) => (
                  <li key={item}>- {item}</li>
                ))}
              </ul>
            </div>

            <div className="mt-3">
              <p className="text-[11px] font-semibold tracking-[0.14em] text-amber-700">待补齐</p>
              <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-ink-700">
                {dimension.gaps.map((item) => (
                  <li key={item}>- {item}</li>
                ))}
              </ul>
            </div>

            <div className="mt-3">
              <p className="text-[11px] font-semibold tracking-[0.14em] text-sky-700">下一步</p>
              <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-ink-700">
                {dimension.nextSteps.map((item) => (
                  <li key={item}>- {item}</li>
                ))}
              </ul>
            </div>
          </article>
        ))}
      </div>

      <div className="mt-5 rounded-[24px] border border-sky-100 bg-sky-50/60 p-4">
        <p className="text-[11px] font-semibold tracking-[0.16em] text-sky-700">建议推进里程碑</p>
        <ol className="mt-2 space-y-2 text-sm leading-relaxed text-ink-800">
          {report.milestones.map((item, index) => (
            <li key={item}>
              {index + 1}. {item}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
