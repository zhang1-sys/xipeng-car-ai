import type { AgentPayload } from "@/lib/types";

function renderProfileTags(agent?: AgentPayload) {
  if (!agent?.profile) return [];

  const tags: string[] = [];
  const { profile } = agent;

  if (profile.budget) tags.push(`预算: ${profile.budget}`);
  if (profile.city) tags.push(`城市: ${profile.city}`);
  if (profile.charging) tags.push(`补能: ${profile.charging}`);
  if (profile.seats) tags.push(`座位: ${profile.seats}`);
  if (profile.bodyTypes?.length) tags.push(`车型: ${profile.bodyTypes.join(" / ")}`);
  if (profile.energyTypes?.length) tags.push(`能源: ${profile.energyTypes.join(" / ")}`);
  if (profile.priorities?.length) tags.push(`重点: ${profile.priorities.join(" / ")}`);
  if (profile.usage?.length) tags.push(`场景: ${profile.usage.join(" / ")}`);
  if (profile.preferredBrands?.length) tags.push(`偏好品牌: ${profile.preferredBrands.join(" / ")}`);
  if (profile.excludedBrands?.length) tags.push(`排除品牌: ${profile.excludedBrands.join(" / ")}`);

  return tags;
}

export function AgentInsightsPanel({ agent }: { agent?: AgentPayload }) {
  if (!agent) return null;

  const tags = renderProfileTags(agent);
  const blockers = agent.blockers?.length ? agent.blockers : agent.missingInfo || [];
  const confidence =
    typeof agent.confidence === "number" ? `${Math.round(agent.confidence * 100)}%` : null;

  return (
    <details className="rounded-2xl border border-ink-100/80 bg-ink-50/70 px-4 py-3 text-sm text-ink-700" open>
      <summary className="cursor-pointer list-none font-semibold text-ink-900">
        Agent 工作区
      </summary>

      <div className="mt-3 space-y-4">
        {agent.stage || confidence ? (
          <div className="flex flex-wrap gap-2">
            {agent.stage ? (
              <span className="rounded-full border border-sky-200 bg-white px-3 py-1 text-[11px] font-semibold text-sky-800">
                当前阶段：{agent.stage}
              </span>
            ) : null}
            {confidence ? (
              <span className="rounded-full border border-emerald-200 bg-white px-3 py-1 text-[11px] font-semibold text-emerald-800">
                判断把握：{confidence}
              </span>
            ) : null}
            {agent.statusLabel ? (
              <span className="rounded-full border border-violet-200 bg-white px-3 py-1 text-[11px] font-semibold text-violet-800">
                当前状态：{agent.statusLabel}
              </span>
            ) : null}
            {agent.executionMode ? (
              <span className="rounded-full border border-ink-200 bg-white px-3 py-1 text-[11px] font-semibold text-ink-700">
                执行模式：{agent.executionMode}
              </span>
            ) : null}
            {agent.responseSource ? (
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700">
                生成来源：{agent.responseSource === "llm" ? "LLM" : "Local"}
              </span>
            ) : null}
          </div>
        ) : null}

        {agent.statusReason ? (
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-violet-700">
              状态说明
            </p>
            <p className="mt-1 leading-relaxed">{agent.statusReason}</p>
          </div>
        ) : null}

        {agent.goal ? (
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-sky-700">
              当前目标
            </p>
            <p className="mt-1 leading-relaxed">{agent.goal}</p>
          </div>
        ) : null}

        {agent.memorySummary ? (
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-sky-700">
              记忆摘要
            </p>
            <p className="mt-1 leading-relaxed">{agent.memorySummary}</p>
          </div>
        ) : null}

        {agent.checklist?.length ? (
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-700">
              任务清单
            </p>
            <div className="mt-2 space-y-2">
              {agent.checklist.map((item) => (
                <div
                  key={item.label}
                  className="flex items-center justify-between gap-3 rounded-xl border border-white bg-white/90 px-3 py-2"
                >
                  <span className="text-xs leading-relaxed text-ink-800">{item.label}</span>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                      item.done
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-amber-100 text-amber-900"
                    }`}
                  >
                    {item.done ? "已完成" : "待补齐"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {blockers.length ? (
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-amber-700">
              当前阻塞项
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {blockers.map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-amber-200 bg-white px-2.5 py-1 text-[11px] text-amber-900"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {agent.nextActions?.length ? (
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-700">
              推荐下一步
            </p>
            <ol className="mt-2 space-y-2 text-xs leading-relaxed text-ink-700">
              {agent.nextActions.map((item, index) => (
                <li key={item}>
                  {index + 1}. {item}
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        {agent.toolsUsed?.length || agent.timingMs ? (
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-sky-700">
              执行遥测
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {agent.toolsUsed?.map((tool) => (
                <span
                  key={tool}
                  className="rounded-full border border-sky-200 bg-white px-2.5 py-1 text-[11px] text-ink-700"
                >
                  {tool}
                </span>
              ))}
              {agent.timingMs ? (
                <span className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[11px] text-emerald-800">
                  总耗时 {agent.timingMs.total}ms
                </span>
              ) : null}
              {agent.timingMs ? (
                <span className="rounded-full border border-amber-200 bg-white px-2.5 py-1 text-[11px] text-amber-900">
                  规划 {agent.timingMs.planning}ms / 合成 {agent.timingMs.synthesis}ms
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        {tags.length ? (
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-sky-700">
              已提取画像
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-sky-200 bg-white px-2.5 py-1 text-[11px] text-ink-700"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {agent.trace?.length ? (
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-sky-700">
              本轮动作
            </p>
            <div className="mt-2 space-y-2">
              {agent.trace.map((step, index) => (
                <div
                  key={`${step.title}-${index}`}
                  className="rounded-xl border border-white bg-white/90 px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-ink-900">{step.title}</p>
                    <span className="text-[10px] uppercase tracking-wide text-ink-400">
                      {step.type}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-ink-600">{step.detail}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </details>
  );
}
