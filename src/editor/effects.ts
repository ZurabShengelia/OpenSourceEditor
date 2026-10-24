export interface EffectDef { key: string; label: string; min: number; max: number; def: number; step: number; css: (v: number) => string }

export const EFFECT_DEFS = [
  { key: "brightness", label: "Brightness", min: 0, max: 200, def: 100, step: 1, css: (v) => `brightness(${v}%)` },
  { key: "contrast", label: "Contrast", min: 0, max: 200, def: 100, step: 1, css: (v) => `contrast(${v}%)` },
  { key: "saturation", label: "Saturation", min: 0, max: 300, def: 100, step: 1, css: (v) => `saturate(${v}%)` },
  { key: "hue", label: "Hue rotate", min: -180, max: 180, def: 0, step: 1, css: (v) => `hue-rotate(${v}deg)` },
  { key: "grayscale", label: "Grayscale", min: 0, max: 100, def: 0, step: 1, css: (v) => `grayscale(${v}%)` },
  { key: "sepia", label: "Sepia", min: 0, max: 100, def: 0, step: 1, css: (v) => `sepia(${v}%)` },
  { key: "invert", label: "Invert", min: 0, max: 100, def: 0, step: 1, css: (v) => `invert(${v}%)` },
  { key: "blur", label: "Blur (px)", min: 0, max: 20, def: 0, step: 0.5, css: (v) => `blur(${v}px)` },
  { key: "exposure", label: "Exposure (EV)", min: -3, max: 3, def: 0, step: 0.05, css: (v) => (v === 0 ? "" : `brightness(${100 * 2 ** v}%)`) },
  { key: "sharpen", label: "Sharpen", min: 0, max: 100, def: 0, step: 1, css: () => "" },
  { key: "temperature", label: "Temperature", min: -100, max: 100, def: 0, step: 1, css: () => "" },
  { key: "tint", label: "Tint", min: -100, max: 100, def: 0, step: 1, css: () => "" },
  { key: "highlights", label: "Highlights", min: -100, max: 100, def: 0, step: 1, css: () => "" },
  { key: "shadows", label: "Shadows", min: -100, max: 100, def: 0, step: 1, css: () => "" },
  { key: "whites", label: "Whites", min: -100, max: 100, def: 0, step: 1, css: () => "" },
  { key: "blacks", label: "Blacks", min: -100, max: 100, def: 0, step: 1, css: () => "" },
  { key: "vignette", label: "Vignette", min: 0, max: 100, def: 0, step: 1, css: () => "" },
  { key: "film", label: "Film grain", min: 0, max: 100, def: 0, step: 1, css: () => "" },
  { key: "vintage", label: "Vintage", min: 0, max: 100, def: 0, step: 1, css: () => "" },
  { key: "glow", label: "Glow", min: 0, max: 100, def: 0, step: 1, css: () => "" },
  { key: "distortion", label: "Distortion", min: -100, max: 100, def: 0, step: 1, css: () => "" },
  { key: "chromatic", label: "Chromatic aberration", min: 0, max: 100, def: 0, step: 1, css: () => "" },
] as const satisfies readonly EffectDef[];

export const EFFECT_GROUPS: readonly { label: string; keys: readonly EffectKey[] }[] = [
  { label: "Basic", keys: ["brightness", "contrast", "saturation", "exposure", "hue", "grayscale", "sepia", "invert", "blur", "sharpen"] },
  { label: "Color", keys: ["temperature", "tint", "highlights", "shadows", "whites", "blacks"] },
  { label: "Creative", keys: ["vignette", "film", "vintage", "glow", "distortion", "chromatic"] },
];
export const PIXEL_KEYS = ["sharpen", "temperature", "tint", "highlights", "shadows", "whites", "blacks", "vignette", "film", "vintage", "glow", "distortion", "chromatic"] as const;

export type EffectKey = (typeof EFFECT_DEFS)[number]["key"];
export type Filters = { [K in EffectKey]: number };

export const DEFAULT_FILTERS = Object.fromEntries(EFFECT_DEFS.map((d) => [d.key, d.def])) as Filters;
export const filterCss = (f: Filters): string => EFFECT_DEFS.filter((d) => f[d.key] !== d.def).map((d) => d.css(f[d.key])).filter(Boolean).join(" ") || "none";
export const hasPixelEffects = (f: Filters): boolean => PIXEL_KEYS.some((k) => f[k] !== 0);
export const resetFilters = (): Filters => ({ ...DEFAULT_FILTERS });
