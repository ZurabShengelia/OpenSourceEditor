import { useEffect, useRef, useState } from "react";
import { registerDialogHost, type DialogReq } from "../app/dialogs";
import { Btn } from "./controls";
import { Icon } from "./Icon";

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const prev = document.activeElement as HTMLElement | null; if (ref.current && !ref.current.contains(document.activeElement)) ref.current.focus(); return () => prev?.focus?.(); }, []);
  const key = (e: React.KeyboardEvent): void => {
    e.stopPropagation();
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "Tab" && ref.current) { const f = Array.from(ref.current.querySelectorAll<HTMLElement>("button:not(:disabled), input, select, textarea, [tabindex='0']")); if (!f.length) return; const i = f.indexOf(document.activeElement as HTMLElement); if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1]!.focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0]!.focus(); } }
  };
  return (
    <div className="dlg-back" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={key}>
      <div ref={ref} tabIndex={-1} className={`dlg ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="dlg-h"><span className="grow">{title}</span><button className="ibtn sm" aria-label="Close" data-tip="Close" onClick={onClose}><Icon name="x" size={14} /></button></div>
        {children}
      </div>
    </div>
  );
}

export function DialogHost() {
  const [req, setReq] = useState<DialogReq | null>(null); const cur = useRef<DialogReq | null>(null);
  useEffect(() => { registerDialogHost((r) => { if (cur.current) { const p = cur.current; if (p.kind === "text") p.resolve(null); else p.resolve(false); } cur.current = r; setReq(r); }); return () => registerDialogHost(null); }, []);
  if (!req) return null;
  const finish = (v: string | boolean | null): void => { if (req.kind === "text") req.resolve(typeof v === "string" ? v : null); else req.resolve(v === true); cur.current = null; setReq(null); };
  return req.kind === "text" ? <TextDialog req={req} done={finish} /> : (
    <Modal title={req.title} onClose={() => finish(false)}>
      <div className="dlg-b"><p className="dlg-msg">{req.message}</p></div>
      <div className="dlg-f"><Btn onClick={() => finish(false)} autoFocus={req.danger}>Cancel</Btn><Btn className={req.danger ? "danger-fill" : ""} primary={!req.danger} onClick={() => finish(true)} autoFocus={!req.danger}>{req.ok}</Btn></div>
    </Modal>
  );
}
function TextDialog({ req, done }: { req: Extract<DialogReq, { kind: "text" }>; done: (v: string | null) => void }) {
  const [v, setV] = useState(req.value);
  return (
    <Modal title={req.title} onClose={() => done(null)}>
      <div className="dlg-b"><label><span className="field-l">{req.label}</span>
        <input className="inp full" autoFocus value={v} maxLength={120} spellCheck={false} onFocus={(e) => e.currentTarget.select()} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && v.trim()) done(v.trim()); }} /></label></div>
      <div className="dlg-f"><Btn onClick={() => done(null)}>Cancel</Btn><Btn primary disabled={!v.trim()} onClick={() => done(v.trim())}>{req.ok}</Btn></div>
    </Modal>
  );
}
