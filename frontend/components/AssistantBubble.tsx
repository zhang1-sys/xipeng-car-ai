"use client";

import { useEffect, useState } from "react";
import type {
  ChatMessage,
  ChatMode,
  ComparisonStructured,
  ConfiguratorStructured,
  RecommendationStructured,
  ServiceStructured,
  StructuredPayload,
} from "@/lib/types";
import { CarRecommendationCard } from "@/components/CarRecommendationCard";
import { ComparisonPanel } from "@/components/ComparisonPanel";
import { ConversionBar } from "@/components/ConversionBar";
import { DirectConversionPanel } from "@/components/DirectConversionPanel";
import { MarkdownBody } from "@/components/MarkdownBody";
import { RecommendationConversionPanel } from "@/components/RecommendationConversionPanel";
import { ServicePanel } from "@/components/ServicePanel";

function isRecommendation(mode: ChatMode, payload: unknown): payload is RecommendationStructured {
  return mode === "recommendation" && !!payload && typeof payload === "object";
}

function isComparison(mode: ChatMode, payload: unknown): payload is ComparisonStructured {
  return mode === "comparison" && !!payload && typeof payload === "object";
}

function isService(mode: ChatMode, payload: unknown): payload is ServiceStructured {
  return mode === "service" && !!payload && typeof payload === "object";
}

function isConfigurator(mode: ChatMode, payload: unknown): payload is ConfiguratorStructured {
  return mode === "configurator" && !!payload && typeof payload === "object";
}

function hasComparisonContent(payload: ComparisonStructured | undefined) {
  if (!payload) return false;
  return Boolean(
    payload.dimensions?.length ||
      payload.conclusion ||
      payload.intro ||
      payload.next_steps?.length ||
      payload.decision_focus?.length
  );
}

function getFollowups(payload: StructuredPayload | undefined) {
  if (!payload || typeof payload !== "object" || !("followups" in payload)) {
    return [];
  }

  return Array.isArray(payload.followups) ? payload.followups : [];
}

function shouldRenderRecommendationCards(msg: ChatMessage, data: RecommendationStructured) {
  if (typeof msg.uiHints?.showRecommendationCards === "boolean") {
    return msg.uiHints.showRecommendationCards;
  }

  const content = [msg.content, data.final_one_liner, data.intro].filter(Boolean).join(" ");
  return Boolean(data.cars?.length) && /推荐|适合|首选|预算|说说|介绍|对比|比较|车型/.test(content);
}

function shouldRenderRecommendationConversion(msg: ChatMessage, data: RecommendationStructured) {
  if (typeof msg.uiHints?.showRecommendationConversion === "boolean") {
    return msg.uiHints.showRecommendationConversion;
  }

  return shouldRenderRecommendationCards(msg, data) && Boolean(data.cars?.length);
}

type Props = {
  msg: ChatMessage;
  onTestDrive: (carName?: string) => void;
  onAdvisorFollowup: (carName?: string) => void;
  onStores: () => void;
  onOffer: () => void;
  onFollowup: (text: string) => void;
  onConfigurator: (text?: string) => void;
};

function StreamingPanel({
  label,
  steps,
}: {
  label?: string;
  steps?: string[];
}) {
  const visibleSteps = Array.isArray(steps) ? steps.slice(-6) : [];

  return (
    <div className="overflow-hidden rounded-[24px] border border-[#f2d4c1] bg-[linear-gradient(135deg,rgba(255,249,245,0.98),rgba(255,255,255,0.98))]">
      <div className="border-b border-[#f4e1d5] px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="relative inline-flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#eb5b2a]/35" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#eb5b2a]" />
          </span>
          <div>
            <p className="text-[11px] font-bold tracking-[0.16em] text-[#b25327]">智能问答处理中</p>
            <p className="mt-1 text-sm font-semibold text-ink-900">{label || "正在整理回答"}</p>
          </div>
        </div>
      </div>

      <div className="space-y-2 px-4 py-4">
        {visibleSteps.map((item, index) => (
          <div
            key={`${item}-${index}`}
            className="rounded-2xl border border-[#f5e7de] bg-white/92 px-3 py-2 text-sm leading-6 text-ink-700"
          >
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

function ThoughtTracePanel({
  steps,
  label,
  streaming = false,
}: {
  steps?: string[];
  label?: string;
  streaming?: boolean;
}) {
  const items = Array.isArray(steps) ? steps.filter(Boolean) : [];
  const [open, setOpen] = useState(Boolean(streaming));

  useEffect(() => {
    setOpen(Boolean(streaming));
  }, [streaming, items.length]);

  if (!items.length) return null;

  return (
    <div className="overflow-hidden rounded-[24px] border border-[#ead9ca] bg-[linear-gradient(135deg,rgba(253,249,245,0.98),rgba(255,255,255,0.98))]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-[#fff7f1]"
      >
        <span className={`inline-flex h-2.5 w-2.5 rounded-full ${streaming ? "animate-pulse bg-[#eb5b2a]" : "bg-[#c88a63]"}`} />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold tracking-[0.14em] text-[#ab5a31]">思考过程</p>
          {label ? <p className="mt-1 text-sm font-semibold text-ink-900">{label}</p> : null}
        </div>
        <span className="text-xs font-semibold text-[#ab5a31]">{open ? "收起" : "展开"}</span>
      </button>

      {open ? (
        <div className="border-t border-[#f1e3d7] px-4 py-4">
          <div className="space-y-2">
            {items.map((item, index) => (
              <div
                key={`${item}-${index}`}
                className="rounded-2xl border border-[#f4e7dc] bg-white/96 px-3 py-2 text-sm leading-6 text-ink-700"
              >
                <span className="mr-2 text-[#b76438]">{String(index + 1).padStart(2, "0")}.</span>
                {item}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FollowupButtons({
  items,
  onFollowup,
}: {
  items: string[];
  onFollowup: (text: string) => void;
}) {
  if (!items.length) return null;

  return (
    <div className="rounded-[22px] border border-ink-100/80 bg-ink-50/70 p-4">
      <p className="text-[11px] font-bold tracking-[0.14em] text-ink-500">你还可以继续问</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {items.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onFollowup(item)}
            className="rounded-full border border-sky-200 bg-white px-3 py-1.5 text-xs font-medium text-ink-700 transition hover:border-sky-400 hover:text-brand-dark"
          >
            {item}
          </button>
        ))}
      </div>
    </div>
  );
}

function RecommendationSummary({
  data,
}: {
  data: RecommendationStructured;
}) {
  const summary = data.final_one_liner || data.intro;
  const decisionDrivers = Array.isArray(data.decision_drivers) ? data.decision_drivers.slice(0, 4) : [];

  if (!summary && !decisionDrivers.length) return null;

  return (
    <div className="rounded-[24px] border border-[#f3d8c6] bg-[linear-gradient(135deg,rgba(255,247,241,0.98),rgba(255,255,255,0.98))] px-5 py-5">
      {summary ? (
        <>
          <p className="text-[11px] font-bold tracking-[0.16em] text-[#b85a2d]">推荐结论</p>
          <p className="mt-3 text-[15px] font-semibold leading-7 text-ink-900">{summary}</p>
        </>
      ) : null}

      {decisionDrivers.length ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {decisionDrivers.map((item) => (
            <span
              key={item}
              className="rounded-full border border-[#f2d8c7] bg-white px-3 py-1 text-[11px] font-medium text-ink-700"
            >
              {item}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function renderPrimaryContent(
  msg: ChatMessage,
  onTestDrive: (carName?: string) => void,
  onAdvisorFollowup: (carName?: string) => void,
  onStores: () => void,
  onOffer: () => void,
  onFollowup: (text: string) => void,
  onConfigurator: (text?: string) => void
) {
  if (msg.isStreaming) {
    return (
      <ThoughtTracePanel
        label={msg.streamingLabel}
        steps={msg.traceSteps || msg.streamingSteps}
        streaming
      />
    );
  }

  const mode = msg.mode ?? "service";
  const structured = msg.structured;
  const followups = getFollowups(structured);

  if (mode === "recommendation" && isRecommendation(mode, structured) && structured.cars?.length) {
    const recommendationCars = structured.cars.map((car) => car.name).filter(Boolean);
    const showRecommendationCards = shouldRenderRecommendationCards(msg, structured);
    const showRecommendationConversion = shouldRenderRecommendationConversion(msg, structured);
    const cardCars = showRecommendationCards ? structured.cars : [];
    const conversionCars = showRecommendationConversion ? recommendationCars : [];

    return (
      <div className="space-y-5">
        <ThoughtTracePanel steps={msg.traceSteps} />
        <RecommendationSummary data={structured} />

        <div className="grid items-start gap-4 xl:grid-cols-2">
          {cardCars.map((car, index) => (
            <CarRecommendationCard
              key={`${car.brand || ""}-${car.name || index}-${index}`}
              car={car}
            />
          ))}
        </div>

        <RecommendationConversionPanel
          carNames={conversionCars}
          onTestDrive={onTestDrive}
          onConfigurator={(carName) =>
            onConfigurator(
              carName
                ? `我想继续配置 ${carName}，请直接带我进入配置器。`
                : "我想继续进入配置器，先确定适合我的车型。"
            )
          }
        />

        {structured.compare_note ? (
          <div className="rounded-[22px] border border-[#d8e6ff] bg-[#f6f9ff] px-4 py-4 text-sm leading-7 text-ink-800">
            <p className="text-[11px] font-bold tracking-[0.14em] text-[#365d99]">补充建议</p>
            <p className="mt-2">{structured.compare_note}</p>
          </div>
        ) : null}

        {structured.next_steps?.length ? (
          <div className="rounded-[22px] border border-[#dce8d8] bg-[#f6fbf4] px-4 py-4 text-sm text-[#1b4127]">
            <p className="text-[11px] font-bold tracking-[0.14em] text-[#346044]">下一步建议</p>
            <ol className="mt-3 list-decimal space-y-2 pl-5 leading-6 marker:font-semibold">
              {structured.next_steps.map((item, index) => (
                <li key={`${item}-${index}`}>{item}</li>
              ))}
            </ol>
          </div>
        ) : null}

        <FollowupButtons items={followups} onFollowup={onFollowup} />
      </div>
    );
  }

  if (mode === "comparison" && isComparison(mode, structured) && hasComparisonContent(structured)) {
    return (
      <div className="space-y-4">
        <ThoughtTracePanel steps={msg.traceSteps} />
        <ComparisonPanel data={structured} carNames={structured.carNames || msg.agent?.profile?.mentionedCars} />
        <ConversionBar
          onTestDrive={() => onTestDrive(undefined)}
          onStores={onStores}
          onOffer={onOffer}
          onConfigurator={() => onConfigurator("我想继续进入配置器，先从适合我的车型开始。")}
        />
        <FollowupButtons items={followups} onFollowup={onFollowup} />
      </div>
    );
  }

  if (
    mode === "service" &&
    isService(mode, structured) &&
    (structured.steps?.length || structured.notes?.length)
  ) {
    const showServiceConversion = msg.uiHints?.showServiceConversion === true;
    const conversionCarName = msg.uiHints?.conversionCarName;
    return (
      <div className="space-y-4">
        <ThoughtTracePanel steps={msg.traceSteps} />
        <ServicePanel data={structured} />
        {showServiceConversion ? (
          <DirectConversionPanel
            carName={conversionCarName}
            showTestDrive={msg.uiHints?.showTestDriveCard === true}
            showAdvisorFollowup={msg.uiHints?.showAdvisorFollowupCard === true}
            onTestDrive={onTestDrive}
            onAdvisorFollowup={onAdvisorFollowup}
          />
        ) : null}
        <FollowupButtons items={followups} onFollowup={onFollowup} />
      </div>
    );
  }

  if (mode === "configurator" && isConfigurator(mode, structured)) {
    return (
      <div className="space-y-4">
        <ThoughtTracePanel steps={msg.traceSteps} />
        <div className="rounded-[22px] border border-amber-200 bg-amber-50/70 px-4 py-4 text-sm leading-7 text-amber-950/90">
          <p className="text-[11px] font-bold tracking-[0.12em] text-amber-800">配置器提示</p>
          <p className="mt-2">
            配置器已经滚动到页面下方的独立区域。你可以继续完成车型、版本、车色、内饰和套件选择。
          </p>
        </div>
        <FollowupButtons items={followups} onFollowup={onFollowup} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ThoughtTracePanel steps={msg.traceSteps} />
      <MarkdownBody content={msg.content} />
    </div>
  );
}

export function AssistantBubble({
  msg,
  onTestDrive,
  onAdvisorFollowup,
  onStores,
  onOffer,
  onFollowup,
  onConfigurator,
}: Props) {
  return (
    <div className="space-y-4">
      {renderPrimaryContent(
        msg,
        onTestDrive,
        onAdvisorFollowup,
        onStores,
        onOffer,
        onFollowup,
        onConfigurator
      )}
    </div>
  );
}
