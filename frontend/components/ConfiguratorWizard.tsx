"use client";

import { startTransition, useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import { resolveConfiguratorChoices } from "@/lib/configuratorFallback";
import type {
  ConfiguratorChoicesPayload,
  ConfiguratorStructured,
} from "@/lib/types";

const ALL_STEPS = ["车型", "版本", "外观颜色", "内饰", "套件", "配置摘要"] as const;
type StepKey = (typeof ALL_STEPS)[number];

type ShowroomModel = {
  key: string;
  name: string;
  image: string;
  officialImage?: string;
  photoFocus?: string;
  bodyType: string;
  rangeLabel: string;
  seatsLabel: string;
  accent: string;
  secondaryAccent: string;
  tagline: string;
  highlight: string;
  priceFrom: number;
  priceLabel: string;
  statsLabel: string;
  highlightLabel: string;
  counts?: {
    variants: number;
    colors: number;
    interiors: number;
    packages: number;
  };
};

const SHOWROOM_MODELS: ShowroomModel[] = [
  {
    key: "G6",
    name: "小鹏 G6",
    image: "/cars/g6.svg",
    officialImage: "/cars/official/g6-stage-default.png",
    bodyType: "纯电 SUV",
    rangeLabel: "增程综合 1704km / 纯电 625km",
    seatsLabel: "5 座",
    accent: "#ff7b36",
    secondaryAccent: "#ffe0bf",
    tagline: "当前公开配置规则最完整的主力入口",
    highlight: "颜色限制、座舱主题限制和 Ultra 互斥规则都能完整演示。",
    priceFrom: 18.68,
    priceLabel: "18.68 万起",
    statsLabel: "规则完整、主销、适合默认入口",
    highlightLabel: "推荐主入口",
  },
  {
    key: "X9",
    name: "小鹏 X9",
    image: "/cars/x9.svg",
    officialImage: "/cars/official/x9-official-cover.png",
    bodyType: "纯电 MPV",
    rangeLabel: "CLTC 最高 740km",
    seatsLabel: "7 座",
    accent: "#7aa7ff",
    secondaryAccent: "#e3edff",
    tagline: "多人出行与旗舰舒适场景的高规格车型",
    highlight: "版本丰富，但公开配置页没有独立选装包步骤。",
    priceFrom: 30.98,
    priceLabel: "30.98 万起",
    statsLabel: "MPV、多座、旗舰舒适",
    highlightLabel: "旗舰 MPV",
  },
  {
    key: "P7+",
    name: "小鹏 P7+",
    image: "/cars/p7i.svg",
    officialImage: "/cars/official/p7plus-official.png",
    bodyType: "纯电轿跑",
    rangeLabel: "CLTC 最高 725km",
    seatsLabel: "5 座",
    accent: "#7df1ce",
    secondaryAccent: "#dffff5",
    tagline: "偏设计与智能升级取向的轿跑线",
    highlight: "公开页里可选 Ultra SE / Ultra 智能升级包，并带互斥规则。",
    priceFrom: 18.68,
    priceLabel: "18.68 万起",
    statsLabel: "轿跑、智能升级、风格化",
    highlightLabel: "轿跑线",
  },
  {
    key: "G7",
    name: "小鹏 G7",
    image: "/cars/g6.svg",
    officialImage: "/cars/official/g7-official-cover.png",
    bodyType: "纯电 SUV",
    rangeLabel: "CLTC 最高 702km",
    seatsLabel: "5 座",
    accent: "#6fd9c4",
    secondaryAccent: "#d8fff8",
    tagline: "更偏新一代智能升级包表达的 SUV 线",
    highlight: "可展示官方公开页里的 Ultra SE / Ultra 包互斥与多套选装。",
    priceFrom: 19.58,
    priceLabel: "19.58 万起",
    statsLabel: "新一代、智能包、SUV",
    highlightLabel: "新车型",
  },
  {
    key: "G9",
    name: "小鹏 G9",
    image: "/cars/g9.svg",
    officialImage: "/cars/official/g9-stage-default.png",
    bodyType: "纯电旗舰 SUV",
    rangeLabel: "CLTC 最高 725km",
    seatsLabel: "5 座",
    accent: "#cfa36a",
    secondaryAccent: "#f9ebd8",
    tagline: "高端舒适、长途与旗舰体验优先",
    highlight: "公开页支持个性化颜色/内饰与多套选装包，含互斥智能包规则。",
    priceFrom: 24.88,
    priceLabel: "24.88 万起",
    statsLabel: "旗舰、舒适、空间感",
    highlightLabel: "旗舰 SUV",
  },
  {
    key: "P7",
    name: "全新小鹏 P7",
    image: "/cars/p7i.svg",
    officialImage: "/cars/official/p7-official-cover.png",
    bodyType: "纯电轿跑",
    rangeLabel: "CLTC 最高 820km",
    seatsLabel: "5 座",
    accent: "#9cb5ff",
    secondaryAccent: "#eef2ff",
    tagline: "当前公开页以版本、颜色和主题为主的全新 P7 线",
    highlight: "官方公开配置页没有独立套件步骤，但颜色和内饰主题非常丰富。",
    priceFrom: 20.38,
    priceLabel: "20.38 万起",
    statsLabel: "全新 P7、主题丰富、轿跑",
    highlightLabel: "全新 P7",
  },
  {
    key: "MONA M03",
    name: "小鹏 MONA M03",
    image: "/cars/mona-m03.svg",
    officialImage: "/cars/official/m03-official.png",
    bodyType: "纯电轿跑",
    rangeLabel: "CLTC 最高 620km",
    seatsLabel: "5 座",
    accent: "#8fd3ff",
    secondaryAccent: "#eff8ff",
    tagline: "首购与年轻用户向的高性价比车型",
    highlight: "官方配置页把部分外观/主题组合直接做成联动颜色项，并附有限制备注。",
    priceFrom: 11.98,
    priceLabel: "11.98 万起",
    statsLabel: "轻快、低门槛、好上手",
    highlightLabel: "首购优先",
  },
];

const COLOR_HEX: Record<string, string> = {
  星云白: "#f0f0f0",
  云母白: "#eeeee8",
  星暮白: "#e8e4de",
  月光白: "#f5f5f0",
  新月银: "#b8bcc2",
  星云灰: "#8a8d92",
  星昼灰: "#8f9197",
  星暮紫: "#65506f",
  暗夜黑: "#1a1a1e",
  星际绿: "#2d4a3e",
  深海蓝: "#1e3a5f",
  天青蓝: "#4a8bad",
  星瀚米: "#d9c9af",
  微月灰: "#8e8f95",
  星雨青: "#6ea3a0",
  晨雾灰: "#b5b5b0",
  夜幕灰: "#4b4d52",
  拂晓紫: "#8e7ba0",
};

const INTERIOR_HEX: Record<string, string> = {
  深空灰: "#51555b",
  气宇灰: "#6a6d72",
  秘境蓝: "#27445c",
  月影咖: "#5c4a3a",
  曜石黑: "#1a1a1e",
  暖阳棕: "#7a5a3e",
  轻雾灰: "#9a9da2",
  深空黑内饰: "#1c1c20",
  曜石黑内饰: "#1a1a1e",
  气宇灰内饰: "#6a6d72",
  月影灰内饰: "#5a5d62",
  月影咖内饰: "#5c4a3a",
  暖阳棕内饰: "#7a5a3e",
  轻雾灰内饰: "#9a9da2",
};

const OFFICIAL_STAGE_IMAGES: Record<
  string,
  {
    defaultImage?: string;
  }
> = {
  G6: {
    defaultImage: "/cars/official/g6-stage-default.png",
  },
  G9: {
    defaultImage: "/cars/official/g9-stage-default.png",
  },
  G7: {
    defaultImage: "/cars/official/g7-official-cover.png",
  },
  X9: {
    defaultImage: "/cars/official/x9-official-cover.png",
  },
  "P7+": {
    defaultImage: "/cars/official/p7plus-official.png",
  },
  P7: {
    defaultImage: "/cars/official/p7-official-cover.png",
  },
  "MONA M03": {
    defaultImage: "/cars/official/m03-official.png",
  },
};

const STEP_BACK_ACTIONS: Record<Exclude<StepKey, "配置摘要">, string> = {
  车型: "我想换一款车型",
  版本: "我想换一个版本",
  外观颜色: "我想换外观颜色",
  内饰: "我想换内饰颜色",
  套件: "我想重新选择套件",
};

type Props = {
  state: ConfiguratorStructured | null;
  choices: ConfiguratorChoicesPayload | null;
  busy: boolean;
  onAction: (text: string) => void;
  onReset: () => void;
  onBookTestDrive: (carName?: string) => void;
  onAdvisorFollowup: (carName?: string) => void;
};

function normalizeModelKey(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[()（）\-_/.,，。]/g, "");
}

function getSelectedPackages(state: ConfiguratorStructured | null) {
  const packs = state?.packages || state?.selectedPackages || [];
  return Array.isArray(packs) ? packs : [];
}

function getStepSequence(
  state: ConfiguratorStructured | null,
  choices?: ConfiguratorChoicesPayload | null
): StepKey[] {
  const selectedPackages = getSelectedPackages(state);
  const hasColorStep = Boolean(choices?.colors?.length) || Boolean(state?.exteriorColor || state?.selectedColor);
  const hasInteriorStep = Boolean(choices?.interiors?.length) || Boolean(state?.interiorColor || state?.selectedInterior);
  const hasPackageStep = Boolean(choices?.packages?.length) || Boolean(selectedPackages.length);
  return [
    "车型",
    "版本",
    ...(hasColorStep ? (["外观颜色"] as StepKey[]) : []),
    ...(hasInteriorStep ? (["内饰"] as StepKey[]) : []),
    ...(hasPackageStep ? (["套件"] as StepKey[]) : []),
    "配置摘要",
  ];
}

function buildStepStatus(
  state: ConfiguratorStructured | null,
  choices?: ConfiguratorChoicesPayload | null
) {
  const model = state?.model || state?.selectedModel || null;
  const variant = state?.variant || state?.selectedVariant || null;
  const color = state?.exteriorColor || state?.selectedColor || null;
  const interior = state?.interiorColor || state?.selectedInterior || null;
  const packages = getSelectedPackages(state);
  const done = Boolean(state?.done || state?.summary_text);
  const steps = getStepSequence(state, choices);
  const current: StepKey = (() => {
    if (done) return "配置摘要";
    if (!model) return "车型";
    if (!variant) return "版本";
    if (steps.includes("外观颜色") && !color) return "外观颜色";
    if (steps.includes("内饰") && !interior) return "内饰";
    if (steps.includes("套件") && !packages.length) return "套件";
    return "配置摘要";
  })();
  return { model, variant, color, interior, packages, done, current, steps };
}

function formatPremium(premium?: number) {
  if (!premium) return "标配";
  return `+${premium.toFixed(2)} 万元`;
}

function formatPrice(price?: number | null) {
  if (typeof price !== "number" || Number.isNaN(price)) return "待确认";
  return `${price.toFixed(2)} 万元`;
}

function formatPriceFrom(price?: number | null) {
  if (typeof price !== "number" || Number.isNaN(price)) return "价格待确认";
  return `${price.toFixed(2)} 万起`;
}

function formatDateLabel(value?: string | null) {
  if (!value) return null;
  return value.slice(0, 10);
}

function hexToRgba(hex: string, alpha: number) {
  const safe = hex.replace("#", "").trim();
  const normalized = safe.length === 3
    ? safe.split("").map((char) => char + char).join("")
    : safe;
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function mixHex(hex: string, target: string, amount: number) {
  const clamp = Math.max(0, Math.min(1, amount));
  const normalize = (value: string) => {
    const raw = value.replace("#", "").trim();
    return raw.length === 3
      ? raw.split("").map((char) => char + char).join("")
      : raw;
  };

  const source = normalize(hex);
  const destination = normalize(target);
  const channels = [0, 2, 4].map((offset) => {
    const from = Number.parseInt(source.slice(offset, offset + 2), 16);
    const to = Number.parseInt(destination.slice(offset, offset + 2), 16);
    return Math.round(from + (to - from) * clamp);
  });

  return `#${channels.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function resolveRenderModelKey(modelName: string | null, models: ShowroomModel[]) {
  const model = resolveShowroomModel(modelName, models);
  const key = model?.key || "";
  if (key === "G9") return "g9";
  if (key === "X9") return "x9";
  if (key === "P7" || key === "P7+") return "p7";
  if (key === "MONA M03") return "m03";
  return "g6";
}

function resolveOfficialStageImage(
  modelName: string | null,
  _colorName: string | null | undefined,
  models: ShowroomModel[]
) {
  const model = resolveShowroomModel(modelName, models);
  const assets = model ? OFFICIAL_STAGE_IMAGES[model.key] : null;
  return assets?.defaultImage || model?.officialImage || null;
}

function resolveColorHex(colorName: string | null | undefined) {
  const raw = String(colorName || "").trim();
  if (!raw) return null;
  return COLOR_HEX[raw] || COLOR_HEX[raw.split("+")[0]?.trim()] || null;
}

function resolveInteriorHex(interiorName: string | null | undefined) {
  const raw = String(interiorName || "").trim();
  if (!raw) return null;
  return INTERIOR_HEX[raw] || INTERIOR_HEX[`${raw}内饰`] || null;
}

function sanitizeConfiguratorNote(value: string | null | undefined) {
  return String(value || "")
    .replace(/^\s*(?:\d+|[一二三四五六七八九十百]+)[.、:：)\]]\s*/, "")
    .replace(/^\s*[-•·*]+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeConfiguratorNotes(values: Array<string | null | undefined> | null | undefined) {
  return Array.from(
    new Set((Array.isArray(values) ? values : []).map(sanitizeConfiguratorNote).filter(Boolean))
  );
}

function getRestrictionNotes(
  choices: ConfiguratorChoicesPayload | null,
  state: ConfiguratorStructured | null
) {
  const activeNotes = sanitizeConfiguratorNotes(
    choices?.activeRestrictionNotes || state?.activeRestrictionNotes || []
  );
  if (activeNotes.length) return activeNotes;
  return sanitizeConfiguratorNotes(choices?.restrictionNotes || state?.restrictionNotes || []);
}

function resolveShowroomModel(
  modelName: string | null,
  models: ShowroomModel[]
): ShowroomModel | null {
  const normalized = normalizeModelKey(modelName);
  return (
    models.find((item) => normalized.includes(normalizeModelKey(item.key))) ||
    models.find((item) => normalized.includes(normalizeModelKey(item.name))) ||
    null
  );
}

function ModelPhoto({
  model,
  className = "",
  loading = "lazy",
}: {
  model: ShowroomModel;
  className?: string;
  loading?: "eager" | "lazy";
}) {
  const [imageSrc, setImageSrc] = useState(model.officialImage || model.image);

  useEffect(() => {
    setImageSrc(model.officialImage || model.image);
  }, [model.image, model.officialImage]);

  if (imageSrc) {
    return (
      <div className={["overflow-hidden rounded-[22px] border border-white/14 bg-[#120f0d]", className].join(" ")}>
        <img
          src={imageSrc}
          alt={`${model.name} 官方车型图`}
          className="h-full w-full object-contain"
          draggable={false}
          loading={loading}
          decoding="async"
          onError={() => {
            if (imageSrc !== model.image) {
              setImageSrc(model.image);
              return;
            }
            setImageSrc("");
          }}
        />
      </div>
    );
  }

  return (
    <div className={["overflow-hidden rounded-[22px] border border-white/10 bg-[#0f1218]", className].join(" ")}>
      <img
        src={model.image}
        alt={model.name}
        className="h-full w-full object-contain opacity-92"
        draggable={false}
        loading={loading}
        decoding="async"
      />
    </div>
  );
}

function VehicleIllustration({
  modelKey,
  paintColor,
  interiorTone,
  accentColor,
  className = "",
}: {
  modelKey: "g6" | "g9" | "x9" | "p7" | "m03";
  paintColor: string;
  interiorTone: string;
  accentColor: string;
  className?: string;
}) {
  const id = useId().replace(/:/g, "");
  const bodyLight = mixHex(paintColor, "#ffffff", 0.26);
  const bodyMid = mixHex(paintColor, "#9aa3ad", 0.14);
  const bodyShadow = mixHex(paintColor, "#05070b", 0.68);
  const glassTop = mixHex(interiorTone, "#bfe5ff", 0.24);
  const glassBottom = mixHex(interiorTone, "#0a121c", 0.58);
  const wheelOuter = mixHex(paintColor, "#05070b", 0.84);
  const wheelMid = mixHex(paintColor, "#2f3640", 0.72);
  const wheelInner = mixHex(paintColor, "#5c6672", 0.62);
  const bodyGradientId = `${id}-body`;
  const glassGradientId = `${id}-glass`;
  const groundGradientId = `${id}-ground`;
  const glowId = `${id}-glow`;

  const sharedDefs = (
    <defs>
      <linearGradient id={bodyGradientId} x1="0" y1="0" x2="800" y2="400" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor={bodyLight} />
        <stop offset="48%" stopColor={bodyMid} />
        <stop offset="100%" stopColor={bodyShadow} />
      </linearGradient>
      <linearGradient id={glassGradientId} x1="250" y1="120" x2="560" y2="230" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor={glassTop} stopOpacity="0.72" />
        <stop offset="100%" stopColor={glassBottom} stopOpacity="0.26" />
      </linearGradient>
      <linearGradient id={groundGradientId} x1="0" y1="340" x2="800" y2="400" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor={accentColor} stopOpacity="0.18" />
        <stop offset="100%" stopColor={accentColor} stopOpacity="0" />
      </linearGradient>
      <filter id={glowId}>
        <feGaussianBlur stdDeviation="7" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  );

  if (modelKey === "g9") {
    return (
      <svg viewBox="0 0 800 400" fill="none" className={className} aria-hidden="true">
        {sharedDefs}
        <ellipse cx="400" cy="348" rx="340" ry="20" fill={`url(#${groundGradientId})`} />
        <path d="M100,285 L120,260 L165,225 L230,170 L270,148 L340,128 L430,124 L520,128 L570,148 L610,175 L650,215 L680,250 L710,278 L718,290 L718,305 L695,314 L640,318 L190,318 L140,314 L112,308 L98,300 L98,290 Z" fill={`url(#${bodyGradientId})`} stroke={mixHex(paintColor, "#d7dde5", 0.24)} strokeWidth="1" />
        <path d="M250,175 L300,148 L430,140 L520,148 L560,170 L575,195 L570,212 L245,212 Z" fill={`url(#${glassGradientId})`} stroke={mixHex(interiorTone, "#d0e8ff", 0.24)} strokeWidth="0.5" />
        <line x1="410" y1="142" x2="405" y2="212" stroke={mixHex(interiorTone, "#0d1118", 0.38)} strokeWidth="1.5" />
        <rect x="105" y="262" width="35" height="6" rx="3" fill="#f4fbff" opacity="0.92" filter={`url(#${glowId})`} />
        <rect x="710" y="268" width="10" height="22" rx="3" fill="#ff665c" opacity="0.88" filter={`url(#${glowId})`} />
        <line x1="640" y1="280" x2="718" y2="280" stroke="#ff7469" strokeWidth="2" opacity="0.42" />
        <circle cx="215" cy="318" r="35" fill={wheelOuter} stroke={mixHex(wheelOuter, "#6f7783", 0.22)} strokeWidth="2" />
        <circle cx="215" cy="318" r="22" fill={wheelMid} stroke={mixHex(wheelMid, "#9098a4", 0.18)} strokeWidth="1" />
        <circle cx="215" cy="318" r="13" fill={wheelInner} stroke={mixHex(wheelInner, "#bdc5d0", 0.16)} strokeWidth="0.5" />
        <circle cx="630" cy="318" r="35" fill={wheelOuter} stroke={mixHex(wheelOuter, "#6f7783", 0.22)} strokeWidth="2" />
        <circle cx="630" cy="318" r="22" fill={wheelMid} stroke={mixHex(wheelMid, "#9098a4", 0.18)} strokeWidth="1" />
        <circle cx="630" cy="318" r="13" fill={wheelInner} stroke={mixHex(wheelInner, "#bdc5d0", 0.16)} strokeWidth="0.5" />
        <path d="M270,148 L340,128 L430,124 L520,128 L570,148" fill="none" stroke={mixHex(paintColor, "#ffffff", 0.22)} strokeWidth="0.8" opacity="0.7" />
        <path d="M120,268 L718,268" fill="none" stroke={accentColor} strokeWidth="1" opacity="0.48" />
      </svg>
    );
  }

  if (modelKey === "x9") {
    return (
      <svg viewBox="0 0 800 400" fill="none" className={className} aria-hidden="true">
        {sharedDefs}
        <ellipse cx="400" cy="352" rx="350" ry="22" fill={`url(#${groundGradientId})`} />
        <path d="M95,290 L110,268 L140,240 L190,195 L240,160 L290,138 L370,125 L460,122 L540,125 L590,138 L630,160 L665,195 L700,240 L720,268 L728,290 L728,310 L710,318 L660,322 L180,322 L130,318 L105,312 L90,305 L90,295 Z" fill={`url(#${bodyGradientId})`} stroke={mixHex(paintColor, "#d7dde5", 0.22)} strokeWidth="1" />
        <path d="M260,165 L320,142 L450,135 L540,142 L580,165 L598,195 L598,218 L252,218 L252,195 Z" fill={`url(#${glassGradientId})`} stroke={mixHex(interiorTone, "#d0e8ff", 0.24)} strokeWidth="0.5" />
        <line x1="380" y1="137" x2="378" y2="218" stroke={mixHex(interiorTone, "#0d1118", 0.36)} strokeWidth="1.2" />
        <line x1="475" y1="140" x2="473" y2="218" stroke={mixHex(interiorTone, "#0d1118", 0.36)} strokeWidth="1.2" />
        <rect x="100" y="270" width="38" height="7" rx="3.5" fill="#f4fbff" opacity="0.92" filter={`url(#${glowId})`} />
        <rect x="720" y="272" width="10" height="22" rx="3" fill="#ff665c" opacity="0.88" filter={`url(#${glowId})`} />
        <line x1="660" y1="285" x2="728" y2="285" stroke="#ff7469" strokeWidth="2" opacity="0.38" />
        <circle cx="205" cy="322" r="36" fill={wheelOuter} stroke={mixHex(wheelOuter, "#6f7783", 0.22)} strokeWidth="2" />
        <circle cx="205" cy="322" r="23" fill={wheelMid} stroke={mixHex(wheelMid, "#9098a4", 0.18)} strokeWidth="1" />
        <circle cx="205" cy="322" r="14" fill={wheelInner} stroke={mixHex(wheelInner, "#bdc5d0", 0.16)} strokeWidth="0.5" />
        <circle cx="640" cy="322" r="36" fill={wheelOuter} stroke={mixHex(wheelOuter, "#6f7783", 0.22)} strokeWidth="2" />
        <circle cx="640" cy="322" r="23" fill={wheelMid} stroke={mixHex(wheelMid, "#9098a4", 0.18)} strokeWidth="1" />
        <circle cx="640" cy="322" r="14" fill={wheelInner} stroke={mixHex(wheelInner, "#bdc5d0", 0.16)} strokeWidth="0.5" />
        <path d="M110,275 L728,275" fill="none" stroke={accentColor} strokeWidth="1" opacity="0.46" />
      </svg>
    );
  }

  if (modelKey === "p7") {
    return (
      <svg viewBox="0 0 800 400" fill="none" className={className} aria-hidden="true">
        {sharedDefs}
        <ellipse cx="400" cy="342" rx="330" ry="16" fill={`url(#${groundGradientId})`} />
        <path d="M90,295 L110,278 L145,255 L200,225 L280,185 L330,168 L400,160 L480,162 L540,170 L600,195 L650,225 L695,260 L720,285 L722,298 L720,308 L700,314 L650,318 L180,318 L130,314 L105,310 L90,305 Z" fill={`url(#${bodyGradientId})`} stroke={mixHex(paintColor, "#d7dde5", 0.22)} strokeWidth="1" />
        <path d="M295,190 L350,170 L420,164 L490,170 L540,190 L555,210 L555,225 L285,225 L285,210 Z" fill={`url(#${glassGradientId})`} stroke={mixHex(interiorTone, "#d0e8ff", 0.24)} strokeWidth="0.5" />
        <line x1="420" y1="165" x2="418" y2="225" stroke={mixHex(interiorTone, "#0d1118", 0.36)} strokeWidth="1.2" />
        <rect x="95" y="280" width="40" height="4" rx="2" fill="#f4fbff" opacity="0.94" filter={`url(#${glowId})`} />
        <rect x="714" y="278" width="8" height="18" rx="2" fill="#ff665c" opacity="0.88" filter={`url(#${glowId})`} />
        <circle cx="205" cy="318" r="30" fill={wheelOuter} stroke={mixHex(wheelOuter, "#6f7783", 0.22)} strokeWidth="2" />
        <circle cx="205" cy="318" r="18" fill={wheelMid} stroke={mixHex(wheelMid, "#9098a4", 0.18)} strokeWidth="1" />
        <circle cx="205" cy="318" r="10" fill={wheelInner} stroke={mixHex(wheelInner, "#bdc5d0", 0.16)} strokeWidth="0.5" />
        <circle cx="635" cy="318" r="30" fill={wheelOuter} stroke={mixHex(wheelOuter, "#6f7783", 0.22)} strokeWidth="2" />
        <circle cx="635" cy="318" r="18" fill={wheelMid} stroke={mixHex(wheelMid, "#9098a4", 0.18)} strokeWidth="1" />
        <circle cx="635" cy="318" r="10" fill={wheelInner} stroke={mixHex(wheelInner, "#bdc5d0", 0.16)} strokeWidth="0.5" />
        <path d="M330,168 L400,160 L480,162 L540,170" fill="none" stroke={mixHex(paintColor, "#ffffff", 0.18)} strokeWidth="0.7" opacity="0.72" />
        <path d="M110,280 L722,280" fill="none" stroke={accentColor} strokeWidth="1" opacity="0.42" />
      </svg>
    );
  }

  if (modelKey === "m03") {
    return (
      <svg viewBox="0 0 800 400" fill="none" className={className} aria-hidden="true">
        {sharedDefs}
        <ellipse cx="400" cy="342" rx="310" ry="14" fill={`url(#${groundGradientId})`} />
        <path d="M105,295 L120,278 L155,252 L220,218 L290,188 L340,172 L410,165 L485,168 L545,178 L600,200 L645,228 L685,260 L710,285 L712,298 L710,308 L692,314 L640,318 L185,318 L138,314 L112,310 L100,305 Z" fill={`url(#${bodyGradientId})`} stroke={mixHex(paintColor, "#d7dde5", 0.22)} strokeWidth="1" />
        <path d="M300,195 L355,176 L420,170 L490,176 L535,195 L548,212 L548,228 L292,228 L292,212 Z" fill={`url(#${glassGradientId})`} stroke={mixHex(interiorTone, "#d0e8ff", 0.24)} strokeWidth="0.5" />
        <line x1="420" y1="171" x2="418" y2="228" stroke={mixHex(interiorTone, "#0d1118", 0.36)} strokeWidth="1.2" />
        <rect x="110" y="278" width="32" height="5" rx="2.5" fill="#f4fbff" opacity="0.9" filter={`url(#${glowId})`} />
        <rect x="706" y="275" width="7" height="16" rx="2" fill="#ff665c" opacity="0.86" filter={`url(#${glowId})`} />
        <circle cx="210" cy="318" r="28" fill={wheelOuter} stroke={mixHex(wheelOuter, "#6f7783", 0.22)} strokeWidth="2" />
        <circle cx="210" cy="318" r="17" fill={wheelMid} stroke={mixHex(wheelMid, "#9098a4", 0.18)} strokeWidth="1" />
        <circle cx="210" cy="318" r="9" fill={wheelInner} stroke={mixHex(wheelInner, "#bdc5d0", 0.16)} strokeWidth="0.5" />
        <circle cx="625" cy="318" r="28" fill={wheelOuter} stroke={mixHex(wheelOuter, "#6f7783", 0.22)} strokeWidth="2" />
        <circle cx="625" cy="318" r="17" fill={wheelMid} stroke={mixHex(wheelMid, "#9098a4", 0.18)} strokeWidth="1" />
        <circle cx="625" cy="318" r="9" fill={wheelInner} stroke={mixHex(wheelInner, "#bdc5d0", 0.16)} strokeWidth="0.5" />
        <path d="M120,280 L712,280" fill="none" stroke={accentColor} strokeWidth="1" opacity="0.44" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 800 400" fill="none" className={className} aria-hidden="true">
      {sharedDefs}
      <ellipse cx="400" cy="345" rx="320" ry="18" fill={`url(#${groundGradientId})`} />
      <path d="M110,280 L130,260 L180,230 L240,180 L280,155 L340,135 L420,130 L500,135 L550,155 L590,180 L630,220 L660,250 L690,275 L700,285 L700,300 L680,310 L630,315 L580,318 L200,318 L150,315 L120,310 L105,305 L105,290 Z" fill={`url(#${bodyGradientId})`} stroke={mixHex(paintColor, "#d7dde5", 0.24)} strokeWidth="1" />
      <path d="M260,180 L310,152 L420,145 L500,152 L540,172 L560,195 L555,210 L250,210 Z" fill={`url(#${glassGradientId})`} stroke={mixHex(interiorTone, "#d0e8ff", 0.24)} strokeWidth="0.5" />
      <line x1="400" y1="148" x2="395" y2="210" stroke={mixHex(interiorTone, "#0d1118", 0.36)} strokeWidth="1.5" />
      <ellipse cx="120" cy="265" rx="18" ry="8" fill="#f4fbff" opacity="0.92" filter={`url(#${glowId})`} />
      <rect x="692" y="265" width="12" height="20" rx="3" fill="#ff665c" opacity="0.86" filter={`url(#${glowId})`} />
      <circle cx="220" cy="315" r="32" fill={wheelOuter} stroke={mixHex(wheelOuter, "#6f7783", 0.22)} strokeWidth="2" />
      <circle cx="220" cy="315" r="20" fill={wheelMid} stroke={mixHex(wheelMid, "#9098a4", 0.18)} strokeWidth="1" />
      <circle cx="220" cy="315" r="12" fill={wheelInner} stroke={mixHex(wheelInner, "#bdc5d0", 0.16)} strokeWidth="0.5" />
      <circle cx="620" cy="315" r="32" fill={wheelOuter} stroke={mixHex(wheelOuter, "#6f7783", 0.22)} strokeWidth="2" />
      <circle cx="620" cy="315" r="20" fill={wheelMid} stroke={mixHex(wheelMid, "#9098a4", 0.18)} strokeWidth="1" />
      <circle cx="620" cy="315" r="12" fill={wheelInner} stroke={mixHex(wheelInner, "#bdc5d0", 0.16)} strokeWidth="0.5" />
      <path d="M280,155 L340,135 L420,130 L500,135 L550,155" fill="none" stroke={mixHex(paintColor, "#ffffff", 0.2)} strokeWidth="0.8" opacity="0.72" />
      <path d="M130,270 L700,270" fill="none" stroke={accentColor} strokeWidth="1.2" opacity="0.42" />
    </svg>
  );
}

function getShowroomModels(choiceModels?: ConfiguratorChoicesPayload["models"] | null) {
  return SHOWROOM_MODELS.map((base) => {
    const matchedChoice = (choiceModels || []).find((item) => {
      const normalizedChoice = normalizeModelKey(item.name || item.key);
      return (
        normalizedChoice.includes(normalizeModelKey(base.key)) ||
        normalizedChoice.includes(normalizeModelKey(base.name))
      );
    });

    return {
      ...base,
      priceFrom: matchedChoice?.basePrice ?? base.priceFrom,
      priceLabel: formatPriceFrom(matchedChoice?.basePrice ?? base.priceFrom),
      highlight: matchedChoice?.highlight || base.highlight,
      counts: matchedChoice
        ? {
            variants: matchedChoice.variants,
            colors: matchedChoice.colors,
            interiors: matchedChoice.interiors,
            packages: matchedChoice.packages,
          }
        : undefined,
    };
  });
}

function StepNav({
  current,
  steps,
  selected,
  busy,
  onAction,
}: {
  current: StepKey;
  steps: StepKey[];
  selected: ReturnType<typeof buildStepStatus>;
  busy: boolean;
  onAction: (text: string) => void;
}) {
  const currentIndex = steps.indexOf(current);
  return (
    <div className="cfg-glass-highlight flex flex-wrap items-center gap-2 rounded-full px-2 py-2">
      {steps.map((key, index) => {
        const isDone =
          (key === "车型" && Boolean(selected.model)) ||
          (key === "版本" && Boolean(selected.variant)) ||
          (key === "外观颜色" && (!steps.includes("外观颜色") || Boolean(selected.color))) ||
          (key === "内饰" && (!steps.includes("内饰") || Boolean(selected.interior))) ||
          (key === "套件" && (!steps.includes("套件") || Boolean(selected.packages.length) || selected.done)) ||
          (key === "配置摘要" && selected.done);
        const isActive = key === current;
        const isClickable = index < currentIndex && key !== "配置摘要" && !busy;
        const action = key !== "配置摘要"
          ? STEP_BACK_ACTIONS[key as Exclude<StepKey, "配置摘要">]
          : null;

        return (
          <button
            key={key}
            type="button"
            disabled={!isClickable}
            onClick={() => {
              if (isClickable && action) onAction(action);
            }}
            className={[
              "rounded-full border px-3 py-1.5 text-[11px] font-semibold tracking-[0.16em] transition-all duration-300",
              isActive
                ? "cfg-step-active border-transparent text-white"
                : isDone
                  ? "cfg-step-done"
                  : "border-white/12 text-white/74",
              isClickable ? "hover:border-white/20 hover:text-white/90" : "cursor-default",
            ].join(" ")}
          >
            <span className="mr-1 inline-block text-[10px] opacity-60">
              {String(index + 1).padStart(2, "0")}
            </span>
            {key}
          </button>
        );
      })}
    </div>
  );
}

function ModelRail({
  models,
  activeModel,
  busy,
  onAction,
  onPreview,
}: {
  models: ShowroomModel[];
  activeModel: ShowroomModel | null;
  busy: boolean;
  onAction: (text: string) => void;
  onPreview: (key: string) => void;
}) {
  return (
    <div className="cfg-model-rail cfg-scroll flex gap-3 overflow-x-auto pb-1">
      {models.map((item) => {
        const active = activeModel?.key === item.key;
        return (
          <button
            key={item.key}
            type="button"
            disabled={busy}
            onMouseEnter={() => onPreview(item.key)}
            onFocus={() => onPreview(item.key)}
            onClick={() => onAction(`我想配置 ${item.name}`)}
            className={[
              "cfg-showroom-card min-w-[220px] rounded-[24px] px-4 py-4 text-left transition-transform duration-300 disabled:cursor-not-allowed disabled:opacity-50",
              active ? "cfg-showroom-card-active" : "",
            ].join(" ")}
            style={{
              borderColor: active ? hexToRgba(item.accent, 0.55) : undefined,
              boxShadow: active
                ? `0 30px 80px -40px ${hexToRgba(item.accent, 0.85)}`
                : undefined,
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <span
                className="rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-[0.18em] uppercase"
                style={{
                  background: hexToRgba(item.accent, 0.12),
                  color: item.secondaryAccent,
                }}
              >
                {item.highlightLabel}
              </span>
              <span className="text-[11px] text-white">{item.priceLabel}</span>
            </div>
            <ModelPhoto model={item} className="mt-4 h-24 w-full" loading={active ? "eager" : "lazy"} />
            <p className="mt-4 text-lg font-semibold text-white">{item.name}</p>
            <p className="mt-1 text-xs uppercase tracking-[0.18em] text-white/90">{item.bodyType}</p>
            <p className="mt-3 text-sm leading-6 text-white">{item.highlight}</p>
          </button>
        );
      })}
    </div>
  );
}

function CarStage({
  model,
  variant,
  selectedColor,
  selectedInterior,
  selectedPackages,
  busy,
  showroomModels,
}: {
  model: string | null;
  variant?: string | null;
  selectedColor?: string | null;
  selectedInterior?: string | null;
  selectedPackages?: string[];
  busy: boolean;
  showroomModels: ShowroomModel[];
}) {
  const modelInfo = resolveShowroomModel(model, showroomModels) || showroomModels[1] || SHOWROOM_MODELS[0];
  const accentColor = selectedColor
    ? resolveColorHex(selectedColor) || modelInfo.accent
    : modelInfo.accent;
  const interiorTone = selectedInterior
    ? resolveInteriorHex(selectedInterior) || modelInfo.secondaryAccent
    : modelInfo.secondaryAccent;
  const renderModelKey = resolveRenderModelKey(model, showroomModels);
  const officialStageImage = resolveOfficialStageImage(model, selectedColor, showroomModels);
  const [stageImageSrc, setStageImageSrc] = useState<string | null>(officialStageImage || modelInfo.image || null);
  const label = model || "选择车型";
  const packages = selectedPackages || [];

  useEffect(() => {
    setStageImageSrc(officialStageImage || modelInfo.image || null);
  }, [modelInfo.image, officialStageImage]);

  return (
    <div className="cfg-stage relative overflow-hidden rounded-[30px] border border-white/8 bg-black/18 px-4 py-6 sm:px-6">
      <div className="relative z-10 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.32em] text-[#4d3528]">当前车型</p>
          <p className="mt-2 text-2xl font-semibold text-[#1c120c]">{label}</p>
          <p className="mt-2 text-sm text-[#38241b]">{variant || modelInfo.tagline}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2 text-[11px] text-[#38241b]">
          {selectedColor ? (
            <span className="rounded-full border border-[#a98369]/30 bg-white/82 px-3 py-1.5">
              外观 {selectedColor}
            </span>
          ) : null}
          {selectedInterior ? (
            <span className="rounded-full border border-[#a98369]/30 bg-white/82 px-3 py-1.5">
              内饰 {selectedInterior}
            </span>
          ) : null}
        </div>
      </div>

      <div className="relative z-10 mt-5">
        <div className="cfg-car-container relative mx-auto w-full max-w-3xl">
          {stageImageSrc ? (
            <div className="rounded-[28px] border border-[#c8a88f]/18 bg-white/34 px-3 py-3 shadow-[0_24px_50px_-36px_rgba(70,42,24,0.32)]">
              <img
                src={stageImageSrc}
                alt={selectedColor ? `${label} ${selectedColor}` : label}
                className={`cfg-car-image relative z-10 h-auto w-full select-none rounded-[22px] object-contain ${busy ? "opacity-60" : ""}`}
                draggable={false}
                loading="eager"
                onError={() => {
                  if (stageImageSrc !== modelInfo.image && modelInfo.image) {
                    setStageImageSrc(modelInfo.image);
                    return;
                  }
                  setStageImageSrc(null);
                }}
              />
            </div>
          ) : (
            <VehicleIllustration
              modelKey={renderModelKey}
              paintColor={accentColor}
              interiorTone={interiorTone}
              accentColor={modelInfo.accent}
              className={`cfg-car-image relative z-10 h-auto w-full select-none ${busy ? "opacity-60" : ""}`}
            />
          )}
          {!stageImageSrc ? (
            <div className="cfg-car-reflection relative z-0 h-auto w-full select-none" aria-hidden="true">
              <VehicleIllustration
                modelKey={renderModelKey}
                paintColor={accentColor}
                interiorTone={interiorTone}
                accentColor={modelInfo.accent}
                className="h-auto w-full"
              />
            </div>
          ) : null}
        </div>
      </div>

      <div className="relative z-10 mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.38em] text-[#4d3528]">
          {modelInfo.bodyType}
        </p>
        <div className="flex flex-wrap gap-2 text-[11px] text-[#38241b]">
          <span className="rounded-full border border-[#bfa08a]/28 bg-white/52 px-3 py-1.5">{modelInfo.rangeLabel}</span>
          <span className="rounded-full border border-[#bfa08a]/28 bg-white/52 px-3 py-1.5">{modelInfo.seatsLabel}</span>
        </div>
      </div>

      {packages.length ? (
        <div className="relative z-10 mt-4 flex flex-wrap gap-2">
          {packages.slice(0, 3).map((item) => (
            <span
              key={item}
              className="rounded-full border border-[#ffb16e]/26 bg-[#fff3ea]/72 px-3 py-1.5 text-[11px] font-semibold text-[#6c3f21]"
            >
              {item}
            </span>
          ))}
          {packages.length > 3 ? (
            <span className="rounded-full border border-[#bfa08a]/24 bg-white/64 px-3 py-1.5 text-[11px] text-[#38241b]">
              +{packages.length - 3} 项
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ShowroomLanding({
  models,
  previewModel,
  busy,
  onAction,
  onPreview,
}: {
  models: ShowroomModel[];
  previewModel: ShowroomModel;
  busy: boolean;
  onAction: (text: string) => void;
  onPreview: (key: string) => void;
}) {
  const totalVariants = models.reduce((sum, item) => sum + (item.counts?.variants || 0), 0);
  const totalColors = models.reduce((sum, item) => sum + (item.counts?.colors || 0), 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="cfg-hero-panel rounded-[32px] px-6 py-6 sm:px-7">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className="rounded-full px-3 py-1 text-[10px] font-semibold tracking-[0.28em] uppercase"
              style={{
                background: hexToRgba(previewModel.accent, 0.12),
                color: previewModel.secondaryAccent,
              }}
            >
              XPENG 配置中心
            </span>
            <span className="text-[11px] text-white/96">全系车型一页进入</span>
          </div>

          <div className="mt-6 max-w-2xl">
            <p className="text-sm uppercase tracking-[0.34em] text-[#ffe3cf]">XPENG Product Configurator</p>
            <h2 className="mt-3 text-4xl font-semibold leading-tight text-white sm:text-5xl">
              小鹏全系配置中心
            </h2>
            <p className="mt-4 max-w-xl text-sm leading-7 text-white sm:text-base">
              所有已接入配置快照的车型都会在这里集中展示。先选车，再完成版本、颜色、内饰和套件，
              最后直接生成一份清晰的配置摘要。
            </p>
          </div>

          <div className="mt-7 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => onAction(`我想配置 ${previewModel.name}`)}
              className="rounded-full px-5 py-3 text-sm font-semibold text-[#0b0d12] transition disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                background: `linear-gradient(135deg, ${previewModel.secondaryAccent}, ${previewModel.accent})`,
              }}
            >
              进入 {previewModel.name} 配置器
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onAction("按预算和场景推荐一款适合我的小鹏车型")}
              className="rounded-full border border-white/18 bg-white/9 px-5 py-3 text-sm font-semibold text-white transition hover:border-white/24 hover:bg-white/12 disabled:cursor-not-allowed disabled:opacity-50"
            >
              先让顾问推荐
            </button>
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            {[
              { label: "车型数量", value: `${models.length} 款`, note: "覆盖项目当前主车型" },
              { label: "版本总数", value: `${totalVariants || "多"} 个`, note: "基于公开配置快照整理" },
              { label: "颜色选项", value: `${totalColors || "多"} 项`, note: "外观与内饰可逐步选择" },
            ].map((item) => (
              <div key={item.label} className="cfg-data-tile rounded-[24px] px-4 py-4">
                <p className="text-[11px] uppercase tracking-[0.2em] text-white/90">{item.label}</p>
                <p className="mt-2 text-2xl font-semibold text-white">{item.value}</p>
                <p className="mt-2 text-xs leading-6 text-white/96">{item.note}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <CarStage
            model={previewModel.name}
            variant={previewModel.tagline}
            selectedColor={null}
            selectedInterior={null}
            busy={busy}
            showroomModels={models}
          />
          <div className="cfg-glass rounded-[28px] px-5 py-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.24em] text-white/90">当前焦点</p>
                <p className="mt-2 text-xl font-semibold text-white">{previewModel.name}</p>
              </div>
              <span
                className="rounded-full px-3 py-1.5 text-[10px] font-semibold tracking-[0.22em] uppercase"
                style={{
                  background: hexToRgba(previewModel.accent, 0.12),
                  color: previewModel.secondaryAccent,
                }}
              >
                {previewModel.highlightLabel}
              </span>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-[20px] border border-white/10 bg-white/7 px-4 py-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/90">售价起点</p>
                <p className="mt-2 text-2xl font-semibold text-white">{previewModel.priceLabel}</p>
                <p className="mt-2 text-xs text-white/96">{previewModel.statsLabel}</p>
              </div>
              <div className="rounded-[20px] border border-white/10 bg-white/7 px-4 py-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/90">适合场景</p>
                <p className="mt-2 text-base font-semibold text-white">{previewModel.tagline}</p>
                <p className="mt-2 text-xs leading-6 text-white/96">{previewModel.highlight}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.3em] text-white/88">车型矩阵</p>
            <p className="mt-2 text-xl font-semibold text-white">从这里进入任意车型配置流程</p>
          </div>
          <p className="max-w-xl text-sm leading-6 text-white/96">
            每张卡片只展示对应车型的干净车身图。悬停会切换舞台预览，点击后直接进入该车型配置流程。
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {models.map((item) => {
            const active = previewModel.key === item.key;
            return (
              <button
                key={item.key}
                type="button"
                disabled={busy}
                onMouseEnter={() => onPreview(item.key)}
                onFocus={() => onPreview(item.key)}
                onClick={() => onAction(`我想配置 ${item.name}`)}
                className={[
                  "cfg-showroom-card rounded-[28px] px-4 py-4 text-left transition-transform duration-300 disabled:cursor-not-allowed disabled:opacity-50",
                  active ? "cfg-showroom-card-active translate-y-[-2px]" : "",
                ].join(" ")}
                style={{
                  borderColor: active ? hexToRgba(item.accent, 0.48) : undefined,
                }}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] uppercase tracking-[0.18em] text-white/90">{item.bodyType}</span>
                  <span className="text-[11px] text-white">{item.priceLabel}</span>
                </div>
                <ModelPhoto model={item} className="mt-4 h-28 w-full" loading={active ? "eager" : "lazy"} />
                <p className="mt-4 text-lg font-semibold text-white">{item.name}</p>
                <p className="mt-1 text-sm text-white/96">{item.tagline}</p>
                <div className="mt-4 space-y-2 text-[12px] text-white/95">
                  <div className="flex items-center justify-between">
                    <span>续航</span>
                    <span>{item.rangeLabel}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>座位</span>
                    <span>{item.seatsLabel}</span>
                  </div>
                  {item.counts ? (
                    <div className="flex items-center justify-between">
                      <span>配置规模</span>
                      <span>{item.counts.variants} 版 / {item.counts.colors} 色</span>
                    </div>
                  ) : null}
                </div>
                <div className="mt-4 rounded-[18px] border border-white/10 bg-white/7 px-3 py-3">
                  <p className="text-xs leading-6 text-white/96">{item.highlight}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ChoiceGrid({
  step,
  choices,
  selected,
  busy,
  onAction,
  showroomModels,
}: {
  step: StepKey;
  choices: ConfiguratorChoicesPayload | null;
  selected: ReturnType<typeof buildStepStatus>;
  busy: boolean;
  onAction: (text: string) => void;
  showroomModels: ShowroomModel[];
}) {
  if (!choices) {
    return (
      <div className="cfg-glass rounded-[28px] px-5 py-6 text-center">
        <div className="ai-shimmer mx-auto h-3 w-40 rounded-full" />
        <p className="mt-3 text-xs text-white/92">正在载入可选项...</p>
      </div>
    );
  }

  if (step === "车型") {
    const models = showroomModels.length ? showroomModels : getShowroomModels(choices.models);
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {models.map((item) => {
          const isSelected = selected.model === item.name;
          return (
            <button
              key={item.key}
              type="button"
              disabled={busy}
              onClick={() => onAction(`我想配置 ${item.name}`)}
              className={`cfg-showroom-card rounded-[26px] px-4 py-4 text-left disabled:cursor-not-allowed disabled:opacity-50 ${isSelected ? "cfg-showroom-card-active" : ""}`}
              style={{ borderColor: isSelected ? hexToRgba(item.accent, 0.48) : undefined }}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] uppercase tracking-[0.18em] text-white/90">{item.bodyType}</span>
                <span className="text-[11px] text-white">{item.priceLabel}</span>
              </div>
              <ModelPhoto model={item} className="mt-4 h-24 w-full" loading={isSelected ? "eager" : "lazy"} />
              <p className="mt-4 text-lg font-semibold text-white">{item.name}</p>
              <p className="mt-1 text-sm text-white/96">{item.tagline}</p>
              <p className="mt-3 text-xs leading-6 text-white/96">{item.highlight}</p>
            </button>
          );
        })}
      </div>
    );
  }

  if (step === "版本") {
    if (!choices.variants.length) {
      return (
        <div className="cfg-glass rounded-[28px] px-5 py-6 text-center">
          <p className="text-xs text-white/92">当前车型暂无版本快照。</p>
        </div>
      );
    }
    const activeModel = resolveShowroomModel(selected.model, showroomModels);
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {choices.variants.map((item) => {
          const isSelected = selected.variant === item.name;
          return (
            <button
              key={item.name}
              type="button"
              disabled={busy}
              onClick={() => onAction(`选择 ${item.name}`)}
              className={`cfg-showroom-card rounded-[26px] px-4 py-4 text-left disabled:cursor-not-allowed disabled:opacity-50 ${isSelected ? "cfg-showroom-card-active" : ""}`}
              style={{
                borderColor: isSelected && activeModel ? hexToRgba(activeModel.accent, 0.48) : undefined,
              }}
            >
              <p className="text-[11px] uppercase tracking-[0.18em] text-white/90">版本选择</p>
              <p className="mt-3 text-lg font-semibold text-white">{item.name}</p>
              <p className="mt-3 text-2xl font-semibold text-[#ffb16e]">{formatPrice(item.price)}</p>
              {item.highlight ? (
                <p className="mt-4 text-sm leading-6 text-white/96">{item.highlight}</p>
              ) : null}
            </button>
          );
        })}
      </div>
    );
  }

  if (step === "外观颜色") {
    const activeRestrictionNotes = choices.activeRestrictionNotes || choices.restrictionNotes || [];
    return (
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {choices.colors.map((item) => {
            const isSelected = selected.color === item.name;
            const hex = resolveColorHex(item.name) || "#666666";
            return (
              <button
                key={item.name}
                type="button"
                disabled={busy}
                onClick={() => onAction(`外观选 ${item.name}`)}
                className={`cfg-showroom-card rounded-[24px] px-4 py-4 text-left disabled:cursor-not-allowed disabled:opacity-50 ${isSelected ? "cfg-showroom-card-active" : ""}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="cfg-color-swatch h-10 w-10" style={{ background: hex }} />
                  <span className="text-[11px] text-white">{formatPremium(item.premium)}</span>
                </div>
                <p className="mt-5 text-base font-semibold text-white">{item.name}</p>
                <p className="mt-2 text-xs text-white/94">{item.premium ? "特殊车漆" : "标准车漆"}</p>
                {item.allowedInteriors?.length ? (
                  <p className="mt-3 text-xs leading-5 text-[#ffd2b3]/76">
                    仅支持 {item.allowedInteriors.join(" / ")} 主题
                  </p>
                ) : null}
              </button>
            );
          })}
        </div>
        <div className="cfg-glass rounded-[26px] px-5 py-5">
          <p className="text-[11px] uppercase tracking-[0.18em] text-white/90">颜色策略</p>
          <p className="mt-3 text-lg font-semibold text-white">先定基调，再定版本形象</p>
          <p className="mt-3 text-sm leading-7 text-white/96">
            当前舞台会跟随所选颜色改变氛围光。后续如果你补 3D 或多角度 PNG 序列，
            这里就能无缝升级成更接近官网的实时换色体验。
          </p>
          <RestrictionNotesPanel notes={activeRestrictionNotes.slice(0, 2)} title="当前颜色限制" />
        </div>
      </div>
    );
  }

  if (step === "内饰") {
    return (
      <div className="space-y-4">
        <RestrictionNotesPanel notes={(choices.activeRestrictionNotes || choices.restrictionNotes || []).slice(0, 2)} title="当前内饰限制" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {choices.interiors.map((item) => {
            const isSelected = selected.interior === item.name;
            const hex = resolveInteriorHex(item.name) || "#444444";
            return (
              <button
                key={item.name}
                type="button"
                disabled={busy}
                onClick={() => onAction(`内饰选 ${item.name}`)}
                className={`cfg-showroom-card rounded-[24px] px-4 py-4 text-left disabled:cursor-not-allowed disabled:opacity-50 ${isSelected ? "cfg-showroom-card-active" : ""}`}
              >
                <div
                  className="h-28 rounded-[22px] border border-white/8"
                  style={{
                    background: `linear-gradient(145deg, ${hexToRgba(hex, 0.94)}, ${hexToRgba(hex, 0.58)})`,
                  }}
                />
                <p className="mt-4 text-base font-semibold text-white">{item.name.replace("内饰", "")}</p>
                <p className="mt-2 text-[11px] text-white">{formatPremium(item.premium)}</p>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (step === "套件") {
    if (!choices.packages.length) {
      return (
        <div className="cfg-glass rounded-[28px] px-5 py-6 text-center">
          <p className="text-xs text-white/92">当前车型暂无可选套件。</p>
        </div>
      );
    }
    const selectedPacks = new Set(selected.packages);
    return (
      <div className="space-y-3">
        {choices.packages.map((item) => {
          const isSelected = selectedPacks.has(item.name);
          const isBlocked = !isSelected && Boolean(item.conflictsWith?.some((conflict) => selectedPacks.has(conflict)));
          return (
            <button
              key={item.name}
              type="button"
              disabled={busy || isBlocked}
              onClick={() => onAction(isSelected ? `不要 ${item.name}` : `加上 ${item.name}`)}
              className={`cfg-showroom-card w-full rounded-[24px] px-4 py-4 text-left disabled:cursor-not-allowed disabled:opacity-50 ${isSelected ? "cfg-showroom-card-active" : ""}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-base font-semibold text-white">{item.name}</p>
                  {item.desc ? <p className="mt-2 max-w-2xl text-sm leading-6 text-white/96">{item.desc}</p> : null}
                  {item.conflictsWith?.length ? (
                    <p className="mt-3 text-xs leading-5 text-[#ffd2b3]/76">
                      与 {item.conflictsWith.join(" / ")} 互斥
                    </p>
                  ) : null}
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold text-[#ffb16e]">{formatPrice(item.price)}</p>
                  <p className="mt-2 text-[11px] text-white/94">
                    {isSelected ? "已加入" : isBlocked ? "受互斥规则限制" : "点击添加"}
                  </p>
                </div>
              </div>
            </button>
          );
        })}
        <RestrictionNotesPanel notes={(choices.activeRestrictionNotes || choices.restrictionNotes || []).slice(0, 3)} title="套件规则" />
        <div className="flex flex-wrap gap-3 pt-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onAction("先不加装，直接出配置单")}
            className="rounded-full border border-white/16 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white transition hover:border-white/20 hover:bg-white/14 disabled:cursor-not-allowed disabled:opacity-50"
          >
            先不加装，直接出配置单
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onAction("生成配置单")}
            className="rounded-full bg-gradient-to-r from-[#f49b53] to-[#ff7b36] px-4 py-2.5 text-sm font-semibold text-[#0b0d12] transition disabled:cursor-not-allowed disabled:opacity-50"
          >
            生成配置单
          </button>
        </div>
      </div>
    );
  }

  return null;
}

function RestrictionNotesPanel({
  notes,
  title = "官方限制提示",
}: {
  notes: string[];
  title?: string;
}) {
  const cleanedNotes = sanitizeConfiguratorNotes(notes);
  if (!cleanedNotes.length) return null;
  return (
    <div className="rounded-[22px] border border-[#f0b06d]/60 bg-[linear-gradient(135deg,rgba(255,245,232,0.98),rgba(255,238,216,0.92))] px-4 py-4 shadow-[0_18px_40px_-28px_rgba(240,133,37,0.45)]">
      <p className="text-[11px] uppercase tracking-[0.18em] text-[#8a3f10]">{title}</p>
      <div className="mt-3 space-y-2">
        {cleanedNotes.map((item) => (
          <p key={item} className="text-sm font-medium leading-6 text-[#5f2c10]">
            {item}
          </p>
        ))}
      </div>
    </div>
  );
}

function SummaryPanel({
  state,
  choices,
}: {
  state: ConfiguratorStructured | null;
  choices: ConfiguratorChoicesPayload | null;
}) {
  const selected = buildStepStatus(state, choices);
  const restrictionNotes = getRestrictionNotes(choices, state);
  return (
    <div className="space-y-4">
      <div className="cfg-glass-highlight rounded-[26px] px-5 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-white/90">配置摘要</p>
            <p className="mt-2 text-xl font-semibold text-white">{selected.model || "已完成配置整理"}</p>
          </div>
          {state?.estimatedPrice ? (
            <div className="rounded-[20px] border border-emerald-400/18 bg-emerald-400/8 px-4 py-3 text-right">
              <p className="text-[11px] uppercase tracking-[0.18em] text-emerald-100/88">预计价格</p>
              <p className="cfg-price-badge mt-2 text-2xl font-semibold text-emerald-50">{state.estimatedPrice}</p>
            </div>
          ) : null}
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {[
            { label: "车型", value: selected.model },
            { label: "版本", value: selected.variant },
            { label: "外观", value: selected.color },
            { label: "内饰", value: selected.interior },
          ].map((item) => (
            <div key={item.label} className="rounded-[18px] border border-white/10 bg-white/8 px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-white/90">{item.label}</p>
              <p className="mt-2 text-base font-semibold text-white">{item.value || "待确认"}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-[18px] border border-white/10 bg-white/8 px-4 py-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-white/90">套件</p>
          {selected.packages.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {selected.packages.map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-sky-300/18 bg-sky-300/8 px-3 py-1.5 text-xs font-semibold text-sky-100/84"
                >
                  {item}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-white/96">未加装套件</p>
          )}
        </div>

        {false && selected.done && state?.estimatedPrice ? (
          <div className="mt-4 rounded-[22px] border border-emerald-300/35 bg-[linear-gradient(135deg,rgba(16,185,129,0.18),rgba(5,150,105,0.1))] px-4 py-4">
            <p className="text-[11px] uppercase tracking-[0.18em] text-emerald-100/90">閰嶇疆宸插畬鎴?</p>
            <p className="mt-2 text-sm text-emerald-50/90">褰撳墠杩欏彴杞︾殑閰嶇疆鎬讳环</p>
            <p className="cfg-price-badge mt-3 text-3xl font-semibold text-emerald-50">{state?.estimatedPrice}</p>
          </div>
        ) : null}

        {selected.done && state?.estimatedPrice ? (
          <div className="mt-4 rounded-[22px] border border-emerald-300/35 bg-[linear-gradient(135deg,rgba(16,185,129,0.18),rgba(5,150,105,0.1))] px-4 py-4">
            <p className="text-[11px] uppercase tracking-[0.18em] text-emerald-100/90">{"\u914d\u7f6e\u5df2\u5b8c\u6210"}</p>
            <p className="mt-2 text-sm text-emerald-50/90">{"\u5f53\u524d\u8fd9\u53f0\u8f66\u7684\u914d\u7f6e\u603b\u4ef7"}</p>
            <p className="cfg-price-badge mt-3 text-3xl font-semibold text-emerald-50">{state.estimatedPrice}</p>
          </div>
        ) : null}

        {state?.estimatedPriceNote ? (
          <p className="mt-4 text-xs leading-6 text-white/96">{state.estimatedPriceNote}</p>
        ) : null}
      </div>

      <RestrictionNotesPanel notes={restrictionNotes} />

      {state?.summary_text ? (
        <div className="cfg-glass rounded-[26px] px-5 py-5">
          <p className="text-[11px] uppercase tracking-[0.18em] text-white/90">可复制配置单</p>
          <p className="mt-4 whitespace-pre-line text-sm leading-7 text-white/96">{state.summary_text}</p>
        </div>
      ) : null}
    </div>
  );
}

function ProgressSidebar({
  selected,
  state,
  choices,
  showroomModel,
}: {
  selected: ReturnType<typeof buildStepStatus>;
  state: ConfiguratorStructured | null;
  choices: ConfiguratorChoicesPayload | null;
  showroomModel: ShowroomModel | null;
}) {
  const restrictionNotes = getRestrictionNotes(choices, state);
  return (
    <div className="space-y-4">
      <div className="cfg-glass rounded-[24px] px-5 py-5">
        <p className="text-[11px] uppercase tracking-[0.18em] text-white/90">配置进度</p>
        <div className="mt-4 space-y-3">
          {[
            { label: "车型", value: selected.model },
            { label: "版本", value: selected.variant },
            { label: "外观", value: selected.color },
            { label: "内饰", value: selected.interior },
          ].map((item) => (
            <div key={item.label} className="flex items-center justify-between gap-4">
              <span className="text-[11px] uppercase tracking-[0.16em] text-white/88">{item.label}</span>
              <span className="text-sm text-white/96">{item.value || "待选"}</span>
            </div>
          ))}

          <div className="border-t border-white/8 pt-3">
            <p className="text-[11px] uppercase tracking-[0.16em] text-white/88">套件数量</p>
            <p className="mt-2 text-base font-semibold text-white">{selected.packages.length} 项</p>
          </div>

          {state?.estimatedPrice ? (
            <div className="rounded-[18px] border border-emerald-400/18 bg-emerald-400/8 px-4 py-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-emerald-100/88">预计价格</p>
              <p className="mt-2 text-2xl font-semibold text-emerald-50">{state.estimatedPrice}</p>
            </div>
          ) : null}
        </div>
      </div>

      {showroomModel ? (
        <div className="cfg-glass rounded-[24px] px-5 py-5">
          <p className="text-[11px] uppercase tracking-[0.18em] text-white/90">车型标签</p>
          <p className="mt-3 text-lg font-semibold text-white">{showroomModel.name}</p>
          <p className="mt-2 text-sm leading-6 text-white/96">{showroomModel.highlight}</p>
          <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-white/96">
            <span className="rounded-full border border-white/10 bg-white/8 px-3 py-1.5">{showroomModel.bodyType}</span>
            <span className="rounded-full border border-white/10 bg-white/8 px-3 py-1.5">{showroomModel.rangeLabel}</span>
            <span className="rounded-full border border-white/10 bg-white/8 px-3 py-1.5">{showroomModel.seatsLabel}</span>
          </div>
        </div>
      ) : null}

      <RestrictionNotesPanel notes={restrictionNotes.slice(0, 2)} title="搭配限制" />
    </div>
  );
}

export function ConfiguratorWizard({
  state,
  choices,
  busy,
  onAction,
  onReset,
  onBookTestDrive,
  onAdvisorFollowup,
}: Props) {
  const effectiveChoices = useMemo(
    () => resolveConfiguratorChoices(choices, state),
    [choices, state]
  );
  const selected = useMemo(
    () => buildStepStatus(state, effectiveChoices),
    [effectiveChoices, state]
  );
  const showroomModels = useMemo(
    () => getShowroomModels(effectiveChoices?.models || null),
    [effectiveChoices?.models]
  );
  const [previewKey, setPreviewKey] = useState(showroomModels[1]?.key || showroomModels[0]?.key || "G6");
  const previewTimerRef = useRef<number | null>(null);
  const deferredPreviewKey = useDeferredValue(previewKey);

  const handlePreview = useCallback((key: string) => {
    if (!key) return;
    if (previewTimerRef.current) {
      window.clearTimeout(previewTimerRef.current);
    }
    previewTimerRef.current = window.setTimeout(() => {
      startTransition(() => {
        setPreviewKey((current) => (current === key ? current : key));
      });
    }, 90);
  }, []);

  useEffect(() => {
    if (!showroomModels.some((item) => item.key === previewKey) && showroomModels[0]) {
      setPreviewKey(showroomModels[0].key);
    }
  }, [previewKey, showroomModels]);

  useEffect(() => {
    return () => {
      if (previewTimerRef.current) {
        window.clearTimeout(previewTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!selected.model) return;
    const next = resolveShowroomModel(selected.model, showroomModels);
    if (next && next.key !== previewKey) {
      setPreviewKey(next.key);
    }
  }, [previewKey, selected.model, showroomModels]);

  const previewModel = useMemo(
    () =>
      showroomModels.find((item) => item.key === deferredPreviewKey) ||
      resolveShowroomModel(selected.model, showroomModels) ||
      showroomModels[0],
    [deferredPreviewKey, selected.model, showroomModels]
  );

  const activeModel = useMemo(
    () =>
      resolveShowroomModel(selected.model, showroomModels) ||
      previewModel ||
      showroomModels[0] ||
      null,
    [previewModel, selected.model, showroomModels]
  );
  const selectedCarName = selected.model || activeModel?.name;

  const currentIndex = selected.steps.indexOf(selected.current);
  const previousStep = currentIndex > 0 ? selected.steps[currentIndex - 1] : null;
  const backAction = useMemo(
    () =>
      previousStep && previousStep !== "配置摘要"
        ? STEP_BACK_ACTIONS[previousStep]
        : null,
    [previousStep]
  );
  const progressPercent = useMemo(() => {
    if (selected.done) return 100;
    const requiredSteps = selected.steps.filter((item) => item !== "配置摘要");
    const completed = requiredSteps.filter((item) => {
      if (item === "车型") return Boolean(selected.model);
      if (item === "版本") return Boolean(selected.variant);
      if (item === "外观颜色") return Boolean(selected.color);
      if (item === "内饰") return Boolean(selected.interior);
      if (item === "套件") return Boolean(selected.packages.length);
      return false;
    }).length;
    return Math.round((completed / Math.max(requiredSteps.length, 1)) * 100);
  }, [selected]);

  if (!state && previewModel) {
    return (
      <section className="cfg-scene overflow-hidden rounded-[34px] px-4 py-5 sm:px-6 sm:py-6">
        <ShowroomLanding
          models={showroomModels}
          previewModel={previewModel}
          busy={busy}
          onAction={onAction}
          onPreview={handlePreview}
        />
      </section>
    );
  }

  return (
    <section className="cfg-scene overflow-hidden rounded-[34px] px-4 py-5 sm:px-6 sm:py-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.34em] text-[#4b3528]">XPENG Configurator</p>
          <h2 className="mt-3 text-3xl font-semibold text-[#1b120d] sm:text-4xl">
            {selected.model || "全系配置器"}
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-[#38241b]">
            车型卡片只保留对应车型的干净车身图；中央舞台聚焦当前配置状态，不再混入整页官网素材。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="rounded-full border border-[#b88d73]/26 bg-white/74 px-4 py-2 text-[11px] text-[#5b4438]">
            当前阶段 {selected.done ? "配置完成" : selected.current}
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onReset}
            className="rounded-full border border-[#b88d73]/26 bg-white/74 px-4 py-2 text-sm font-semibold text-[#412e24] transition hover:border-[#c58a67]/36 hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            重新开始
          </button>
        </div>
      </div>

      <div className="mt-6">
        <ModelRail
          models={showroomModels}
          activeModel={activeModel}
          busy={busy}
          onAction={onAction}
          onPreview={handlePreview}
        />
      </div>

      <div className="mt-6">
        <StepNav current={selected.current} steps={selected.steps} selected={selected} busy={busy} onAction={onAction} />
        <div className="mt-3 h-[3px] overflow-hidden rounded-full bg-white/6">
          <div className="cfg-progress-bar h-full rounded-full" style={{ width: `${progressPercent}%` }} />
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <CarStage
            model={selected.model}
            variant={selected.variant}
            selectedColor={selected.color}
            selectedInterior={selected.interior}
            selectedPackages={selected.packages}
            busy={busy}
            showroomModels={showroomModels}
          />

          <div className="cfg-glass rounded-[28px] px-5 py-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.22em] text-white/90">
                  {selected.done ? "配置摘要" : `选择${selected.current}`}
                </p>
                <p className="mt-2 text-xl font-semibold text-white">
                  {selected.done ? "已完成配置整理" : activeModel?.tagline || "继续完成选配"}
                </p>
              </div>
              {activeModel ? (
                <span
                  className="rounded-full px-3 py-1.5 text-[10px] font-semibold tracking-[0.22em] uppercase"
                  style={{
                    background: hexToRgba(activeModel.accent, 0.12),
                    color: activeModel.secondaryAccent,
                  }}
                >
                  {activeModel.highlightLabel}
                </span>
              ) : null}
            </div>

            <div className="mt-5">
              {selected.done || selected.current === "配置摘要" ? (
                <SummaryPanel state={state} choices={effectiveChoices} />
              ) : (
                <ChoiceGrid
                  step={selected.current}
                  choices={effectiveChoices}
                  selected={selected}
                  busy={busy}
                  onAction={onAction}
                  showroomModels={showroomModels}
                />
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {backAction ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => onAction(backAction)}
                className="rounded-full border border-[#b77855]/40 bg-[#fff5ec] px-4 py-2.5 text-sm font-semibold text-[#6d3419] transition hover:border-[#b77855]/70 hover:bg-[#ffe9d8] disabled:cursor-not-allowed disabled:opacity-50"
              >
                返回上一步
              </button>
            ) : null}

            {(selected.current === "套件" || selected.current === "配置摘要") && !selected.done ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => onAction("生成配置单")}
                className="rounded-full bg-gradient-to-r from-[#f49b53] to-[#ff7b36] px-5 py-2.5 text-sm font-semibold text-[#0b0d12] transition disabled:cursor-not-allowed disabled:opacity-50"
              >
                生成配置单
              </button>
            ) : null}

            {selected.done ? (
              <div className="flex flex-wrap items-center gap-3">
                <p className="rounded-full border border-[#8fb7ea]/35 bg-[#eef6ff] px-4 py-2.5 text-sm text-[#325b8f]">
                  配置已完成，如需继续推进，可让顾问按这套配置直接跟进。
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onBookTestDrive(selectedCarName)}
                  className="rounded-full bg-gradient-to-r from-sky-600 to-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:from-sky-500 hover:to-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  预约试驾
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onAdvisorFollowup(selectedCarName)}
                  className="rounded-full border border-[#5c8bd6]/28 bg-[#eaf3ff] px-5 py-2.5 text-sm font-semibold text-[#15407d] transition hover:border-[#5c8bd6]/46 hover:bg-[#dcecff] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  让顾问跟进
                </button>
              </div>
            ) : null}
          </div>

        </div>

        <aside className="space-y-4">
          <ProgressSidebar selected={selected} state={state} choices={effectiveChoices} showroomModel={activeModel} />
        </aside>
      </div>
    </section>
  );
}
