import type { ComparisonStructured } from "@/lib/types";

export function ComparisonPanel({ data }: { data: ComparisonStructured }) {
  return (
    <div className="space-y-4">
      {data.intro ? (
        <p className="rounded-2xl border border-violet-100 bg-violet-50/60 px-4 py-3 text-sm leading-7 text-ink-800">
          {data.intro}
        </p>
      ) : null}

      {data.decision_focus?.length ? (
        <div className="rounded-[24px] border border-ink-100 bg-ink-50/70 px-4 py-4">
          <p className="text-[11px] font-bold tracking-[0.14em] text-ink-500">这次对比重点</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {data.decision_focus.map((item) => (
              <span
                key={item}
                className="rounded-full border border-violet-200 bg-white px-2.5 py-1 text-[11px] text-ink-700"
              >
                {item}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {data.dimensions?.length ? (
        <div className="overflow-hidden rounded-[24px] border border-ink-100 bg-white shadow-card">
          <div className="bg-gradient-to-r from-violet-600 via-indigo-600 to-sky-600 px-4 py-3 text-white">
            <p className="text-[11px] font-bold tracking-[0.15em] text-white/80">并排看差异</p>
            <p className="mt-1 text-sm font-semibold">把关键维度放在一张表里看清楚</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[320px] text-left text-sm">
              <thead className="bg-ink-50 text-xs font-bold tracking-wide text-ink-500">
                <tr>
                  <th className="px-4 py-3">维度</th>
                  <th className="px-4 py-3">A 方案</th>
                  <th className="px-4 py-3">B 方案</th>
                </tr>
              </thead>
              <tbody>
                {data.dimensions.map((item, index) => (
                  <tr key={`${item.label}-${index}`} className="border-t border-ink-100">
                    <td className="px-4 py-3 font-semibold text-ink-900">{item.label}</td>
                    <td className="px-4 py-3 text-ink-700">{item.a || "暂未提供"}</td>
                    <td className="px-4 py-3 text-ink-700">{item.b || "暂未提供"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {data.conclusion ? (
        <div className="rounded-[24px] border border-sky-200 bg-gradient-to-br from-sky-50 to-white px-4 py-4 text-sm leading-7 text-ink-800">
          <span className="font-semibold text-brand-dark">一句话结论：</span>
          {data.conclusion}
        </div>
      ) : null}

      {data.next_steps?.length ? (
        <div className="rounded-[24px] border border-emerald-200 bg-emerald-50/80 px-4 py-4">
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
    </div>
  );
}
