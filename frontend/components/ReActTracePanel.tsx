"use client";
import { useEffect, useRef, useState } from "react";

interface TraceStep {
  type: string;
  thought?: string;
  action?: string;
  result?: string;
  error?: string;
  turn?: number;
}

const ACTION_LABELS: Record<string, string> = {
  recall_memory: "召回用户画像",
  search_catalog: "搜索车型数据库",
  compare_catalog: "对比车型参数",
  find_stores: "查找附近门店",
  search_service_knowledge: "搜索服务知识库",
};

const TYPE_CONFIG: Record<string, { icon: string; label: string; color: string }> = {
  think: { icon: "💭", label: "思考", color: "text-violet-600 dark:text-violet-400" },
  action: { icon: "🔧", label: "调用工具", color: "text-sky-600 dark:text-sky-400" },
  observe: { icon: "📊", label: "获得结果", color: "text-emerald-600 dark:text-emerald-400" },
  error: { icon: "⚠️", label: "工具失败", color: "text-amber-600 dark:text-amber-400" },
};

export function ReActTracePanel({ steps }: { steps: TraceStep[] }) {
  const [open, setOpen] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [steps.length]);

  if (steps.length === 0) return null;

  const thinkSteps = steps.filter((s) => s.type === "think" || s.type === "action" || s.type === "error");

  return (
    <div className="mb-3 rounded-2xl border border-violet-100 bg-violet-50/60 dark:border-violet-900/40 dark:bg-violet-950/20 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs font-semibold text-violet-700 dark:text-violet-300 hover:bg-violet-100/60 dark:hover:bg-violet-900/20 transition"
      >
        <span className="animate-pulse">⚙️</span>
        <span>Agent 推理过程 · {thinkSteps.length} 步</span>
        <span className="ml-auto">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="px-4 pb-3 space-y-2 max-h-64 overflow-y-auto">
          {steps.map((step, i) => {
            const cfg = TYPE_CONFIG[step.type] ?? { icon: "•", label: step.type, color: "text-ink-500" };
            return (
              <div key={i} className="flex gap-2.5 text-xs leading-relaxed">
                <span className="mt-0.5 shrink-0">{cfg.icon}</span>
                <div>
                  <span className={`font-semibold ${cfg.color}`}>{cfg.label}</span>
                  {step.type === "think" && step.thought && (
                    <p className="mt-0.5 text-ink-600 dark:text-slate-400">{step.thought}</p>
                  )}
                  {step.type === "action" && step.action && (
                    <p className="mt-0.5 text-ink-600 dark:text-slate-400">
                      {ACTION_LABELS[step.action] ?? step.action}
                      {step.result && <span className="text-ink-400"> — {step.result}</span>}
                    </p>
                  )}
                  {step.type === "error" && (
                    <p className="mt-0.5 text-amber-700 dark:text-amber-400">{step.error ?? step.result}</p>
                  )}
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
