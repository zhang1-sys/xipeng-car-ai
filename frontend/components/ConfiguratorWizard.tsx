"use client";

import { useMemo } from "react";
import type {
  AgentPayload,
  ConfiguratorChoicesPayload,
  ConfiguratorStructured,
} from "@/lib/types";

/* ─── Constants ──────────────────────────────────────────── */

const STEPS = ["车型", "版本", "外观颜色", "内饰", "套件", "配置摘要"] as const;
type StepKey = (typeof STEPS)[number];

const CAR_IMAGES: Record<string, string> = {
  G6: "/cars/g6.svg",
  G9: "/cars/g9.svg",
  P7i: "/cars/p7i.svg",
  "MONA M03": "/cars/mona-m03.svg",
  X9: "/cars/x9.svg",
};

const COLOR_HEX: Record<string, string> = {
  星云白: "#f0f0f0", 云母白: "#eeeee8", 星暮白: "#e8e4de", 月光白: "#f5f5f0",
  新月银: "#b8bcc2", 星云灰: "#8a8d92",
  暗夜黑: "#1a1a1e",
  星际绿: "#2d4a3e", 深海蓝: "#1e3a5f", 天青蓝: "#4a8bad",
};

const INTERIOR_HEX: Record<string, string> = {
  深空黑内饰: "#1c1c20", 曜石黑内饰: "#1a1a1e",
  气宇灰内饰: "#6a6d72", 月影灰内饰: "#5a5d62", 月影咖内饰: "#5c4a3a",
  暖阳棕内饰: "#7a5a3e", 轻雾灰内饰: "#9a9da2",
};

const STEP_BACK_ACTIONS: Record<Exclude<StepKey, "配置摘要">, string> = {
  车型: "我想换一款车型",
  版本: "我想换一个版本",
  外观颜色: "我想换外观颜色",
  内饰: "我想换内饰颜色",
  套件: "我想重新选择套件",
};

type Props = {
  state: ConfiguratorStructured | null;
  agent: AgentPayload | null;
  choices: ConfiguratorChoicesPayload | null;
  busy: boolean;
  onAction: (text: string) => void;
  onReset: () => void;
};

/* ─── Helpers ────────────────────────────────────────────── */

function getSelectedPackages(state: ConfiguratorStructured | null) {
  const packs = state?.packages || state?.selectedPackages || [];
  return Array.isArray(packs) ? packs : [];
}

function buildStepStatus(state: ConfiguratorStructured | null) {
  const model = state?.model || state?.selectedModel || null;
  const variant = state?.variant || state?.selectedVariant || null;
  const color = state?.exteriorColor || state?.selectedColor || null;
  const interior = state?.interiorColor || state?.selectedInterior || null;
  const packages = getSelectedPackages(state);
  const done = Boolean(state?.done || state?.summary_text);
  const current: StepKey = (() => {
    if (done) return "配置摘要";
    if (!model) return "车型";
    if (!variant) return "版本";
    if (!color) return "外观颜色";
    if (!interior) return "内饰";
    if (!packages.length) return "套件";
    return "配置摘要";
  })();
  return { model, variant, color, interior, packages, done, current };
}

function formatPremium(premium?: number) {
  if (!premium) return "标配";
  return `+${premium.toFixed(2)} 万`;
}

function formatPrice(price?: number | null) {
  if (typeof price !== "number" || Number.isNaN(price)) return "待确认";
  return `${price.toFixed(2)} 万`;
}

function resolveCarImage(model: string | null): string {
  if (!model) return "/cars/g6.svg";
  for (const [key, src] of Object.entries(CAR_IMAGES)) {
    if (model.includes(key)) return src;
  }
  return "/cars/g6.svg";
}

/* ─── Sub-components ─────────────────────────────────────── */

function StepNav({
  current,
  selected,
  busy,
  onAction,
}: {
  current: StepKey;
  selected: ReturnType<typeof buildStepStatus>;
  busy: boolean;
  onAction: (text: string) => void;
}) {
  const currentIndex = STEPS.indexOf(current);
  const pills = STEPS.map((key, i) => {
    const isDone =
      (key === "车型" && Boolean(selected.model)) ||
      (key === "版本" && Boolean(selected.variant)) ||
      (key === "外观颜色" && Boolean(selected.color)) ||
      (key === "内饰" && Boolean(selected.interior)) ||
      (key === "套件" && (Boolean(selected.packages.length) || selected.done)) ||
      (key === "配置摘要" && selected.done);
    const isActive = key === current;
    const isClickable = i < currentIndex && key !== "配置摘要" && !busy;
    const action = key !== "配置摘要" ? STEP_BACK_ACTIONS[key as Exclude<StepKey, "配置摘要">] : null;
    return { key, isDone, isActive, isClickable, action, index: i };
  });

  return (
    <div className="cfg-glass-highlight flex items-center gap-1 rounded-full px-1.5 py-1.5 sm:gap-2 sm:px-3">
      {pills.map((p, i) => (
        <button
          key={p.key}
          type="button"
          disabled={!p.isClickable}
          onClick={() => p.isClickable && p.action && onAction(p.action)}
          className={[
            "relative rounded-full px-2.5 py-1.5 text-[10px] font-semibold tracking-wide transition-all duration-300 sm:px-3 sm:text-[11px]",
            p.isActive ? "cfg-step-active" : "",
            p.isDone && !p.isActive ? "cfg-step-done" : "",
            !p.isDone && !p.isActive ? "border border-transparent text-white/30" : "",
            p.isClickable ? "cursor-pointer hover:text-white/80" : "cursor-default",
          ].join(" ")}
        >
          <span className="flex items-center gap-1.5">
            {p.isDone && !p.isActive ? (
              <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none"><path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            ) : (
              <span className="text-[9px] tabular-nums opacity-60">{String(i + 1).padStart(2, "0")}</span>
            )}
            <span className="hidden sm:inline">{p.key}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function CarHero({ model, busy }: { model: string | null; busy: boolean }) {
  const src = resolveCarImage(model);
  const label = model || "选择车型";
  return (
    <div className="relative mx-auto flex w-full max-w-lg flex-col items-center py-6">
      <div className="cfg-hero-glow" />
      <img
        src={src}
        alt={label}
        className={`cfg-hero-image relative z-10 h-auto w-full max-w-md select-none ${busy ? "opacity-60" : ""}`}
        draggable={false}
      />
      <p className="mt-3 text-center text-xs font-medium tracking-[0.3em] text-white/25 uppercase">
        {label}
      </p>
    </div>
  );
}

function ChoiceGrid({
  step,
  choices,
  selected,
  busy,
  onAction,
}: {
  step: StepKey;
  choices: ConfiguratorChoicesPayload | null;
  selected: ReturnType<typeof buildStepStatus>;
  busy: boolean;
  onAction: (text: string) => void;
}) {
  if (!choices) {
    return (
      <div className="cfg-glass rounded-2xl px-5 py-6 text-center">
        <div className="ai-shimmer mx-auto h-3 w-40 rounded-full" />
        <p className="mt-3 text-xs text-white/30">正在加载可选项…</p>
      </div>
    );
  }

  if (step === "车型") {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {choices.models.map((item) => {
          const isSelected = selected.model === item.name;
          const imgSrc = resolveCarImage(item.name);
          return (
            <button
              key={item.key}
              type="button"
              disabled={busy}
              onClick={() => onAction(`我想配置 ${item.name}`)}
              className={`cfg-card group rounded-2xl px-4 pb-4 pt-3 text-left disabled:cursor-not-allowed disabled:opacity-40 ${isSelected ? "cfg-card-selected" : ""}`}
            >
              <div className="mb-3 flex items-center justify-between">
                <img src={imgSrc} alt={item.name} className="h-16 w-auto opacity-70 transition group-hover:opacity-100" draggable={false} />
                <span className="rounded-full bg-white/5 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-[#ff8c5a]">
                  {formatPrice(item.basePrice)} 起
                </span>
              </div>
              <p className="text-sm font-semibold text-white/90">{item.name}</p>
              <p className="mt-1 text-xs leading-relaxed text-white/40">
                {item.highlight || "公开快照配置器"}
              </p>
            </button>
          );
        })}
      </div>
    );
  }

  if (step === "版本") {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {choices.variants.map((item) => {
          const isSelected = selected.variant === item.name;
          return (
            <button
              key={item.name}
              type="button"
              disabled={busy}
              onClick={() => onAction(`选 ${item.name}`)}
              className={`cfg-card rounded-2xl px-4 py-4 text-left disabled:cursor-not-allowed disabled:opacity-40 ${isSelected ? "cfg-card-selected" : ""}`}
            >
              <p className="text-sm font-semibold text-white/90">{item.name}</p>
              <p className="mt-2 text-lg font-bold tabular-nums text-[#ff8c5a]">{formatPrice(item.price)}</p>
              {item.highlight ? (
                <p className="mt-2 text-xs leading-relaxed text-white/35">{item.highlight}</p>
              ) : null}
            </button>
          );
        })}
      </div>
    );
  }

  if (step === "外观颜色") {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          {choices.colors.map((item) => {
            const isSelected = selected.color === item.name;
            const hex = COLOR_HEX[item.name] || "#666";
            return (
              <button
                key={item.name}
                type="button"
                disabled={busy}
                onClick={() => onAction(`外观选 ${item.name}`)}
                className="group flex flex-col items-center gap-2 disabled:cursor-not-allowed disabled:opacity-40"
                title={item.name}
              >
                <div
                  className={`cfg-color-swatch ${isSelected ? "cfg-color-swatch-active" : ""}`}
                  style={{ background: hex }}
                />
                <span className={`text-[10px] font-medium transition ${isSelected ? "text-[#ff8c5a]" : "text-white/35 group-hover:text-white/60"}`}>
                  {item.name}
                </span>
                {item.premium ? (
                  <span className="text-[9px] tabular-nums text-white/20">{formatPremium(item.premium)}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (step === "内饰") {
    return (
      <div className="flex flex-wrap items-start gap-4">
        {choices.interiors.map((item) => {
          const isSelected = selected.interior === item.name;
          const hex = INTERIOR_HEX[item.name] || "#444";
          return (
            <button
              key={item.name}
              type="button"
              disabled={busy}
              onClick={() => onAction(`内饰选 ${item.name}`)}
              className="group flex flex-col items-center gap-2 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <div
                className={`cfg-color-swatch h-10 w-10 ${isSelected ? "cfg-color-swatch-active" : ""}`}
                style={{ background: `linear-gradient(135deg, ${hex}, ${hex}dd)` }}
              />
              <span className={`text-[10px] font-medium transition ${isSelected ? "text-[#ff8c5a]" : "text-white/35 group-hover:text-white/60"}`}>
                {item.name.replace("内饰", "")}
              </span>
              {item.premium ? (
                <span className="text-[9px] tabular-nums text-white/20">{formatPremium(item.premium)}</span>
              ) : null}
            </button>
          );
        })}
      </div>
    );
  }

  if (step === "套件") {
    const selectedPacks = new Set(selected.packages);
    return (
      <div className="space-y-3">
        {choices.packages.map((item) => {
          const isSelected = selectedPacks.has(item.name);
          return (
            <button
              key={item.name}
              type="button"
              disabled={busy}
              onClick={() => onAction(isSelected ? `不要 ${item.name}` : `加上 ${item.name}`)}
              className={`cfg-card w-full rounded-2xl px-4 py-4 text-left disabled:cursor-not-allowed disabled:opacity-40 ${isSelected ? "cfg-card-selected" : ""}`}
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-white/90">{item.name}</p>
                <span className="rounded-full bg-white/5 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-[#ff8c5a]">
                  {formatPrice(item.price)}
                </span>
              </div>
              {item.desc ? (
                <p className="mt-2 text-xs leading-relaxed text-white/35">{item.desc}</p>
              ) : null}
              {isSelected ? (
                <p className="mt-2 flex items-center gap-1 text-[10px] font-medium text-emerald-400">
                  <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none"><path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  已选择 · 再点一次移除
                </p>
              ) : null}
            </button>
          );
        })}
        <button
          type="button"
          disabled={busy}
          onClick={() => onAction("先不加装，直接出配置单")}
          className="rounded-full border border-white/10 px-4 py-2 text-xs font-medium text-white/40 transition hover:border-white/20 hover:text-white/60 disabled:cursor-not-allowed disabled:opacity-40"
        >
          先不加装，直接出配置单
        </button>
      </div>
    );
  }

  return null;
}

function SummaryPanel({ state }: { state: ConfiguratorStructured | null }) {
  const sel = buildStepStatus(state);
  return (
    <div className="cfg-animate-in space-y-5">
      {/* Snapshot notice */}
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-[11px] leading-relaxed text-amber-200/70">
        <p className="font-semibold text-amber-300/80">公开数据快照</p>
        <p className="mt-1">本配置器读取公开网页抓取的本地 snapshot JSON，不连接内部系统。</p>
        {state?.sourceUrl ? <p className="mt-1 break-all opacity-60">{state.sourceUrl}</p> : null}
      </div>

      {/* Config summary card */}
      <div className="cfg-glass-highlight rounded-2xl px-5 py-5">
        <p className="text-[10px] font-bold tracking-[0.2em] text-white/30 uppercase">配置清单</p>
        <div className="mt-4 space-y-3">
          {[
            { label: "车型", value: sel.model },
            { label: "版本", value: sel.variant },
            { label: "外观", value: sel.color },
            { label: "内饰", value: sel.interior },
          ].map((row) =>
            row.value ? (
              <div key={row.label} className="flex items-center justify-between">
                <span className="text-[10px] font-semibold tracking-wider text-white/25">{row.label}</span>
                <span className="text-sm font-semibold text-white/80">{row.value}</span>
              </div>
            ) : null
          )}
          {sel.packages.length ? (
            <div>
              <span className="text-[10px] font-semibold tracking-wider text-white/25">套件</span>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {sel.packages.map((p) => (
                  <span key={p} className="rounded-full border border-sky-400/20 bg-sky-400/5 px-2.5 py-1 text-[10px] font-medium text-sky-300/80">
                    {p}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold tracking-wider text-white/25">套件</span>
              <span className="text-sm text-white/40">暂未加装</span>
            </div>
          )}
        </div>

        {/* Price */}
        {state?.estimatedPrice ? (
          <div className="mt-5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-4">
            <p className="text-[10px] font-bold tracking-[0.15em] text-emerald-400/60 uppercase">预估价格</p>
            <p className="cfg-price-badge mt-2 text-2xl font-bold tabular-nums text-emerald-300">{state.estimatedPrice}</p>
            {state.estimatedPriceNote ? (
              <p className="mt-2 text-[11px] leading-relaxed text-emerald-300/40">{state.estimatedPriceNote}</p>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Text summary */}
      {state?.summary_text ? (
        <div className="cfg-glass rounded-2xl px-5 py-4">
          <p className="text-[10px] font-bold tracking-[0.2em] text-white/25 uppercase">配置单（可复制）</p>
          <p className="mt-3 whitespace-pre-line text-sm leading-7 text-white/60">{state.summary_text}</p>
        </div>
      ) : null}
    </div>
  );
}

/* ─── Progress sidebar ───────────────────────────────────── */

function ProgressSidebar({
  selected,
  state,
}: {
  selected: ReturnType<typeof buildStepStatus>;
  state: ConfiguratorStructured | null;
}) {
  return (
    <div className="cfg-glass rounded-2xl px-5 py-5">
      <p className="text-[10px] font-bold tracking-[0.2em] text-white/25 uppercase">配置进度</p>
      <div className="mt-4 space-y-3 text-sm">
        {[
          { label: "车型", value: selected.model },
          { label: "版本", value: selected.variant },
          { label: "外观", value: selected.color },
          { label: "内饰", value: selected.interior },
        ].map((row) =>
          row.value ? (
            <div key={row.label} className="flex items-center justify-between">
              <span className="text-[10px] font-semibold tracking-wider text-white/20">{row.label}</span>
              <span className="font-medium text-white/70">{row.value}</span>
            </div>
          ) : null
        )}
        {selected.packages.length ? (
          <div>
            <span className="text-[10px] font-semibold tracking-wider text-white/20">套件</span>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {selected.packages.map((p) => (
                <span key={p} className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/50">
                  {p}
                </span>
              ))}
            </div>
          </div>
        ) : null}
        {state?.estimatedPrice ? (
          <div className="rounded-xl border border-emerald-500/15 bg-emerald-500/5 px-3 py-3 text-center">
            <p className="text-[9px] font-bold tracking-wider text-emerald-400/50 uppercase">预估价格</p>
            <p className="mt-1 text-lg font-bold tabular-nums text-emerald-300/90">{state.estimatedPrice}</p>
          </div>
        ) : null}
        {!state ? (
          <p className="text-xs leading-relaxed text-white/25">从上方选择车型开始配置</p>
        ) : null}
      </div>
    </div>
  );
}

/* ─── Main Component ─────────────────────────────────────── */

export function ConfiguratorWizard({ state, agent, choices, busy, onAction, onReset }: Props) {
  const selected = buildStepStatus(state);
  const currentIndex = STEPS.indexOf(selected.current);
  const canGoBack = currentIndex > 0;
  const previousStep = canGoBack ? STEPS[currentIndex - 1] : null;
  const backAction = previousStep && previousStep !== "配置摘要" ? STEP_BACK_ACTIONS[previousStep] : null;

  const progressPercent = useMemo(() => {
    if (selected.done) return 100;
    const filled = [selected.model, selected.variant, selected.color, selected.interior].filter(Boolean).length;
    const hasPkg = selected.packages.length > 0;
    return Math.round(((filled + (hasPkg ? 1 : 0)) / 5) * 100);
  }, [selected]);

  const stepLabel = selected.done ? "配置完成" : `${selected.current}`;

  return (
    <section className="cfg-scene overflow-hidden rounded-[28px]">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-bold tracking-[0.3em] text-[#eb5b2a]/50 uppercase">configurator</span>
          <span className="text-[10px] text-white/15">·</span>
          <span className="text-xs font-medium text-white/50">{stepLabel}</span>
        </div>
        <div className="flex items-center gap-2">
          {state ? (
            <button
              type="button"
              disabled={busy}
              onClick={onReset}
              className="rounded-full border border-white/8 px-3.5 py-1.5 text-[11px] font-medium text-white/30 transition hover:border-white/15 hover:text-white/50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              重新开始
            </button>
          ) : null}
        </div>
      </div>

      {/* ── Step nav + progress bar ────────────────────────── */}
      <div className="px-5 sm:px-6">
        <StepNav current={selected.current} selected={selected} busy={busy} onAction={onAction} />
        {/* Progress bar */}
        <div className="mt-3 h-[2px] overflow-hidden rounded-full bg-white/5">
          <div className="cfg-progress-bar h-full rounded-full" style={{ width: `${progressPercent}%` }} />
        </div>
      </div>

      {/* ── Car hero + content ─────────────────────────────── */}
      <div className="grid gap-5 px-5 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-5">
          {/* Car image hero */}
          <CarHero model={selected.model} busy={busy} />

          {/* Choice area or summary */}
          <div className="cfg-animate-in" key={selected.current}>
            <p className="mb-3 text-[10px] font-bold tracking-[0.2em] text-white/20 uppercase">
              {selected.done ? "配置摘要" : `选择${selected.current}`}
            </p>
            {selected.done ? (
              <SummaryPanel state={state} />
            ) : (
              <ChoiceGrid
                step={selected.current}
                choices={choices}
                selected={selected}
                busy={busy}
                onAction={onAction}
              />
            )}
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-2">
            {backAction ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => onAction(backAction)}
                className="rounded-full border border-white/8 px-4 py-2 text-xs font-medium text-white/35 transition hover:border-white/15 hover:text-white/55 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span className="mr-1 inline-block opacity-50">←</span> 上一步
              </button>
            ) : null}

            {selected.current === "套件" ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => onAction("生成配置单")}
                className="rounded-full bg-gradient-to-r from-[#eb5b2a] to-[#ff7a32] px-5 py-2 text-xs font-semibold text-white shadow-[0_0_20px_-4px_rgba(235,91,42,0.4)] transition hover:shadow-[0_0_30px_-4px_rgba(235,91,42,0.6)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                生成配置单
              </button>
            ) : null}

            {selected.done ? (
              <div className="rounded-xl border border-sky-400/15 bg-sky-400/5 px-4 py-3 text-xs leading-relaxed text-sky-200/50">
                配置已完成 — 可以继续进入推荐/对比，或点击页面试驾/门店推进转化。
              </div>
            ) : null}

            {agent?.nextActions?.length && !selected.done ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {agent.nextActions.slice(0, 3).map((item) => (
                  <button
                    key={item}
                    type="button"
                    disabled={busy}
                    onClick={() => onAction(item)}
                    className="rounded-full border border-[#eb5b2a]/20 bg-[#eb5b2a]/5 px-3 py-1.5 text-[10px] font-medium text-[#ff8c5a]/70 transition hover:bg-[#eb5b2a]/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {item}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        {/* ── Sidebar ────────────────────────────────────────── */}
        <aside className="hidden space-y-4 lg:block">
          <ProgressSidebar selected={selected} state={state} />
          {selected.done ? (
            <div className="cfg-glass rounded-2xl px-5 py-4 text-xs leading-relaxed text-sky-200/40">
              <p className="text-[10px] font-bold tracking-[0.15em] text-sky-400/40 uppercase">下一步</p>
              <p className="mt-2">回到推荐或对比区域，也可以直接预约试驾。</p>
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
