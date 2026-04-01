import snapshot from "../configurator-snapshot.json";
import type {
  ConfiguratorChoicesPayload,
  ConfiguratorChoiceColor,
  ConfiguratorChoiceInterior,
  ConfiguratorChoiceModel,
  ConfiguratorChoicePackage,
  ConfiguratorChoiceVariant,
  ConfiguratorStructured,
} from "@/lib/types";

type SnapshotVariant = {
  name: string;
  price?: number | null;
  highlight?: string | null;
};

type SnapshotColor = {
  name: string;
  premium?: number;
  availableVariants?: string[];
  allowedInteriors?: string[];
};

type SnapshotInterior = {
  name: string;
  premium?: number;
  availableVariants?: string[];
};

type SnapshotPackage = {
  name: string;
  price?: number;
  desc?: string | null;
  items?: string[];
  availableVariants?: string[];
  conflictsWith?: string[];
};

type SnapshotModel = {
  key: string;
  brand?: string | null;
  displayName: string;
  source_url?: string | null;
  fetched_at?: string | null;
  version?: string | null;
  variants?: SnapshotVariant[];
  colors?: SnapshotColor[];
  interiors?: SnapshotInterior[];
  packages?: SnapshotPackage[];
  notes?: string[];
  restrictionNotes?: string[];
};

type SnapshotPayload = {
  meta?: {
    brand?: string;
    source_url?: string | null;
    fetched_at?: string | null;
    version?: string | null;
  };
  models?: SnapshotModel[];
};

const snapshotPayload = snapshot as SnapshotPayload;
const snapshotModels = Array.isArray(snapshotPayload.models) ? snapshotPayload.models : [];

function normalizeText(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[()（）\-_/·.,，。:：]/g, "");
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

function selectedModelName(state: ConfiguratorStructured | null) {
  return state?.model || state?.selectedModel || null;
}

function selectedVariantName(state: ConfiguratorStructured | null) {
  return state?.variant || state?.selectedVariant || null;
}

function selectedColorName(state: ConfiguratorStructured | null) {
  return state?.exteriorColor || state?.selectedColor || null;
}

function selectedInteriorName(state: ConfiguratorStructured | null) {
  return state?.interiorColor || state?.selectedInterior || null;
}

function selectedPackages(state: ConfiguratorStructured | null) {
  const packs = state?.packages || state?.selectedPackages || [];
  return Array.isArray(packs) ? packs : [];
}

function findModel(modelName: string | null): SnapshotModel | null {
  const normalized = normalizeText(modelName);
  if (!normalized) return null;
  return (
    snapshotModels.find((item) => normalized.includes(normalizeText(item.key))) ||
    snapshotModels.find((item) => normalized.includes(normalizeText(item.displayName))) ||
    null
  );
}

function isOptionAvailableForVariant(
  option:
    | ConfiguratorChoiceColor
    | ConfiguratorChoiceInterior
    | ConfiguratorChoicePackage
    | SnapshotColor
    | SnapshotInterior
    | SnapshotPackage,
  variant: string | null
) {
  const availableVariants = Array.isArray(option.availableVariants) ? option.availableVariants : [];
  if (!variant || !availableVariants.length) return true;
  return availableVariants.includes(variant);
}

function noteMentionsAll(line: string, parts: string[]) {
  const normalizedLine = normalizeText(line);
  return parts.every((part) => normalizedLine.includes(normalizeText(part)));
}

function getActiveRestrictionNotes(model: SnapshotModel | null, state: ConfiguratorStructured | null) {
  if (!model) return [];
  const notes = new Set<string>();
  const restrictionNotes = Array.isArray(model.restrictionNotes) ? model.restrictionNotes : [];
  const colorName = selectedColorName(state);
  const selectedColor = (model.colors || []).find((item) => item.name === colorName);

  if (selectedColor?.allowedInteriors?.length) {
    const matched = restrictionNotes.find((line) =>
      noteMentionsAll(line, [selectedColor.name, ...selectedColor.allowedInteriors!])
    );
    if (matched) notes.add(matched);
  }

  for (const packageName of selectedPackages(state)) {
    const pack = (model.packages || []).find((item) => item.name === packageName);
    for (const conflictName of pack?.conflictsWith || []) {
      const matched = restrictionNotes.find((line) => noteMentionsAll(line, [packageName, conflictName]));
      if (matched) notes.add(matched);
    }
  }

  return sanitizeConfiguratorNotes(Array.from(notes));
}

function buildModelChoices(): ConfiguratorChoiceModel[] {
  return snapshotModels.map((item) => ({
    key: item.key,
    name: item.displayName,
    brand: item.brand || snapshotPayload.meta?.brand || "小鹏",
    sourceUrl: item.source_url || snapshotPayload.meta?.source_url || null,
    fetchedAt: item.fetched_at || snapshotPayload.meta?.fetched_at || null,
    version: item.version || snapshotPayload.meta?.version || null,
    variants: Array.isArray(item.variants) ? item.variants.length : 0,
    colors: Array.isArray(item.colors) ? item.colors.length : 0,
    interiors: Array.isArray(item.interiors) ? item.interiors.length : 0,
    packages: Array.isArray(item.packages) ? item.packages.length : 0,
    highlight: item.variants?.[0]?.highlight || null,
    basePrice: item.variants?.[0]?.price ?? null,
  }));
}

export function buildConfiguratorFallbackChoices(
  state: ConfiguratorStructured | null
): ConfiguratorChoicesPayload | null {
  if (!snapshotModels.length) return null;

  const model = findModel(selectedModelName(state));
  const variant = selectedVariantName(state);
  const colorName = selectedColorName(state);
  const activeRestrictionNotes = getActiveRestrictionNotes(model, state);

  const colors = (model?.colors || []).filter((item) => isOptionAvailableForVariant(item, variant));
  const selectedColor = colors.find((item) => item.name === colorName) || null;
  const allowedInteriorNames = Array.isArray(selectedColor?.allowedInteriors)
    ? new Set(selectedColor.allowedInteriors)
    : null;
  const interiors = (model?.interiors || [])
    .filter((item) => isOptionAvailableForVariant(item, variant))
    .filter((item) => (allowedInteriorNames ? allowedInteriorNames.has(item.name) : true));
  const packages = (model?.packages || []).filter((item) => isOptionAvailableForVariant(item, variant));

  const variants: ConfiguratorChoiceVariant[] = (model?.variants || []).map((item) => ({
    name: item.name,
    price: item.price ?? null,
    highlight: item.highlight || null,
  }));

  return {
    models: buildModelChoices(),
    variants,
    colors: colors.map((item) => ({
      name: item.name,
      premium: item.premium ?? 0,
      availableVariants: Array.isArray(item.availableVariants) ? item.availableVariants : undefined,
      allowedInteriors: Array.isArray(item.allowedInteriors) ? item.allowedInteriors : undefined,
    })),
    interiors: interiors.map((item) => ({
      name: item.name,
      premium: item.premium ?? 0,
      availableVariants: Array.isArray(item.availableVariants) ? item.availableVariants : undefined,
    })),
    packages: packages.map((item) => ({
      name: item.name,
      price: item.price ?? 0,
      desc: item.desc || null,
      items: Array.isArray(item.items) ? item.items : undefined,
      availableVariants: Array.isArray(item.availableVariants) ? item.availableVariants : undefined,
      conflictsWith: Array.isArray(item.conflictsWith) ? item.conflictsWith : undefined,
    })),
    notes: sanitizeConfiguratorNotes(model?.notes),
    restrictionNotes: sanitizeConfiguratorNotes(model?.restrictionNotes),
    activeRestrictionNotes: sanitizeConfiguratorNotes(activeRestrictionNotes),
  };
}

export function resolveConfiguratorChoices(
  choices: ConfiguratorChoicesPayload | null,
  state: ConfiguratorStructured | null
): ConfiguratorChoicesPayload | null {
  const fallback = buildConfiguratorFallbackChoices(state);
  if (!choices) return fallback;
  if (!fallback) return choices;

  return {
    models: choices.models.length ? choices.models : fallback.models,
    variants: choices.variants.length ? choices.variants : fallback.variants,
    colors: choices.colors.length ? choices.colors : fallback.colors,
    interiors: choices.interiors.length ? choices.interiors : fallback.interiors,
    packages: choices.packages.length ? choices.packages : fallback.packages,
    notes: choices.notes?.length ? sanitizeConfiguratorNotes(choices.notes) : fallback.notes,
    restrictionNotes: choices.restrictionNotes?.length
      ? sanitizeConfiguratorNotes(choices.restrictionNotes)
      : fallback.restrictionNotes,
    activeRestrictionNotes: choices.activeRestrictionNotes?.length
      ? sanitizeConfiguratorNotes(choices.activeRestrictionNotes)
      : fallback.activeRestrictionNotes,
  };
}
