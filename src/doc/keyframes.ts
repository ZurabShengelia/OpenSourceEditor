import type { AnimProp, Ease, Keyframe, Keyframes, TClip } from "./schema";

const ease = (e: Ease, p: number): number => (e === "hold" ? 0 : e === "easeInOut" ? p * p * (3 - 2 * p) : p);

export function evalKeyframes(kfs: readonly Keyframe[] | undefined, t: number, base: number): number {
  if (!kfs || kfs.length === 0) return base;
  const k = [...kfs].sort((a, b) => a.t - b.t);
  const first = k[0]!, last = k[k.length - 1]!;
  if (t <= first.t) return first.v;
  if (t >= last.t) return last.v;
  for (let i = 0; i < k.length - 1; i++) {
    const a = k[i]!, b = k[i + 1]!;
    if (t >= a.t && t < b.t) return a.v + (b.v - a.v) * ease(a.ease, (t - a.t) / (b.t - a.t));
  }
  return last.v;
}

export function baseValue(c: TClip, p: AnimProp): number { return p === "volume" ? c.volume : c.transform[p]; }
export const valueAt = (c: TClip, p: AnimProp, localT: number): number => evalKeyframes(c.keyframes[p], localT, baseValue(c, p));

export function setKeyframe(kf: Keyframes, p: AnimProp, k: Keyframe): Keyframes {
  const rest = (kf[p] ?? []).filter((x) => Math.abs(x.t - k.t) > 1e-3 && x.id !== k.id);
  return { ...kf, [p]: [...rest, k].sort((a, b) => a.t - b.t) };
}
export function deleteKeyframe(kf: Keyframes, p: AnimProp, id: string): Keyframes {
  const next = (kf[p] ?? []).filter((x) => x.id !== id);
  const { [p]: _drop, ...others } = kf; void _drop;
  return next.length ? { ...others, [p]: next } : others;
}
export function moveKeyframe(kf: Keyframes, p: AnimProp, id: string, t: number, dur: number): Keyframes {
  const list = kf[p] ?? []; const cur = list.find((x) => x.id === id); if (!cur) return kf;
  return setKeyframe(deleteKeyframe(kf, p, id), p, { ...cur, t: Math.min(Math.max(0, t), dur) });
}

export type AnimPreset = "fadeIn" | "fadeOut" | "slideUp" | "pop";
export const ANIM_PRESETS: readonly { id: AnimPreset; label: string }[] = [{ id: "fadeIn", label: "Fade in" }, { id: "fadeOut", label: "Fade out" }, { id: "slideUp", label: "Slide up" }, { id: "pop", label: "Pop" }];

export function applyPreset(kf: Keyframes, p: AnimPreset, c: Pick<TClip, "transform">, dur: number, newId: () => string): Keyframes {
  const d = Math.max(0.05, Math.min(0.6, dur / 2)), k = (t: number, v: number, e: Ease = "easeInOut"): Keyframe => ({ id: newId(), t, v, ease: e }); const T = c.transform;
  const set = (prop: AnimProp, list: Keyframe[]): void => { out[prop] = list; }; const out: Keyframes = { ...kf };
  if (p === "fadeIn") set("opacity", [k(0, 0), k(d, T.opacity, "linear")]);
  else if (p === "fadeOut") set("opacity", [k(Math.max(0, dur - d), T.opacity), k(dur, 0, "linear")]);
  else if (p === "slideUp") { set("y", [k(0, T.y + 0.08), k(d, T.y, "linear")]); set("opacity", [k(0, 0), k(d, T.opacity, "linear")]); }
  else { set("scale", [k(0, T.scale * 0.6), k(d * 0.6, T.scale * 1.06), k(d, T.scale, "linear")]); set("opacity", [k(0, 0), k(d * 0.4, T.opacity, "linear")]); }
  return out;
}
export const hasAnimation = (kf: Keyframes): boolean => Object.values(kf).some((l) => (l?.length ?? 0) > 0);
