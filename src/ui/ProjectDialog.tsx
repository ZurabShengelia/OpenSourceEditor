import { useEffect, useState } from "react";
import { askConfirm, askText } from "../app/dialogs";
import { deleteSaved, duplicateSaved, listProjects, newDocument, openSaved, renameCurrent } from "../app/persist";
import { renameStored, type ProjectMeta } from "../app/storage";
import { getDoc } from "../app/store";
import { Btn } from "./controls";
import { Modal } from "./DialogHost";

export function ProjectDialog({ open, onClose, onError, confirmNew }: { open: boolean; onClose: () => void; onError: (m: string) => void; confirmNew: () => Promise<boolean> }) {
  const [list, setList] = useState<ProjectMeta[] | null>(null);
  const fail = (e: unknown): void => onError(e instanceof Error ? e.message : "Storage error");
  const refresh = (): Promise<void> => listProjects().then(setList).catch(fail);
  useEffect(() => { if (open) void refresh(); }, [open]);
  if (!open) return null;
  const cur = getDoc().id;
  return (
    <Modal title="Projects stored in this browser" onClose={onClose} wide>
      <div className="plist">
        {list === null && <p className="muted" style={{ padding: 16 }}>Loading…</p>}
        {list?.length === 0 && <p className="muted" style={{ padding: 16, lineHeight: 1.6 }}>No saved projects yet. Use File → Save to store the current one in this browser.</p>}
        {list?.map((p) => (
          <div key={p.id} className="prow">
            <div className="pn"><b>{p.name}</b>{p.id === cur && <span className="cur">Open now</span>}<div className="muted mono">{new Date(p.updatedAt).toLocaleString()}</div></div>
            <Btn sm onClick={() => void openSaved(p.id).then(onClose).catch(fail)}>Open</Btn>
            <Btn sm className="ghost" onClick={() => void askText("Rename project", p.name, { ok: "Rename" }).then((n) => (n ? (p.id === getDoc().id ? renameCurrent(n) : renameStored(p.id, n)).then(refresh) : undefined)).catch(fail)}>Rename</Btn>
            <Btn sm className="ghost" onClick={() => void duplicateSaved(p.id, `${p.name} copy`).then(refresh).catch(fail)}>Duplicate</Btn>
            <Btn sm className="ghost danger" onClick={() => void askConfirm(`Delete “${p.name}”?`, "The project and its media are removed from this browser. This cannot be undone.", { ok: "Delete", danger: true }).then((ok) => (ok ? deleteSaved(p.id).then(refresh) : undefined)).catch(fail)}>Delete</Btn>
          </div>
        ))}
      </div>
      <div className="dlg-f" style={{ justifyContent: "space-between" }}><Btn onClick={() => void confirmNew().then((ok) => { if (ok) { newDocument(); onClose(); } })}>New project</Btn><Btn onClick={onClose}>Close</Btn></div>
    </Modal>
  );
}
