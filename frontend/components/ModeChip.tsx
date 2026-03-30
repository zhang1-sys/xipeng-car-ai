import type { ChatMode } from "@/lib/types";

const MODE_META: Record<ChatMode, { label: string; className: string }> = {
  recommendation: {
    label: "智能推荐",
    className: "border-emerald-200 bg-emerald-50 text-emerald-900",
  },
  comparison: {
    label: "车型对比",
    className: "border-violet-200 bg-violet-50 text-violet-900",
  },
  service: {
    label: "用车服务",
    className: "border-sky-200 bg-sky-50 text-sky-900",
  },
  configurator: {
    label: "选配流程",
    className: "border-amber-200 bg-amber-50 text-amber-900",
  },
};

export function ModeChip({ mode }: { mode: ChatMode }) {
  const meta = MODE_META[mode] ?? MODE_META.service;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-bold tracking-[0.12em] ${meta.className}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden />
      {meta.label}
    </span>
  );
}
