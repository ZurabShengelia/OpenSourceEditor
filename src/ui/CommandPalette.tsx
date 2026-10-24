import { useEffect, useId, useMemo, useRef, useState } from "react";
import { search, type Command } from "../app/commandSearch";
import { Icon } from "./Icon";

export function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [q, setQ] = useState(""), [i, setI] = useState(0); const id = useId(); const list = useRef<HTMLDivElement>(null); const back = useRef<Element | null>(document.activeElement);
  const hits = useMemo(() => search(commands, q), [commands, q]);
  useEffect(() => { setI(0); }, [q]);
  useEffect(() => { const el = list.current?.querySelector<HTMLElement>(`[data-i="${i}"]`); el?.scrollIntoView({ block: "nearest" }); }, [i]);
  useEffect(() => () => { if (back.current instanceof HTMLElement) back.current.focus(); }, []);
  const run = (c: Command | undefined): void => { if (!c || !c.enabled) return; onClose(); setTimeout(c.run, 0); };
  const key = (e: React.KeyboardEvent): void => {
    if (e.key === "ArrowDown") { e.preventDefault(); setI((n) => Math.min(hits.length - 1, n + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setI((n) => Math.max(0, n - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); run(hits[i]); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
    else if (e.key === "Tab") e.preventDefault();
  };
  return (
    <div className="palette-back" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette glass" role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={key}>
        <div className="palette-in"><Icon name="search" size={14} />
          <input autoFocus role="combobox" aria-expanded="true" aria-controls={`${id}-l`} aria-activedescendant={hits[i] ? `${id}-${i}` : undefined} aria-autocomplete="list" placeholder="Type a command…" value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} /></div>
        <div className="palette-list" role="listbox" id={`${id}-l`} ref={list} aria-label="Commands">
          {hits.length === 0 && <div className="palette-empty">No matching commands</div>}
          {hits.map((c, n) => <div key={c.id} id={`${id}-${n}`} data-i={n} role="option" aria-selected={n === i} aria-disabled={!c.enabled} className={`palette-row ${n === i ? "on" : ""} ${c.enabled ? "" : "off"}`} onPointerMove={() => setI(n)} onClick={() => run(c)}>
            <span className="t">{c.title}{c.checked !== undefined && <span className="st">{c.checked ? " · on" : " · off"}</span>}</span><span className="g">{c.group}</span>{c.shortcut && <kbd>{c.shortcut}</kbd>}</div>)}
        </div>
      </div>
    </div>
  );
}
