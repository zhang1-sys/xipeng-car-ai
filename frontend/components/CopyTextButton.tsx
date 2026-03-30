"use client";

import { useCallback, useState } from "react";

export function CopyTextButton({ text, label = "复制" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      window.setTimeout(() => setDone(false), 2000);
    } catch {
      /* ignore */
    }
  }, [text]);

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="rounded-lg border border-ink-100 bg-white/90 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-500 transition hover:border-sky-200 hover:text-brand-dark dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-sky-500 dark:hover:text-sky-300"
    >
      {done ? "已复制" : label}
    </button>
  );
}
