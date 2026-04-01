"use client";

import type { ChatMode } from "@/lib/types";

type QuickTopic = {
  label: string;
  hint: string;
  q: string;
  mode: Exclude<ChatMode, "configurator">;
};

type Props = {
  hasMessages: boolean;
  busy?: boolean;
  onNewChat: () => void;
  onConfigurator: () => void;
  onQuickAsk: (text: string, mode: Exclude<ChatMode, "configurator">) => void;
};

const QUICK_TOPICS: QuickTopic[] = [
  {
    label: "开始推荐",
    hint: "预算、城市和通勤场景下的推荐",
    q: "预算 20 万左右，主要在城市通勤，周末偶尔带家人出游，帮我推荐 2 到 3 款值得重点试驾的小鹏车型。",
    mode: "recommendation",
  },
  {
    label: "做车型对比",
    hint: "对比 G6 和 G9 的空间、智能和续航",
    q: "请从空间、智能化、续航、舒适性和实际使用成本几个维度，对比小鹏 G6 和小鹏 G9。",
    mode: "comparison",
  },
  {
    label: "问用车服务",
    hint: "第一次买纯电车的日常使用问题",
    q: "第一次买纯电车，想知道日常补能、保养和冬季续航要注意什么。",
    mode: "service",
  },
];

export function ChatHeader({
  hasMessages,
  busy = false,
  onNewChat,
  onConfigurator,
  onQuickAsk,
}: Props) {
  return (
    <header className="sticky top-0 z-30 border-b border-white/70 bg-[rgba(255,250,244,0.88)] backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[18px] bg-[linear-gradient(135deg,#eb5b2a,#ff9558)] text-sm font-bold tracking-[0.18em] text-white shadow-[0_18px_36px_-18px_rgba(235,91,42,0.85)]">
              XP
            </div>
            <div>
              <p className="text-[11px] font-semibold tracking-[0.28em] text-[#ba5a2d]">小鹏购车助手</p>
              <p className="mt-1 text-sm text-ink-700">车型推荐、对比和配置都可以从这里开始。</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onConfigurator}
              className="rounded-full bg-gradient-to-r from-[#eb5b2a] to-[#ff7b36] px-4 py-2 text-sm font-semibold text-white shadow-[0_16px_30px_-16px_rgba(235,91,42,0.9)] transition hover:from-[#d84e1f] hover:to-[#f16a26]"
            >
              进入配置器
            </button>
            {hasMessages ? (
              <button
                type="button"
                onClick={onNewChat}
                className="rounded-full border border-[#d8dee6] bg-white px-4 py-2 text-sm font-semibold text-ink-600 transition hover:bg-ink-50"
              >
                重新开始
              </button>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {QUICK_TOPICS.map((topic) => (
            <button
              key={topic.label}
              type="button"
              title={topic.hint}
              disabled={busy}
              onClick={() => onQuickAsk(topic.q, topic.mode)}
              className="rounded-full border border-[#e7ddd3] bg-white/95 px-3 py-1.5 text-xs font-medium text-ink-700 transition hover:border-[#eb5b2a] hover:bg-[#fff7f1] hover:text-[#b84d24] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {topic.label}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}
