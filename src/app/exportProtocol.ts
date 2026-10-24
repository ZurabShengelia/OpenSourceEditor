import type { VideoDoc } from "../doc/schema";
import type { Mix, OfflineOptions } from "./offlineCore";

export interface WorkerMedia { id: string; kind: string; blob: Blob }
export interface RunMessage {
  type: "run"; options: OfflineOptions; video: VideoDoc; media: WorkerMedia[]; bitmaps: { id: string; bitmap: ImageBitmap }[]; mix: Mix | null;
 faults: { preflight?: string; encodeAtFrame?: number; mux?: string; noWorker?: boolean; noFxCache?: boolean };
}
export type ToWorker = RunMessage | { type: "abort" };
export type StatsSnapshot = Record<string, number>;
export type FromWorker =
  | { type: "ready" }
  | { type: "start" }
  | { type: "progress"; p: number; stats: StatsSnapshot; encoders: number }
  | { type: "done"; blob: Blob; stats: StatsSnapshot }
  | { type: "error"; name: string; message: string }
  | { type: "fallback"; reason: string };
