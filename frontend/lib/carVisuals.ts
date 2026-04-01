const OFFICIAL_CAR_IMAGES: Array<{ keys: string[]; image: string }> = [
  { keys: ["MONA M03", "M03"], image: "/cars/official/m03-official.png" },
  { keys: ["P7+"], image: "/cars/official/p7plus-official.png" },
  { keys: ["P7I"], image: "/cars/official/p7-official-cover.png" },
  { keys: ["P7"], image: "/cars/official/p7-official-cover.png" },
  { keys: ["G9"], image: "/cars/official/g9-stage-default.png" },
  { keys: ["G7"], image: "/cars/official/g7-official-cover.png" },
  { keys: ["G6"], image: "/cars/official/g6-stage-default.png" },
  { keys: ["X9"], image: "/cars/official/x9-official-cover.png" },
];

function normalizeCarName(value: string): string {
  return String(value || "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[（）()\-_/.,，。]/g, "");
}

export function resolveOfficialCarImage(name?: string | null, fallback?: string | null): string | null {
  const normalized = normalizeCarName(name || "");
  for (const item of OFFICIAL_CAR_IMAGES) {
    if (item.keys.some((key) => normalized.includes(normalizeCarName(key)))) {
      return item.image;
    }
  }
  return fallback || null;
}
