"use client";

import { useEffect, useState } from "react";
import type { StructuredCar } from "@/lib/types";
import { resolveOfficialCarImage } from "@/lib/carVisuals";

function SummaryList({
  items,
  tone,
}: {
  items: string[];
  tone: "highlight" | "tradeoff";
}) {
  if (!items.length) return null;

  const palette =
    tone === "highlight"
      ? {
          wrapper: "border-[#f3d8c6] bg-[#fff7f1]",
          title: "text-[#b76438]",
          bullet: "bg-[#fff1e6] text-[#ba5428]",
          text: "text-ink-700",
          label: "亮点",
        }
      : {
          wrapper: "border-amber-200 bg-amber-50/80",
          title: "text-amber-800",
          bullet: "bg-amber-100 text-amber-800",
          text: "text-amber-950/90",
          label: "留意点",
        };

  return (
    <div className={`rounded-2xl border px-4 py-4 ${palette.wrapper}`}>
      <p className={`text-[11px] font-bold tracking-[0.12em] ${palette.title}`}>{palette.label}</p>
      <div className="mt-3 space-y-2.5">
        {items.map((item) => (
          <div key={item} className="flex gap-2.5">
            <span
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${palette.bullet}`}
            >
              {tone === "highlight" ? "+" : "!"}
            </span>
            <p className={`min-w-0 text-sm leading-6 ${palette.text}`}>{item}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CarRecommendationCard({ car }: { car: StructuredCar }) {
  const displayName = car.name || "推荐车型";
  const primarySrc = resolveOfficialCarImage(displayName, car.image);
  const fallbackSrc = car.image && car.image !== primarySrc ? car.image : null;
  const [imgSrc, setImgSrc] = useState<string | null>(primarySrc);
  const highlights = Array.isArray(car.reasons) ? car.reasons.slice(0, 2) : [];
  const tradeoffs = Array.isArray(car.tradeoffs) ? car.tradeoffs.slice(0, 2) : [];

  useEffect(() => {
    setImgSrc(primarySrc);
  }, [primarySrc]);

  return (
    <div className="group relative flex h-full min-w-0 flex-col overflow-hidden rounded-[28px] border border-ink-100/80 bg-white shadow-card transition hover:border-[#eb5b2a]/25 hover:shadow-[0_24px_60px_-24px_rgba(235,91,42,0.22)]">
      <div className="h-1.5 w-full bg-gradient-to-r from-[#eb5b2a] via-[#ff9558] to-[#eb5b2a]" />

      {imgSrc ? (
        <div className="relative flex min-h-[180px] items-center justify-center overflow-hidden bg-gradient-to-b from-ink-50 to-white px-6 pb-2 pt-5">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_68%_48%_at_50%_72%,rgba(235,91,42,0.06),transparent_72%)]" />
          <img
            src={imgSrc}
            alt={displayName}
            className="relative z-10 h-auto w-full max-w-[220px] select-none object-contain transition-transform duration-500 group-hover:scale-[1.03]"
            draggable={false}
            loading="lazy"
            decoding="async"
            onError={() => {
              if (fallbackSrc && imgSrc !== fallbackSrc) {
                setImgSrc(fallbackSrc);
                return;
              }
              setImgSrc(null);
            }}
          />
        </div>
      ) : null}

      <div className="flex flex-1 flex-col p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
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

            <h3 className="mt-3 break-words text-xl font-bold text-ink-900">{displayName}</h3>
          </div>

          <div className="min-w-[132px] rounded-[20px] border border-[#f3d0b8] bg-[#fff7f1] px-3 py-2 text-left sm:text-right">
            <p className="text-[11px] font-semibold tracking-[0.12em] text-[#b76438]">价格参考</p>
            <p className="mt-1 break-words text-sm font-semibold text-[#8f421d]">
              {car.price || "到店确认"}
            </p>
          </div>
        </div>

        {car.bestFor ? (
          <div className="mt-4 rounded-2xl border border-[#f0e0d2] bg-[#fffaf6] px-4 py-3">
            <p className="break-words text-sm leading-7 text-ink-700">
              <span className="mr-2 inline-block text-[11px] font-bold tracking-[0.12em] text-[#b76438]">
                适合谁：
              </span>
              <span>{car.bestFor}</span>
            </p>
          </div>
        ) : null}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {car.range ? (
            <div className="rounded-2xl bg-ink-50 px-4 py-3">
              <p className="text-[11px] font-semibold tracking-[0.12em] text-ink-500">续航 / 能耗</p>
              <p className="mt-1 break-words text-sm font-semibold text-ink-900">{car.range}</p>
            </div>
          ) : null}
          {car.smart ? (
            <div className="rounded-2xl bg-ink-50 px-4 py-3">
              <p className="text-[11px] font-semibold tracking-[0.12em] text-ink-500">智能亮点</p>
              <p className="mt-1 break-words text-sm font-semibold text-ink-900">{car.smart}</p>
            </div>
          ) : null}
        </div>

        <div className="mt-4 space-y-3">
          <SummaryList items={highlights} tone="highlight" />
          <SummaryList items={tradeoffs} tone="tradeoff" />
        </div>
      </div>
    </div>
  );
}
