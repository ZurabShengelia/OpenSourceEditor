import { migrateProject, newProject as blankProject, ProjectError } from "../doc/migrate";
import type { GroupNode, ProjectV2 } from "../doc/schema";
import { player } from "./engine";
import { DEFAULT_FILTERS } from "../editor/effects";
import { bitmaps, bumpRev, canvasToBlob, clearRuntime, ingest, newBitmap, runtime, uid } from "./media";
import { duplicateStored, listProjects, putProject, readProject, removeProject, renameStored, StorageError, type BlobRecord } from "./storage";
import { getDoc, loadDoc, markSaved, touchMeta } from "./store";

const stored = new Map<string, Set<string>>();
function bitmapIds(p: ProjectV2): Set<string> {
  const out = new Set<string>(); const walk = (g: GroupNode): void => { for (const n of g.children) { if (n.kind === "paint") out.add(n.bitmapId); if (n.mask) out.add(n.mask.bitmapId); if (n.kind === "group") walk(n); } }; walk(p.photo.root); return out;
}
export async function saveCurrent(): Promise<void> {
  touchMeta((d) => ({ ...d, updatedAt: Date.now() })); const doc = getDoc(); const have = stored.get(doc.id) ?? new Set<string>(); const keep = new Set<string>(Object.keys(doc.media)); const blobs: BlobRecord[] = [];
  for (const id of Object.keys(doc.media)) { const r = runtime.get(id); if (r && !have.has(id)) blobs.push({ assetId: id, name: doc.media[id]!.name, blob: r.blob }); }
  for (const id of bitmapIds(doc)) { keep.add(id); const c = bitmaps.get(id); if (c && !have.has(id)) blobs.push({ assetId: id, name: "bitmap", blob: await canvasToBlob(c), bitmap: true }); }
  await putProject(doc, blobs, keep); stored.set(doc.id, keep); markSaved(getDoc());
}
export async function openSaved(id: string): Promise<void> {
  const r = await readProject(id); if (!r) throw new StorageError("Project not found");
  let doc: ProjectV2; try { doc = migrateProject(r.rec); } catch (e) { throw new ProjectError(`This project cannot be opened: ${e instanceof Error ? e.message : "its data is damaged"}`); }
  doc = { ...doc, id }; clearRuntime(); const have = new Set<string>(); const media = { ...doc.media }; const missing: string[] = [];
  for (const b of r.blobs) {
    have.add(b.assetId);
    if (b.bitmap) { const c = await decodeBitmap(b.blob); bitmaps.set(b.assetId, c); continue; }
    if (!media[b.assetId]) continue;
    try { const ref = await ingest(b.blob, b.name, b.assetId); media[b.assetId] = { ...media[b.assetId]!, ...ref, name: media[b.assetId]!.name }; } catch { missing.push(b.name); }
  }
  for (const m of Object.values(media)) if (!runtime.has(m.id)) missing.push(m.name);
  stored.set(id, have); loadDoc({ ...doc, media }); bumpRev(); player.refresh();
  if (missing.length) throw new StorageError(`Opened, but these media files could not be restored: ${[...new Set(missing)].join(", ")}`);
}
async function decodeBitmap(blob: Blob): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(blob); try { const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Painted layer data is damaged")); i.src = url; });
    const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext("2d", { willReadFrequently: true })!.drawImage(img, 0, 0); return c; } finally { URL.revokeObjectURL(url); }
}
export function newDocument(): void { clearRuntime(); loadDoc(blankProject(uid(), "Untitled")); player.refresh(); }
export type PhotoBackground = "transparent" | "white" | "black" | string;
export const PHOTO_MAX = 8192;
export interface NewPhotoOpts { name: string; width: number; height: number; background: PhotoBackground }
export function newPhotoDocument(o: NewPhotoOpts): void {
  const w = Math.max(1, Math.min(PHOTO_MAX, Math.round(o.width))), h = Math.max(1, Math.min(PHOTO_MAX, Math.round(o.height)));
  clearRuntime(); const p = blankProject(uid(), o.name.trim() || "Untitled"); p.photo = { ...p.photo, width: w, height: h };
  if (o.background !== "transparent") {
    const color = o.background === "white" ? "#ffffff" : o.background === "black" ? "#000000" : o.background, { id } = newBitmap(w, h, color);
    p.photo = { ...p.photo, root: { ...p.photo.root, children: [{ kind: "paint", id: uid(), name: "Background", visible: true, locked: false, opacity: 1, blend: "source-over", x: 0, y: 0, scale: 1, rotation: 0, bitmapId: id, filters: { ...DEFAULT_FILTERS } }] } };
  }
  loadDoc(p); player.refresh(); bumpRev();
}
export async function saveAs(name: string): Promise<void> { touchMeta((d) => ({ ...d, id: uid(), name })); await saveCurrent(); }
export async function renameCurrent(name: string): Promise<void> { touchMeta((d) => ({ ...d, name })); if ((await listProjects()).some((p) => p.id === getDoc().id)) await renameStored(getDoc().id, name); }
export async function duplicateSaved(id: string, name: string): Promise<void> { await duplicateStored(id, uid(), name); }
export async function deleteSaved(id: string): Promise<void> { await removeProject(id); stored.delete(id); }
export { listProjects };
