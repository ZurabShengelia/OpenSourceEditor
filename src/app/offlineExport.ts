import { docDuration } from "../doc/compose";
import { bitmaps, runtime } from "./media";
import { decodeFlags } from "./frameDecoder";
import { faults, resources } from "./resources";
import { getDoc } from "./store";
import { exportFrames, offlineAvailable, offlineStats, prepareMix, OfflineUnsupported, type ExportEnv, type ExportHooks, type OfflineOptions } from "./offlineCore";
import type { FromWorker, RunMessage, ToWorker } from "./exportProtocol";

export { offlineAvailable, offlineStats, preflightOffline, probeOffline, OfflineUnsupported, type OfflineOptions } from "./offlineCore";

const WORKER_START_MS = 10000, ABORT_GRACE_MS = 3000, STALL_MS = 120000;

function spawn(): Worker | null {
  if (typeof Worker === "undefined" || faults.noWorker) return null;
  try { return new Worker(new URL("./exportWorker.ts", import.meta.url), { type: "module" }); } catch { return null; }
}

async function viaWorker(o: OfflineOptions, env: ExportEnv, mix: RunMessage["mix"], hooks: ExportHooks, signal: AbortSignal): Promise<Blob | "fallback"> {
  if (!decodeFlags.direct) return "fallback";
  const w = spawn(); if (!w) return "fallback";
  const media: RunMessage["media"] = [];
  for (const [id, rt] of runtime) if (rt.kind === "video" || rt.kind === "image" || rt.kind === "bitmap") media.push({ id, kind: rt.kind, blob: rt.blob });
  let maps: RunMessage["bitmaps"];
  try { maps = await Promise.all([...bitmaps].map(async ([id, c]) => ({ id, bitmap: await createImageBitmap(c) }))); } catch { w.terminate(); return "fallback"; }
  return new Promise<Blob | "fallback">((resolve, reject) => {
    let settled = false, started = false, sent = false, last = performance.now(); let abortTimer: ReturnType<typeof setTimeout> | undefined;
    const end = (f: () => void): void => { if (settled) return; settled = true; clearTimeout(readyTimer); clearTimeout(abortTimer); clearInterval(watchdog); signal.removeEventListener("abort", onAbort); w.terminate(); resources.encoders = 0; f(); };
    const readyTimer = setTimeout(() => end(() => resolve("fallback")), WORKER_START_MS);
    const watchdog = setInterval(() => { if (sent && performance.now() - last > STALL_MS) end(() => reject(new Error("The export worker stopped responding"))); }, 5000);
    const onAbort = (): void => { w.postMessage({ type: "abort" } satisfies ToWorker); abortTimer = setTimeout(() => end(() => reject(new Error("Export cancelled"))), ABORT_GRACE_MS); };
    w.onerror = (e): void => { e.preventDefault(); end(() => (started ? reject(new Error(e.message || "The export worker stopped unexpectedly")) : resolve("fallback"))); };
    w.onmessageerror = (): void => end(() => (started ? reject(new Error("The export worker sent data the page could not read")) : resolve("fallback")));
    w.onmessage = (ev: MessageEvent<FromWorker>): void => {
      const m = ev.data; last = performance.now();
      if (m.type === "ready") { clearTimeout(readyTimer); const msg: RunMessage = { type: "run", options: o, video: env.video, media, bitmaps: maps, mix, faults: { ...faults } };
        const transfer: Transferable[] = maps.map((b) => b.bitmap); if (mix) transfer.push(mix.left.buffer, mix.right.buffer);
        try { w.postMessage(msg, transfer); sent = true; last = performance.now(); } catch { end(() => resolve("fallback")); } }
      else if (m.type === "start") { started = true; hooks.onStart(); }
      else if (m.type === "progress") { Object.assign(offlineStats, m.stats); resources.encoders = m.encoders; hooks.onProgress(m.p); }
      else if (m.type === "done") { end(() => { Object.assign(offlineStats, m.stats); resolve(m.blob); }); }
      else if (m.type === "fallback") end(() => resolve("fallback"));
      else if (m.type === "error") end(() => reject(m.name === "OfflineUnsupported" ? new OfflineUnsupported(m.message) : new Error(m.message)));
    };
    signal.addEventListener("abort", onAbort, { once: true }); if (signal.aborted) onAbort();
  });
}

export async function offlineExport(o: OfflineOptions, onProgress: (p: number) => void, onStart: () => void, signal: AbortSignal): Promise<Blob> {
  if (!offlineAvailable()) throw new OfflineUnsupported("This browser has no WebCodecs encoder");
  const video = getDoc().video; if (docDuration(video) <= 0) throw new Error("The timeline is empty");
  const env: ExportEnv = { video, media: (id) => runtime.get(id), bitmap: (id) => bitmaps.get(id) ?? null };
  let started = false; const hooks: ExportHooks = { onProgress, onStart: () => { if (!started) { started = true; onStart(); } } };
  const A0 = performance.now(); const mix = o.audioCodec !== "none" ? await prepareMix(env, signal) : null; const audioMs = performance.now() - A0;
  const r = await viaWorker(o, env, mix, hooks, signal);
  if (r !== "fallback") { offlineStats.audioMs = audioMs; (offlineStats as Record<string, number>).worker = 1; return r; }
  const mix2 = o.audioCodec !== "none" ? await prepareMix(env, signal) : null;
  const blob = await exportFrames(o, { ...env, mix: mix2 }, hooks, signal); (offlineStats as Record<string, number>).worker = 0; return blob;
}
