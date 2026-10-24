import { useEffect, useState } from "react";
import { listProjects, newDocument, openSaved } from "../app/persist";
import type { ProjectMeta } from "../app/storage";
import { setUi } from "../app/store";
import { Btn } from "./controls";
import { Modal } from "./DialogHost";
import { Icon } from "./Icon";

export const STARTED_KEY = "loupe.started";
export function StartDialog({ onDone, onBrowse, onError, onNewPhoto }: { onDone: () => void; onBrowse: () => void; onError: (m: string) => void; onNewPhoto: () => void }) {
  const [recent, setRecent] = useState<ProjectMeta[]>([]);
  useEffect(() => { void listProjects().then((l) => setRecent(l.slice(0, 5))).catch(() => undefined); }, []);
  const finish = (): void => { try { sessionStorage.setItem(STARTED_KEY, "1"); } catch { } onDone(); };
  const begin = (mode: "video" | "photo"): void => { if (mode === "photo") { finish(); onNewPhoto(); return; } newDocument(); setUi({ mode }); finish(); };
  return (
    <Modal title="Start" onClose={finish}>
      <div className="dlg-b start">
        <div className="start-new" role="group" aria-label="New project">
          <button className="start-opt" autoFocus onClick={() => begin("video")}><Icon name="video" size={18} /><b>Video project</b><span>Multi-track timeline</span></button>
          <button className="start-opt" onClick={() => begin("photo")}><Icon name="image" size={18} /><b>Photo project</b><span>Choose size and background</span></button>
        </div>
        {recent.length > 0 && <div className="start-recent"><h3>Recent projects</h3>{recent.map((p) => <button key={p.id} className="start-row" onClick={() => void openSaved(p.id).then(finish).catch((e: unknown) => onError(e instanceof Error ? e.message : "Could not open project"))}><span>{p.name}</span><span className="mono muted">{new Date(p.updatedAt).toLocaleDateString()}</span></button>)}</div>}
      </div>
      <div className="dlg-f"><Btn className="ghost" onClick={() => { finish(); onBrowse(); }}>Open existing…</Btn><span className="grow" /><Btn onClick={finish}>Continue with blank project</Btn></div>
    </Modal>
  );
}
