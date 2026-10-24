import { useEffect, useRef, useState } from "react";
import { href } from "../app/router";
import { Menu, type MenuItem } from "../editor/Menu";
import { IconButton } from "./controls";
import { Icon, Mark } from "./Icon";

function DocTitle({ name, onRename }: { name: string; onRename: (n: string) => void }) {
  const [edit, setEdit] = useState(false), [v, setV] = useState(name); const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (edit) { ref.current?.focus(); ref.current?.select(); } }, [edit]);
  const done = (ok: boolean): void => { setEdit(false); const n = v.trim(); if (ok && n && n !== name) onRename(n); };
  return edit
    ? <input ref={ref} className="doc-title" aria-label="Project name" value={v} maxLength={80} onChange={(e) => setV(e.target.value)} onBlur={() => done(true)} onKeyDown={(e) => { if (e.key === "Enter") done(true); else if (e.key === "Escape") done(false); }} />
    : <button className="doc-title trunc" aria-label={`Project name: ${name}. Click to rename`} data-tip="Rename project" onClick={() => { setV(name); setEdit(true); }}>{name}</button>;
}

export interface TopBarProps {
  mode: "photo" | "video"; setMode: (m: "photo" | "video") => void; name: string; onRename: (n: string) => void; saved: boolean; onSave: () => void;
  canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void; file: MenuItem[]; edit: MenuItem[]; view: MenuItem[]; exportItems: MenuItem[]; exporting: boolean;
}
export function TopBar(p: TopBarProps) {
  return (
    <header className="topbar">
      <a href={href("home")} className="brand" aria-label="OpenSourceEditor home"><Mark size={22} />OpenSourceEditor</a>
      <nav className="menubar" aria-label="Menu"><Menu id="file" label="File" items={p.file} bar /><Menu id="edit" label="Edit" items={p.edit} bar /><Menu id="view" label="View" items={p.view} bar /></nav>
      <div className="ws" role="tablist" aria-label="Workspace">{(["photo", "video"] as const).map((m) => <button key={m} role="tab" aria-selected={p.mode === m} onClick={() => p.setMode(m)}><Icon name={m === "photo" ? "image" : "video"} size={14} />{m === "photo" ? "Photo" : "Video"}</button>)}</div>
      <div className="titlebox"><DocTitle name={p.name} onRename={p.onRename} />
        {p.saved ? <span className="savestate" role="status" title="Saved in this browser">Saved</span> : <button className="savestate dirty" onClick={p.onSave} data-tip="Save" data-key="Ctrl+S" aria-label="Unsaved changes. Save">Unsaved</button>}</div>
      <div className="actions">
        <IconButton icon="undo" label="Undo" keys="Ctrl+Z" disabled={!p.canUndo} onClick={p.onUndo} /><IconButton icon="redo" label="Redo" keys="Ctrl+Shift+Z" disabled={!p.canRedo} onClick={p.onRedo} />
        <span className="vsep" />
        <Menu id="export" label="Export" icon="export" items={p.exportItems} align="right" primary />
        {p.exporting && <span className="sr" role="status">Exporting</span>}
      </div>
    </header>
  );
}
