export interface ProjectMeta { id: string; name: string; updatedAt: number }
export interface BlobRecord { assetId: string; name: string; blob: Blob; bitmap?: boolean }
export class StorageError extends Error {}

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((res, rej) => {
    if (typeof indexedDB === "undefined") return rej(new StorageError("This browser has no IndexedDB, so projects cannot be saved"));
    const r = indexedDB.open("loupe", 2);
    r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains("projects")) d.createObjectStore("projects", { keyPath: "id" }); if (!d.objectStoreNames.contains("blobs")) d.createObjectStore("blobs"); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(new StorageError(r.error?.message ?? "IndexedDB is unavailable (private browsing?)")); r.onblocked = () => rej(new StorageError("Close other OpenSourceEditor tabs and try again"));
  });
  return dbp;
}
const req = <T,>(r: IDBRequest<T>): Promise<T> => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(wrap(r.error)); });
const done = (t: IDBTransaction): Promise<void> => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(wrap(t.error)); t.onabort = () => rej(wrap(t.error)); });
function wrap(e: DOMException | Error | null): StorageError {
  if (e && "name" in e && e.name === "QuotaExceededError") return new StorageError("Browser storage is full. Delete old projects or remove unused media, then save again.");
  return new StorageError(e?.message ?? "Storage error");
}
const range = (id: string): IDBKeyRange => IDBKeyRange.bound(`${id}:`, `${id}:\uffff`);

export async function putProject(rec: { id: string }, blobs: BlobRecord[], keep: ReadonlySet<string>): Promise<void> {
  const t = (await db()).transaction(["projects", "blobs"], "readwrite"); const bs = t.objectStore("blobs");
  t.objectStore("projects").put(rec); for (const b of blobs) bs.put(b, `${rec.id}:${b.assetId}`);
  const cur = bs.openKeyCursor(range(rec.id)); cur.onsuccess = () => { const c = cur.result; if (!c) return; const k = String(c.key).slice(rec.id.length + 1); if (!keep.has(k)) bs.delete(c.key); c.continue(); };
  await done(t);
}
export async function listProjects(): Promise<ProjectMeta[]> {
  const all = await req((await db()).transaction("projects").objectStore("projects").getAll() as IDBRequest<Record<string, unknown>[]>);
  return all.filter((r) => typeof r["id"] === "string").map((r) => ({ id: r["id"] as string, name: typeof r["name"] === "string" ? r["name"] : "Untitled", updatedAt: typeof r["updatedAt"] === "number" ? r["updatedAt"] : 0 })).sort((a, b) => b.updatedAt - a.updatedAt);
}
export async function readProject(id: string): Promise<{ rec: unknown; blobs: BlobRecord[] } | null> {
  const d = await db(); const rec = await req(d.transaction("projects").objectStore("projects").get(id) as IDBRequest<unknown>); if (!rec) return null;
  return { rec, blobs: await req(d.transaction("blobs").objectStore("blobs").getAll(range(id)) as IDBRequest<BlobRecord[]>) };
}
export async function renameStored(id: string, name: string): Promise<void> {
  const d = await db(); const rec = await req(d.transaction("projects").objectStore("projects").get(id) as IDBRequest<Record<string, unknown> | undefined>);
  if (rec) await req(d.transaction("projects", "readwrite").objectStore("projects").put({ ...rec, name }));
}
export async function removeProject(id: string): Promise<void> { const t = (await db()).transaction(["projects", "blobs"], "readwrite"); t.objectStore("projects").delete(id); t.objectStore("blobs").delete(range(id)); await done(t); }
export async function duplicateStored(id: string, newId: string, name: string): Promise<void> {
  const r = await readProject(id); if (!r) throw new StorageError("Project not found"); const rec = { ...(r.rec as Record<string, unknown>), id: newId, name, updatedAt: Date.now() };
  await putProject(rec, r.blobs, new Set(r.blobs.map((b) => b.assetId)));
}
