import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const css = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
const tok = (name: string): string => { const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css); assert.ok(m, `token --${name}`); return m![1]!; };
const lum = (hex: string): number => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!; };
const ratio = (a: string, b: string): number => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };

test("text tokens reach WCAG AA (4.5:1) on every surface they are used on", () => {
  for (const bg of ["inset", "bg", "panel", "raised"]) for (const fg of ["text", "text-2", "muted", "accent", "cyan", "danger", "warn"]) assert.ok(ratio(tok(fg), tok(bg)) >= 4.5, `--${fg} on --${bg}: ${ratio(tok(fg), tok(bg)).toFixed(2)}`);
  for (const fg of ["text", "text-2", "accent", "cyan"]) assert.ok(ratio(tok(fg), tok("hover")) >= 4.5, `--${fg} on --hover`);
});
test("primary button text and non-text UI reach their thresholds", () => {
  assert.ok(ratio(tok("accent-ink"), tok("accent")) >= 4.5 && ratio(tok("accent-ink"), tok("accent-hi")) >= 4.5, "ink on emerald");
  assert.ok(ratio(tok("line-strong"), tok("panel")) >= 1.5, "visible separator"); assert.ok(ratio(tok("accent"), tok("panel")) >= 3, "focus ring / selection vs panel"); assert.ok(ratio(tok("faint"), tok("panel")) >= 3, "disabled/decorative text stays visible");
});
