import { FOREST_ASSETS, type ForestPlacement } from "@game/shared/forest";

export type GraphicsSettings = {
  viewDistance: number;
  resolution: "performance" | "standard" | "hd";
  shadows: boolean;
  foliage: 25 | 50 | 100;
};
export const GRAPHICS_STORAGE_KEY = "wakamation-graphics-v1";
export const GRAPHICS_PRESETS = {
  Low: { viewDistance: 30, resolution: "performance", shadows: false, foliage: 25 },
  Balanced: { viewDistance: 54, resolution: "standard", shadows: true, foliage: 100 },
  High: { viewDistance: 80, resolution: "hd", shadows: true, foliage: 100 },
} as const satisfies Record<string, GraphicsSettings>;
export const DEFAULT_GRAPHICS: GraphicsSettings = { ...GRAPHICS_PRESETS.Balanced };

export function normalizeGraphics(value: unknown): GraphicsSettings {
  const defaults = { ...DEFAULT_GRAPHICS };
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaults;
  const v = value as Record<string, unknown>;
  return {
    viewDistance: typeof v.viewDistance === "number" && Number.isFinite(v.viewDistance)
      ? Math.round(Math.max(30, Math.min(80, v.viewDistance))) : defaults.viewDistance,
    resolution: v.resolution === "performance" || v.resolution === "standard" || v.resolution === "hd" ? v.resolution : defaults.resolution,
    shadows: typeof v.shadows === "boolean" ? v.shadows : defaults.shadows,
    foliage: v.foliage === 25 || v.foliage === 50 || v.foliage === 100 ? v.foliage : defaults.foliage,
  };
}

export function graphicsPreset(settings: GraphicsSettings): keyof typeof GRAPHICS_PRESETS | "Custom" {
  for (const name of Object.keys(GRAPHICS_PRESETS) as (keyof typeof GRAPHICS_PRESETS)[]) {
    const p = GRAPHICS_PRESETS[name];
    if (p.viewDistance === settings.viewDistance && p.resolution === settings.resolution && p.shadows === settings.shadows && p.foliage === settings.foliage) return name;
  }
  return "Custom";
}

export function showForestPlacement(p: ForestPlacement, density: GraphicsSettings["foliage"]): boolean {
  if (FOREST_ASSETS[p.kind].blocking || density === 100) return true;
  let hash = 2166136261;
  const identity = `${p.kind}:${p.x}:${p.z}:${p.yaw}:${p.scale}`;
  for (let i = 0; i < identity.length; i++) hash = Math.imul(hash ^ identity.charCodeAt(i), 16777619);
  return (hash >>> 0) / 0x100000000 < density / 100;
}
