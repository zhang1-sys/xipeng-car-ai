import type { ServiceStructured } from "@/lib/types";

export function ServicePanel({ data }: { data: ServiceStructured }) {
  return (
    <div className="space-y-5">
      {data.title ? <h3 className="text-lg font-bold text-ink-900">{data.title}</h3> : null}

      {data.diagnosis ? (
        <p className="rounded-2xl border border-sky-100 bg-sky-50/70 px-4 py-3 text-sm leading-7 text-ink-800">
          {data.diagnosis}
        </p>
      ) : null}

      {data.steps?.length ? (
        <div>
          <p className="text-[11px] font-bold tracking-[0.14em] text-sky-700">操作步骤</p>
          <ol className="relative mt-3 space-y-0 border-l-2 border-sky-200 pl-6">
            {data.steps.map((step, index) => (
              <li key={`${step}-${index}`} className="relative pb-6 last:pb-0">
                <span className="absolute -left-[1.4rem] flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-indigo-600 text-xs font-bold text-white">
                  {index + 1}
                </span>
                <p className="pt-0.5 text-sm leading-7 text-ink-700">{step}</p>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {data.notes?.length ? (
        <div className="rounded-[24px] border border-amber-200 bg-amber-50/70 p-4">
          <p className="text-[11px] font-bold tracking-[0.14em] text-amber-800">注意事项</p>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-amber-950/90">
            {data.notes.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {data.when_to_escalate?.length ? (
        <div className="rounded-[24px] border border-red-200 bg-red-50/70 p-4">
          <p className="text-[11px] font-bold tracking-[0.14em] text-red-700">这些情况建议尽快联系官方</p>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-red-950/90">
            {data.when_to_escalate.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {data.next_steps?.length ? (
        <div className="rounded-[24px] border border-emerald-200 bg-emerald-50/80 p-4">
          <p className="text-[11px] font-bold tracking-[0.14em] text-emerald-800">建议下一步</p>
          <ol className="mt-3 space-y-2 text-sm leading-6 text-emerald-950/90">
            {data.next_steps.map((item, index) => (
              <li key={item}>
                {index + 1}. {item}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {data.citations?.length ? (
        <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4">
          <p className="text-[11px] font-bold tracking-[0.14em] text-slate-700">参考来源</p>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-800">
            {data.citations.map((citation, index) => (
              <li key={`${citation.sourceUri || citation.title || "citation"}-${index}`}>
                <span className="font-semibold">{citation.title || "知识条目"}</span>
                {citation.sourceUri ? ` | ${citation.sourceUri}` : ""}
                {typeof citation.similarity === "number"
                  ? ` | 相似度 ${citation.similarity.toFixed(3)}`
                  : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {data.closing ? (
        <p className="rounded-2xl border border-ink-100 bg-ink-50/90 px-4 py-3 text-sm leading-7 text-ink-700">
          {data.closing}
        </p>
      ) : null}
    </div>
  );
}
