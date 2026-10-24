export const BLEND_MODES = [
  { id: "source-over", label: "Normal" }, { id: "multiply", label: "Multiply" }, { id: "screen", label: "Screen" },
  { id: "overlay", label: "Overlay" }, { id: "darken", label: "Darken" }, { id: "lighten", label: "Lighten" },
  { id: "color-dodge", label: "Color dodge" }, { id: "color-burn", label: "Color burn" }, { id: "hard-light", label: "Hard light" },
  { id: "soft-light", label: "Soft light" }, { id: "difference", label: "Difference" }, { id: "exclusion", label: "Exclusion" },
  { id: "hue", label: "Hue" }, { id: "saturation", label: "Saturation" }, { id: "color", label: "Color" }, { id: "luminosity", label: "Luminosity" },
] as const;
export type BlendMode = (typeof BLEND_MODES)[number]["id"];
