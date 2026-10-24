import { useRef, useState, useSyncExternalStore } from "react";
import { mediaUseCount } from "../doc/compose";
import { addClipFromMedia, addImageLayer, importFiles, removeMedia, renameMedia } from "../app/actions";
import { askConfirm, askText } from "../app/dialogs";
import { mediaRev, runtime, subscribeMedia } from "../app/media";
import { setPref, setUi, useDoc, useUi } from "../app/store";
import { openContextMenu } from "../editor/ContextMenu";
import type { MediaRef } from "../doc/schema";
import { Btn, IconButton, Seg, fmt, fmtSize } from "./controls";
import { Icon, kindIcon } from "./Icon";

const label = (k: string): string => (k === "video" ? "Video" : k === "audio" ? "Audio" : "Image");
function Thumb({ m }: { m: MediaRef }) {
  return <div className={`thumb ${m.kind}`}>{m.thumb ? <img src={m.thumb} alt="" /> : <Icon name={kindIcon(m.kind)} size={18} />}
    <span className="kind" style={{ color: `var(--k-${m.kind})` }}><Icon name={kindIcon(m.kind)} size={10} /></span>{m.duration && Number.isFinite(m.duration) ? <span className="dur">{fmt(m.duration).slice(0, 5)}</span> : null}</div>;
}
export function MediaBin({ onError, width }: { onError: (m: string) => void; width: number }) {
  const doc = useDoc((d) => d), mode = useUi((u) => u.mode), q = useUi((u) => u.binSearch), filter = useUi((u) => u.binFilter), sel = useUi((u) => u.binSel); useSyncExternalStore(subscribeMedia, mediaRev);
  const ref = useRef<HTMLInputElement>(null); const [over, setOver] = useState(false); const [drag, setDrag] = useState<string | null>(null);
  const all = Object.values(doc.media).filter((m) => m.kind !== "bitmap"), count = (k: string): number => all.filter((m) => m.kind === k).length;
  const items = all.filter((m) => (filter === "all" || m.kind === filter) && m.name.toLowerCase().includes(q.toLowerCase()));
  const used = (id: string): number => mediaUseCount(doc.video, id) + JSON.stringify(doc.photo.root).split(`"mediaId":"${id}"`).length - 1;
  const place = (m: MediaRef): void => { if (mode === "photo") { if (m.kind === "image") addImageLayer(m.id); else setUi({ status: "Photo mode places images. Switch to Video to use clips and audio." }); } else addClipFromMedia(m.id); };
  const remove = (m: MediaRef): void => { const n = used(m.id); void askConfirm(`Remove “${m.name}”?`, n ? `It is used ${n} time${n > 1 ? "s" : ""} in this project; those clips and layers are removed too. You can undo this.` : "It is not used in the project.", { ok: "Remove", danger: true }).then((ok) => { if (ok) removeMedia(m.id); }); };
  const rename = (m: MediaRef): void => { void askText("Rename media", m.name, { ok: "Rename" }).then((n) => { if (n) renameMedia(m.id, n); }); };
  const fail = (x: unknown): void => onError(x instanceof Error ? x.message : "Import failed");
  const menu = (e: React.MouseEvent, m: MediaRef): void => { setUi({ binSel: m.id }); openContextMenu(e, [{ label: mode === "video" ? "Add to timeline" : "Add to canvas", disabled: mode === "photo" && m.kind !== "image", onSelect: () => place(m) }, { sep: true }, { label: "Rename…", onSelect: () => rename(m) }, { label: "Remove from project", danger: true, onSelect: () => remove(m) }]); };
  return (
    <aside aria-label="Media bin" className={`panel bin ${over ? "over" : ""}`} style={{ width }} onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { setOver(false); if (e.dataTransfer.files.length) { e.preventDefault(); importFiles(Array.from(e.dataTransfer.files as ArrayLike<File>)).catch(fail); } }}>
      <div className="panel-h"><h2>Media</h2><Btn sm onClick={() => ref.current?.click()} tipLabel="Import media" keys="Ctrl+O"><Icon name="import" size={13} />Import</Btn>
        <IconButton icon="panelL" label="Hide media panel" size="sm" onClick={() => { setUi({ binOpen: false }); setPref("loupe.binOpen", false); }} /></div>
      <input ref={ref} type="file" hidden multiple accept="video/*,audio/*,image/*" onChange={(e) => { const f = Array.from((e.target.files ?? []) as ArrayLike<File>); e.target.value = ""; importFiles(f).catch(fail); }} />
      <div className="bin-tools">
        <div className="searchbox"><Icon name="search" size={13} /><input className="inp" aria-label="Search media" placeholder="Search media" value={q} onChange={(e) => setUi({ binSearch: e.target.value })} />{q && <button className="ibtn xs clear" aria-label="Clear search" onClick={() => setUi({ binSearch: "" })}><Icon name="x" size={11} /></button>}</div>
        <Seg full label="Filter media type" value={filter} onChange={(v) => setUi({ binFilter: v })} options={[{ id: "all", label: "All", count: all.length }, { id: "video", label: "Video", tip: "Video", count: count("video") }, { id: "audio", label: "Audio", tip: "Audio", count: count("audio") }, { id: "image", label: "Image", tip: "Image", count: count("image") }]} />
      </div>
      <ul className="bin-list" role="listbox" aria-label="Project media">
        {items.length === 0 && <li className="drop-empty">{all.length ? <b>No media matches</b> : <><b>No media yet</b>{mode === "photo" ? "Drop images here," : "Drop video, audio or images here,"}<br />or use Import.</>}</li>}
        {items.map((m) => (
          <li key={m.id} role="option" aria-selected={sel === m.id} tabIndex={0} draggable className={`asset ${drag === m.id ? "dragging" : ""} ${mode === "photo" && m.kind !== "image" ? "dim" : ""}`} onClick={() => setUi({ binSel: m.id })} onDoubleClick={() => place(m)} onContextMenu={(e) => menu(e, m)}
            onDragStart={(e) => { setDrag(m.id); e.dataTransfer.setData("application/x-loupe-media", m.id); e.dataTransfer.effectAllowed = "copy"; }} onDragEnd={() => setDrag(null)}
            onKeyDown={(e) => { if (e.key === "Enter") place(m); else if (e.key === "Delete" || e.key === "Backspace") { e.stopPropagation(); remove(m); } else if (e.key === "F2") rename(m); }}>
            <Thumb m={m} />
            <div className="grow"><div className="name trunc" title={m.name}>{m.name}</div>
              <div className="sub trunc">{[m.width ? `${m.width}×${m.height}` : "", runtime.get(m.id) ? fmtSize(runtime.get(m.id)!.blob.size) : ""].filter(Boolean).join(" · ") || label(m.kind)}{used(m.id) ? <span className="used"> · used {used(m.id)}×</span> : null}</div></div>
            <div className="acts"><IconButton icon="plus" size="sm" label={`Add ${m.name} to ${mode === "video" ? "timeline" : "canvas"}`} onClick={(e) => { e.stopPropagation(); place(m); }} /></div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
