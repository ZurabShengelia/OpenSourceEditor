import type { TextProps } from "./schema";

export function textMetrics(p: TextProps): { lineHeight: number; tracking: number; shadowColor: string; shadowX: number; shadowY: number } {
  return { lineHeight: p.lineHeight ?? 1.2, tracking: p.tracking ?? 0, shadowColor: p.shadowColor ?? "#000000", shadowX: p.shadowX ?? 0, shadowY: p.shadowY ?? p.shadow / 3 };
}

export interface FontChoice { label: string; stack: string }
export const FONT_CHOICES: readonly FontChoice[] = [
  { label: "Inter / System Sans", stack: "Inter, system-ui, sans-serif" },
  { label: "Helvetica / Arial", stack: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
  { label: "Verdana", stack: "Verdana, Geneva, sans-serif" },
  { label: "Trebuchet", stack: "'Trebuchet MS', Tahoma, sans-serif" },
  { label: "Georgia", stack: "Georgia, serif" },
  { label: "Palatino", stack: "Palatino, 'Palatino Linotype', 'Book Antiqua', serif" },
  { label: "Times", stack: "'Times New Roman', Times, serif" },
  { label: "Courier / Mono", stack: "ui-monospace, 'Courier New', Menlo, monospace" },
  { label: "Impact", stack: "Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif" },
  { label: "Brush Script", stack: "'Brush Script MT', cursive" },
];
export const WEIGHTS: readonly (readonly [string, string])[] = [["300", "Light"], ["400", "Regular"], ["500", "Medium"], ["600", "Semibold"], ["700", "Bold"], ["900", "Black"]];
export const fontOptions = (current: string): (readonly [string, string])[] => {
  const base = FONT_CHOICES.map((f) => [f.stack, f.label] as const);
  return base.some(([v]) => v === current) ? base : [[current, current.split(",")[0]!.replace(/['"]/g, "").trim() || "Custom"] as const, ...base];
};
