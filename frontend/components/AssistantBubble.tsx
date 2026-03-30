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
import { MarkdownBody } from "@/components/MarkdownBody";
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

function getFollowups(payload: StructuredPayload | undefined) {
  if (!payload || typeof payload !== "object" || !("followups" in payload)) {
    return [];
  }

  return Array.isArray(payload.followups) ? payload.followups : [];
}

type Props = {
  msg: ChatMessage;
  onTestDrive: (carName?: string) => void;
  onStores: () => void;
  onOffer: () => void;
  onFollowup: (text: string) => void;
};

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

function renderPrimaryContent(
  msg: ChatMessage,
  onTestDrive: (carName?: string) => void,
  onStores: () => void,
  onOffer: () => void,
  onFollowup: (text: string) => void
) {
  const mode = msg.mode ?? "service";
  const structured = msg.structured;
  const followups = getFollowups(structured);

  if (mode === "recommendation" && isRecommendation(mode, structured) && structured.cars?.length) {
    return (
      <div className="space-y-4">
        {structured.intro ? <p className="text-sm leading-7 text-ink-700">{structured.intro}</p> : null}

        {structured.persona_summary ? (
          <div className="rounded-[22px] border border-ink-100 bg-ink-50/70 px-4 py-4 text-sm leading-7 text-ink-800">
            <p className="text-[11px] font-bold tracking-[0.14em] text-ink-500">我理解你的需求是</p>
            <p className="mt-2">{structured.persona_summary}</p>
          </div>
        ) : null}

        {structured.decision_drivers?.length ? (
          <div className="rounded-[22px] border border-sky-100 bg-sky-50/60 px-4 py-4">
            <p className="text-[11px] font-bold tracking-[0.14em] text-sky-700">推荐依据</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {structured.decision_drivers.map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-sky-200 bg-white px-2.5 py-1 text-[11px] text-ink-700"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          {structured.cars.map((car, index) => (
            <div key={`${car.brand || ""}-${car.name || index}-${index}`} className="space-y-4">
              <CarRecommendationCard car={car} />
              <ConversionBar
                carName={car.name}
                onTestDrive={() => onTestDrive(car.name)}
                onStores={onStores}
                onOffer={onOffer}
              />
            </div>
          ))}
        </div>

        {structured.compare_note ? (
          <div className="rounded-[22px] border border-violet-100 bg-violet-50/50 px-4 py-4 text-sm leading-7 text-ink-800">
            <p className="text-[11px] font-bold tracking-[0.12em] text-violet-700">补充建议</p>
            <p className="mt-2">{structured.compare_note}</p>
          </div>
        ) : null}

        {structured.missing_info?.length ? (
          <div className="rounded-[22px] border border-amber-200 bg-amber-50/70 px-4 py-4 text-sm text-amber-950/90">
            <p className="text-[11px] font-bold tracking-[0.12em] text-amber-800">还缺哪些信息</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {structured.missing_info.map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-amber-200 bg-white px-2.5 py-1 text-[11px]"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {structured.next_steps?.length ? (
          <div className="rounded-[22px] border border-emerald-200 bg-emerald-50/80 px-4 py-4 text-sm text-emerald-950/90">
            <p className="text-[11px] font-bold tracking-[0.12em] text-emerald-800">建议下一步</p>
            <ol className="mt-3 space-y-2 leading-6">
              {structured.next_steps.map((item, index) => (
                <li key={item}>
                  {index + 1}. {item}
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        {structured.final_one_liner ? (
          <div className="rounded-[22px] border border-sky-200 bg-gradient-to-br from-sky-50 to-indigo-50/40 px-4 py-4">
            <p className="text-[11px] font-bold tracking-[0.12em] text-brand-dark">一句话结论</p>
            <p className="mt-2 text-sm font-semibold leading-7 text-ink-900">
              {structured.final_one_liner}
            </p>
          </div>
        ) : null}

        <FollowupButtons items={followups} onFollowup={onFollowup} />
      </div>
    );
  }

  if (mode === "comparison" && isComparison(mode, structured)) {
    return (
      <div className="space-y-4">
        <ComparisonPanel data={structured} />
        <ConversionBar
          onTestDrive={() => onTestDrive(undefined)}
          onStores={onStores}
          onOffer={onOffer}
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
    return (
      <div className="space-y-4">
        <ServicePanel data={structured} />
        <ConversionBar
          onTestDrive={() => onTestDrive(undefined)}
          onStores={onStores}
          onOffer={onOffer}
        />
        <FollowupButtons items={followups} onFollowup={onFollowup} />
      </div>
    );
  }

  if (mode === "configurator" && isConfigurator(mode, structured)) {
    return (
      <div className="space-y-4">
        <div className="rounded-[22px] border border-amber-200 bg-amber-50/70 px-4 py-4 text-sm leading-7 text-amber-950/90">
          <p className="text-[11px] font-bold tracking-[0.12em] text-amber-800">配置器提示</p>
          <p className="mt-2">配置器已移动到页面上方的独立区域。你可以直接点击完成车型/版本/颜色/内饰/套件选择。</p>
        </div>
        <FollowupButtons items={followups} onFollowup={onFollowup} />
      </div>
    );
  }

  return <MarkdownBody content={msg.content} />;
}

export function AssistantBubble({ msg, onTestDrive, onStores, onOffer, onFollowup }: Props) {
  return (
    <div className="space-y-4">
      {renderPrimaryContent(msg, onTestDrive, onStores, onOffer, onFollowup)}
    </div>
  );
}
