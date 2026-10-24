import type { Source } from "../render/compositor";
import { NeedMainThread, OfflineUnsupported, exportFrames, offlineStats, type EnvMedia, type ExportEnv } from "./offlineCore";
import type { FromWorker, RunMessage, ToWorker } from "./exportProtocol";
import { faults, resources } from "./resources";

const ctx = self as unknown as { postMessage(m: FromWorker): void; onmessage: ((e: { data: ToWorker }) => void) | null };
const post = (m: FromWorker): void => ctx.postMessage(m);
let ac: AbortController | null = null;

async function run(m: RunMessage): Promise<void> {
  Object.assign(faults, m.faults); ac = new AbortController();
  try {
    const media = new Map<string, EnvMedia>();
    for (const x of m.media) {
      let img: unknown;
      if (x.kind === "image" || x.kind === "bitmap") { try { img = await createImageBitmap(x.blob); } catch { throw new NeedMainThread("This image can only be decoded by the page"); } }
      media.set(x.id, { kind: x.kind, blob: x.blob, img });
    }
    const bitmaps = new Map(m.bitmaps.map((b) => [b.id, b.bitmap as unknown as Source]));
    const env: ExportEnv = { video: m.video, media: (id) => media.get(id), bitmap: (id) => bitmaps.get(id) ?? null, mix: m.mix };
    const blob = await exportFrames(m.options, env, { onProgress: (p) => post({ type: "progress", p, stats: { ...offlineStats }, encoders: resources.encoders }), onStart: () => post({ type: "start" }) }, ac.signal);
    post({ type: "done", blob, stats: { ...offlineStats } });
  } catch (e) {
    if (e instanceof NeedMainThread) post({ type: "fallback", reason: e.message });
    else post({ type: "error", name: e instanceof OfflineUnsupported ? "OfflineUnsupported" : "Error", message: e instanceof Error ? e.message : String(e) });
  }
}
ctx.onmessage = (ev) => { const m = ev.data; if (m.type === "abort") ac?.abort(); else if (m.type === "run") void run(m); };
post({ type: "ready" });
