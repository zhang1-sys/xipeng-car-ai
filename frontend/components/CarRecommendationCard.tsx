import type { StructuredCar } from "@/lib/types";

const CAR_IMAGES: Record<string, string> = {
  G6: "/cars/g6.svg",
  G9: "/cars/g9.svg",
  P7i: "/cars/p7i.svg",
  "MONA M03": "/cars/mona-m03.svg",
  X9: "/cars/x9.svg",
};

function resolveCarImage(name: string): string | null {
  for (const [key, src] of Object.entries(CAR_IMAGES)) {
    if (name.includes(key)) return src;
  }
  return null;
}

export function CarRecommendationCard({ car }: { car: StructuredCar }) {
  const displayName = car.name || "推荐车型";
  const imgSrc = car.image || resolveCarImage(displayName);

  return (
    <div className="group relative flex h-full flex-col overflow-hidden rounded-[28px] border border-ink-100/80 bg-white shadow-card transition hover:border-[#eb5b2a]/30 hover:shadow-[0_24px_60px_-20px_rgba(235,91,42,0.25)]">
      {/* ── Brand color bar ── */}
      <div className="h-1.5 w-full bg-gradient-to-r from-[#eb5b2a] via-[#ff9558] to-[#eb5b2a]" />

      {/* ── Car image hero ── */}
      {imgSrc ? (
        <div className="relative flex items-center justify-center overflow-hidden bg-gradient-to-b from-ink-50 to-white px-6 pb-2 pt-6">
          {/* Subtle glow */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_50%_at_50%_70%,rgba(235,91,42,0.06),transparent_70%)]" />
          <img
            src={imgSrc}
            alt={displayName}
            className="relative z-10 h-auto w-full max-w-[220px] select-none transition-transform duration-500 group-hover:scale-105"
            draggable={false}
          />
        </div>
      ) : null}

      <div className="flex flex-1 flex-col p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              {car.brand ? (
                <span className="rounded-full bg-ink-900 px-2.5 py-1 text-[10px] font-bold tracking-[0.14em] text-white">
                  {car.brand}
                </span>
              ) : null}
              {car.fitScore ? (
                <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-bold text-emerald-800">
                  匹配度 {car.fitScore}%
                </span>
              ) : null}
            </div>
            <h3 className="mt-3 text-lg font-bold text-ink-900">{displayName}</h3>
            {car.bestFor ? (
              <p className="mt-2 text-sm leading-6 text-ink-600">
                更适合：{car.bestFor}
              </p>
            ) : null}
          </div>

          <div className="rounded-[20px] border border-[#f3d0b8] bg-[#fff7f1] px-3 py-2 text-right">
            <p className="text-[11px] font-semibold tracking-[0.12em] text-[#b76438]">建议优先试驾</p>
            <p className="mt-1 text-sm font-semibold text-[#8f421d]">{car.price || "到店确认价格"}</p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {car.range ? (
            <div className="rounded-2xl bg-ink-50 px-4 py-3">
              <p className="text-[11px] font-semibold tracking-[0.12em] text-ink-500">续航 / 能耗</p>
              <p className="mt-1 text-sm font-semibold text-ink-900">{car.range}</p>
            </div>
          ) : null}
          {car.smart ? (
            <div className="rounded-2xl bg-ink-50 px-4 py-3">
              <p className="text-[11px] font-semibold tracking-[0.12em] text-ink-500">智能亮点</p>
              <p className="mt-1 text-sm font-semibold text-ink-900">{car.smart}</p>
            </div>
          ) : null}
        </div>

        {car.reasons?.length ? (
          <div className="mt-5 border-t border-ink-100 pt-4">
            <p className="text-[11px] font-bold tracking-[0.14em] text-[#b76438]">推荐理由</p>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-ink-700">
              {car.reasons.map((reason, index) => (
                <li key={reason} className="flex gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#fff3e8] text-[10px] font-bold text-[#b84d24]">
                    {index + 1}
                  </span>
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {car.tradeoffs?.length ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/80 p-4">
            <p className="text-[11px] font-bold tracking-[0.12em] text-amber-800">需要留意</p>
            <ul className="mt-2 space-y-2 text-sm leading-6 text-amber-950/90">
              {car.tradeoffs.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
