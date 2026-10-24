import { DEFAULT_FILTERS } from "../editor/effects";
import { MAX_CANVAS_SIDE, MAX_FPS, SCHEMA_VERSION, type GroupNode, type LayerNode, type MediaRef, type ProjectV2, type TClip, type TextProps, type Track } from "./schema";

export class ProjectError extends Error {}
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const num = (x: unknown, d: number): number => (typeof x === "number" && Number.isFinite(x) ? x : d);
const str = (x: unknown, d: string): string => (typeof x === "string" ? x : d);
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const filters = (x: unknown): typeof DEFAULT_FILTERS => {
  const out = { ...DEFAULT_FILTERS } as Record<string, number>;
  if (isObj(x)) for (const k of Object.keys(out)) out[k] = num(x[k], out[k] ?? 0);
  return out as typeof DEFAULT_FILTERS;
};
const textProps = (text: string, size: number, color: string, font = "Inter, system-ui, sans-serif", weight = 600): TextProps =>
  ({ text, font, size, weight, italic: false, align: "center", color, outline: 0, outlineColor: "#000000", shadow: 0 });

export const emptyTrack = (id: string, kind: Track["kind"], name: string): Track => ({ id, kind, name, muted: false, solo: false, locked: false, visible: true });
export function newProject(id: string, name: string): ProjectV2 {
  return { version: SCHEMA_VERSION, id, name, updatedAt: Date.now(), media: {},
    video: { fps: 30, width: 1280, height: 720, tracks: [emptyTrack("A1", "audio", "A1"), emptyTrack("V1", "video", "V1"), emptyTrack("T1", "text", "T1")], clips: {}, transitions: [] },
    photo: { width: 1280, height: 720, root: group("root", "Root", []) } };
}
export function group(id: string, name: string, children: LayerNode[]): GroupNode {
  return { kind: "group", id, name, visible: true, locked: false, opacity: 1, blend: "source-over", x: 0, y: 0, scale: 1, rotation: 0, children };
}

function fromV1(rec: Record<string, unknown>): ProjectV2 {
  const st = rec["state"]; if (!isObj(st)) throw new ProjectError("Project data is missing its editor state");
  const p = newProject(str(rec["id"], ""), str(rec["name"], "Untitled"));
  p.updatedAt = num(rec["updatedAt"], Date.now());
  const media: Record<string, MediaRef> = {};
  const ensure = (id: string, kind: MediaRef["kind"], name: string): void => { media[id] ??= { id, kind, name, mime: "" }; };
  const canvas = isObj(st["canvas"]) ? st["canvas"] : {};
  p.photo.width = Math.max(1, Math.min(MAX_CANVAS_SIDE, Math.round(num(canvas["w"], 1280)))); p.photo.height = Math.max(1, Math.min(MAX_CANVAS_SIDE, Math.round(num(canvas["h"], 720))));
  const children: LayerNode[] = [];
  for (const raw of arr(st["layers"])) {
    if (!isObj(raw)) continue;
    const base = { id: str(raw["id"], crypto.randomUUID()), name: str(raw["name"], "Layer"), visible: raw["visible"] !== false, locked: false,
      opacity: num(raw["opacity"], 1), blend: (typeof raw["blend"] === "string" ? raw["blend"] : "source-over") as GroupNode["blend"],
      x: num(raw["x"], 0), y: num(raw["y"], 0), scale: num(raw["scale"], 1), rotation: num(raw["rotation"], 0) };
    if (raw["kind"] === "image" && typeof raw["assetId"] === "string") { ensure(raw["assetId"], "image", base.name); children.push({ ...base, kind: "image", mediaId: raw["assetId"], filters: filters(raw["filters"]) }); }
    else if (raw["kind"] === "text") children.push({ ...base, kind: "text", props: textProps(str(raw["text"], ""), num(raw["size"], 48), str(raw["color"], "#ffffff"), str(raw["font"], "sans-serif"), num(raw["weight"], 600)), filters: filters(raw["filters"]) });
  }
  p.photo.root.children = children;
  const clips: Record<string, TClip> = {};
  const identity = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, noCrop = { l: 0, t: 0, r: 0, b: 0 };
  for (const raw of arr(st["clips"])) {
    if (!isObj(raw) || typeof raw["assetId"] !== "string") continue;
    const id = str(raw["id"], crypto.randomUUID()); ensure(raw["assetId"], "video", "Video");
    const srcStart = Math.max(0, num(raw["srcStart"], 0)), srcEnd = Math.max(srcStart, num(raw["srcEnd"], srcStart));
    clips[id] = { id, trackId: "V1", type: "media", mediaId: raw["assetId"], start: Math.max(0, num(raw["start"], 0)), srcStart, srcEnd,
      speed: Math.max(0.05, num(raw["speed"], 1)), volume: num(raw["volume"], 1), balance: 0, fadeIn: 0, fadeOut: 0, transform: { ...identity }, crop: { ...noCrop }, filters: filters(raw["filters"]), keyframes: {} };
  }
  for (const raw of arr(st["overlays"])) {
    if (!isObj(raw)) continue;
    const id = str(raw["id"], crypto.randomUUID()), start = Math.max(0, num(raw["start"], 0)), dur = Math.max(0.05, num(raw["duration"], 2));
    clips[id] = { id, trackId: "T1", type: "text", start, srcStart: 0, srcEnd: dur, speed: 1, volume: 1, balance: 0, fadeIn: 0, fadeOut: 0,
      transform: { ...identity, x: num(raw["x"], 0.5) - 0.5, y: num(raw["y"], 0.5) - 0.5 }, crop: { ...noCrop }, filters: filters(undefined), keyframes: {},
      text: textProps(str(raw["text"], ""), num(raw["size"], 48), str(raw["color"], "#ffffff")) };
  }
  p.video.clips = clips; p.media = media; return p;
}

export function migrateProject(raw: unknown): ProjectV2 {
  if (!isObj(raw)) throw new ProjectError("Project data is not an object");
  const v = raw["version"];
  if (v === 1) return validate(fromV1(raw));
  if (v === SCHEMA_VERSION) return validate(raw as unknown as ProjectV2);
  if (typeof v === "number" && v > SCHEMA_VERSION) throw new ProjectError(`This project was saved by a newer version of OpenSourceEditor (schema ${v})`);
  throw new ProjectError("Project has no recognised schema version");
}

const fill = (f: unknown): ReturnType<typeof filters> => filters(f);
function normaliseFilters(p: ProjectV2): void {
  for (const c of Object.values(p.video?.clips ?? {})) c.filters = fill(c.filters);
  const walk = (g: GroupNode): void => { for (const n of g.children) { if (n.kind === "image" || n.kind === "text" || n.kind === "paint") n.filters = fill(n.filters); if (n.kind === "group") walk(n); } };
  if (p.photo?.root?.children) walk(p.photo.root);
}
export function validate(p: ProjectV2): ProjectV2 {
  normaliseFilters(p);
  if (typeof p.id !== "string" || !isObj(p.media) || !isObj(p.video) || !isObj(p.photo)) throw new ProjectError("Project is missing required sections");
  const side = (n: unknown): boolean => typeof n === "number" && Number.isFinite(n) && n >= 1 && n <= MAX_CANVAS_SIDE;
  if (!side(p.photo.width) || !side(p.photo.height)) throw new ProjectError(`Photo canvas size must be between 1 and ${MAX_CANVAS_SIDE} pixels per side`);
  if (!side(p.video.width) || !side(p.video.height)) throw new ProjectError(`Video frame size must be between 1 and ${MAX_CANVAS_SIDE} pixels per side`);
  if (typeof p.video.fps !== "number" || !Number.isFinite(p.video.fps) || p.video.fps < 1 || p.video.fps > MAX_FPS) throw new ProjectError(`Video frame rate must be between 1 and ${MAX_FPS}`);
  const v = p.video; if (!Array.isArray(v.tracks) || !isObj(v.clips) || !Array.isArray(v.transitions)) throw new ProjectError("Video section is malformed");
  const trackIds = new Set(v.tracks.map((t) => t.id)); if (trackIds.size !== v.tracks.length) throw new ProjectError("Duplicate track ids");
  for (const [id, c] of Object.entries(v.clips)) {
    if (c.id !== id) throw new ProjectError(`Clip key/id mismatch: ${id}`);
    if (!trackIds.has(c.trackId)) throw new ProjectError(`Clip ${id} references missing track ${c.trackId}`);
    if (![c.start, c.srcStart, c.srcEnd, c.speed].every(Number.isFinite) || c.speed <= 0 || c.srcEnd < c.srcStart) throw new ProjectError(`Clip ${id} has invalid timing`);
    if (c.type === "media" && (!c.mediaId || !p.media[c.mediaId])) throw new ProjectError(`Clip ${id} references missing media`);
  }
  if (v.compounds !== undefined) {
    if (!isObj(v.compounds)) throw new ProjectError("Compound table is malformed");
    for (const [kid, k] of Object.entries(v.compounds)) {
      if (!isObj(k) || k.id !== kid || !Array.isArray(k.tracks) || !isObj(k.clips) || !Array.isArray(k.transitions) || !Number.isFinite(k.length)) throw new ProjectError(`Compound ${kid} is malformed`);
      const kt = new Set(k.tracks.map((t) => t.id));
      for (const [cid, c] of Object.entries(k.clips)) {
        if (c.id !== cid || !kt.has(c.trackId) || ![c.start, c.srcStart, c.srcEnd, c.speed].every(Number.isFinite) || c.speed <= 0 || c.srcEnd < c.srcStart) throw new ProjectError(`Clip ${cid} inside ${kid} is invalid`);
        if (c.type === "media" && (!c.mediaId || !p.media[c.mediaId])) throw new ProjectError(`Clip ${cid} inside ${kid} references missing media`);
        if (c.type === "compound" && (!c.compoundId || !v.compounds[c.compoundId])) throw new ProjectError(`Clip ${cid} inside ${kid} references a missing compound`);
      }
      k.transitions = k.transitions.filter((t) => k.clips[t.fromClipId] && k.clips[t.toClipId]);
    }
    const state = new Map<string, 1 | 2>(); const dfs = (kid: string): void => { if (state.get(kid) === 2) return; if (state.get(kid) === 1) throw new ProjectError("Compounds contain themselves"); state.set(kid, 1); for (const c of Object.values(v.compounds![kid]!.clips)) if (c.compoundId) dfs(c.compoundId); state.set(kid, 2); }; Object.keys(v.compounds).forEach(dfs);
  }
  for (const [id, c] of Object.entries(v.clips)) if (c.type === "compound" && (!c.compoundId || !v.compounds?.[c.compoundId])) throw new ProjectError(`Clip ${id} references a missing compound`);
  if (v.markers !== undefined) {
    v.markers = Array.isArray(v.markers) ? v.markers.filter((m) => isObj(m) && typeof m.id === "string" && Number.isFinite(m.t) && m.t >= 0).map((m) => ({ id: m.id, t: m.t, name: typeof m.name === "string" ? m.name.slice(0, 40) : "" })) : [];
    if (!v.markers.length) delete v.markers;
  }
  for (const t of v.tracks) { if (t.height !== undefined && !Number.isFinite(t.height)) delete t.height; if (t.collapsed !== undefined && typeof t.collapsed !== "boolean") delete t.collapsed; }
  v.transitions = v.transitions.filter((t) => v.clips[t.fromClipId] && v.clips[t.toClipId] && trackIds.has(t.trackId));
  const seen = new Set<string>();
  const walk = (g: GroupNode): void => { for (const n of g.children) {
    if (seen.has(n.id)) throw new ProjectError(`Duplicate layer id ${n.id}`); seen.add(n.id);
    if (n.kind === "image" && !p.media[n.mediaId]) throw new ProjectError(`Layer ${n.id} references missing media`);
    if (n.kind === "group") walk(n); } };
  if (!p.photo.root || p.photo.root.kind !== "group") throw new ProjectError("Photo layer tree is missing its root"); walk(p.photo.root);
  return p;
}
