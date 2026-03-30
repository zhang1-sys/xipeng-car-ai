import type { AgentPayload } from "@/lib/types";

const STAGES = [
  { code: "discover", label: "需求澄清" },
  { code: "recommend", label: "候选筛选" },
  { code: "compare", label: "车型决策" },
  { code: "configure", label: "配置方案" },
  { code: "convert", label: "试驾转化" },
  { code: "service", label: "车主服务" },
  { code: "handoff", label: "人工升级" },
] as const;

const STAGE_LABEL_TO_CODE = Object.fromEntries(STAGES.map((item) => [item.label, item.code]));

function stageIndex(agent?: AgentPayload) {
  const stageCode =
    agent?.stageCode || STAGE_LABEL_TO_CODE[String(agent?.stage || "") as keyof typeof STAGE_LABEL_TO_CODE];
  const index = STAGES.findIndex((item) => item.code === stageCode);
  return index === -1 ? 0 : index;
}

export function JourneyControlPanel({
  agent,
  onAsk,
  onTestDrive,
  onStores,
}: {
  agent?: AgentPayload;
  onAsk: (text: string) => void;
  onTestDrive: () => void;
  onStores: () => void;
}) {
  if (!agent) return null;

  const currentIndex = stageIndex(agent);
  const blockers = agent.blockers?.length ? agent.blockers : agent.missingInfo || [];

  return (
    <section className="animate-fade-up space-y-4 rounded-3xl border border-white/80 bg-white/95 p-5 shadow-card ring-1 ring-sky-100/50 backdrop-blur-sm dark:border-slate-700/80 dark:bg-slate-900/90 dark:ring-slate-700/50 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-sky-700 dark:text-sky-400">
            Agent Mission
          </p>
          <h2 className="mt-2 text-lg font-bold tracking-tight text-ink-900 dark:text-slate-100">
            {agent.goal || "持续推进你的购车与服务任务"}
          </h2>
          {agent.memorySummary ? (
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-600 dark:text-slate-400">
              当前理解：{agent.memorySummary}
            </p>
          ) : null}
          {agent.statusReason ? (
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-violet-700 dark:text-violet-300">
              {agent.statusReason}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          {agent.stage ? (
            <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-semibold text-sky-800 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-200">
              阶段：{agent.stage}
            </span>
          ) : null}
          {typeof agent.confidence === "number" ? (
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
              把握度：{Math.round(agent.confidence * 100)}%
            </span>
          ) : null}
          {agent.statusLabel ? (
            <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-[11px] font-semibold text-violet-800 dark:border-violet-800 dark:bg-violet-950/30 dark:text-violet-200">
              状态：{agent.statusLabel}
            </span>
          ) : null}
          {agent.executionMode ? (
            <span className="rounded-full border border-ink-200 bg-white px-3 py-1 text-[11px] font-semibold text-ink-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
              {agent.executionMode}
            </span>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-7">
        {STAGES.map((stage, index) => {
          const state =
            index < currentIndex ? "done" : index === currentIndex ? "current" : "pending";

          return (
            <div
              key={stage.code}
              className={`rounded-2xl border px-4 py-3 transition ${
                state === "current"
                  ? "border-sky-300 bg-sky-50/70"
                  : state === "done"
                    ? "border-emerald-200 bg-emerald-50/70"
                    : "border-ink-100 bg-ink-50/60"
              } dark:border-slate-700 dark:bg-slate-800/50`}
            >
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-ink-400 dark:text-slate-500">
                {state === "done" ? "done" : state === "current" ? "now" : "next"}
              </p>
              <p className="mt-1 text-sm font-semibold text-ink-900 dark:text-slate-100">
                {stage.label}
              </p>
            </div>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-emerald-200/80 bg-emerald-50/70 px-4 py-4 dark:border-emerald-800/50 dark:bg-emerald-950/20">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-800 dark:text-emerald-300">
            任务清单
          </p>
          {agent.checklist?.length ? (
            <div className="mt-3 space-y-2">
              {agent.checklist.map((item) => (
                <div
                  key={item.label}
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/70 bg-white/80 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/60"
                >
                  <span className="text-sm text-emerald-950/90 dark:text-emerald-100/90">
                    {item.label}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                      item.done
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
                        : "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
                    }`}
                  >
                    {item.done ? "已完成" : "待补齐"}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm leading-relaxed text-emerald-950/90 dark:text-emerald-100/90">
              当前还没有可展示的执行清单。
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-ink-100 bg-ink-50/70 px-4 py-4 dark:border-slate-700 dark:bg-slate-800/50">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-500 dark:text-slate-400">
            推荐下一步
          </p>
          {agent.nextActions?.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {agent.nextActions.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => onAsk(item)}
                  className="rounded-full border border-sky-200 bg-white px-3 py-1.5 text-xs font-medium text-ink-700 transition hover:border-sky-400 hover:text-brand-dark dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
                >
                  {item}
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-ink-500 dark:text-slate-400">
              暂无明确下一步动作，继续补充需求即可。
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-amber-200/80 bg-amber-50/70 px-4 py-4 dark:border-amber-800/50 dark:bg-amber-950/20">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-amber-800 dark:text-amber-300">
            当前阻塞项
          </p>
          {blockers.length ? (
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-amber-950/90 dark:text-amber-100/90">
              {blockers.map((item) => (
                <li key={item}>- {item}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm leading-relaxed text-amber-950/90 dark:text-amber-100/90">
              当前关键信息已经比较完整，可以直接推进到对比、试驾或门店动作。
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onTestDrive}
              className="rounded-xl bg-gradient-to-r from-sky-600 to-indigo-600 px-4 py-2 text-sm font-semibold text-white"
            >
              推进试驾
            </button>
            <button
              type="button"
              onClick={onStores}
              className="rounded-xl border border-ink-200 bg-white px-4 py-2 text-sm font-semibold text-ink-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            >
              查看门店
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
