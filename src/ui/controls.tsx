import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { gesture } from "../app/store";
import { Icon, type IconName } from "./Icon";

export const tip = (label: string, key?: string): Record<string, string> => (key ? { "data-tip": label, "data-key": key } : { "data-tip": label });

export function IconButton({ icon, label, keys, pressed, onClick, disabled, size, className = "", expanded, id }: { icon: IconName; label: string; keys?: string; pressed?: boolean; onClick?: (e: React.MouseEvent) => void; disabled?: boolean; size?: "sm" | "xs"; className?: string; expanded?: boolean; id?: string }) {
  return <button id={id} className={`ibtn ${size ?? ""} ${className}`} aria-label={label} aria-pressed={pressed} aria-expanded={expanded} disabled={disabled} onClick={onClick} {...tip(label, keys)}><Icon name={icon} size={size === "xs" ? 12 : size === "sm" ? 14 : 16} /></button>;
}

export function Section({ title, children, right, open = true, hint, badge }: { title: string; children: ReactNode; right?: ReactNode; open?: boolean; hint?: string; badge?: string | number }) {
  const [on, setOn] = useState(open);
  return <section className={`sec ${on ? "" : "closed"}`}><div className="sec-h"><button className="sec-t" aria-expanded={on} onClick={() => setOn(!on)}><span className="chev"><Icon name="chevD" size={12} /></span><span>{title}</span>{badge !== undefined && <span className="badge" aria-label={`${badge} active`}>{badge}</span>}</button>{on && right}</div>{on && hint && <p className="m-0 pr-3.5 pb-2.5 pl-[30px] text-xs leading-normal text-muted">{hint}</p>}<div className="sec-b">{children}</div></section>;
}
export function Hint({ children }: { children: ReactNode }) { return <p className="hint">{children}</p>; }
export function Field({ label, children, title, hint }: { label: string; children: ReactNode; title?: string; hint?: string }) {
  return <div className="field"><span className={`lab ${hint ? "has-tip" : ""}`} title={title} {...(hint ? tip(hint) : {})}>{label}</span><div className="ctl">{children}</div></div>;
}
export function Tabs({ tabs, value, onChange }: { tabs: readonly string[]; value: string; onChange: (t: string) => void }) {
  return <div role="tablist" className="tabs">{tabs.map((t) => <button key={t} role="tab" aria-selected={value === t} className="tab" onClick={() => onChange(t)}>{t}</button>)}</div>;
}
export function Seg<T extends string>({ value, options, onChange, label, full }: { value: T; options: readonly { id: T; label?: ReactNode; icon?: IconName; tip?: string; count?: number }[]; onChange: (v: T) => void; label: string; full?: boolean }) {
  return <div className={`seg ${full ? "full" : ""}`} role="group" aria-label={label}>{options.map((o) => <button key={o.id} aria-pressed={value === o.id} onClick={() => onChange(o.id)} {...(o.tip ? tip(o.tip) : {})} aria-label={o.tip}>{o.icon && <Icon name={o.icon} size={14} />}{o.label}{o.count !== undefined && <span className="cnt">{o.count}</span>}</button>)}</div>;
}

const decimals = (step: number): number => Math.min(3, Math.max(0, Math.round(-Math.log10(step))));
const clampTo = (v: number, min?: number, max?: number): number => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));

export function NumberBox({ value, onChange, min, max, step = 1, label, unit, wide }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; label: string; unit?: string; wide?: boolean }) {
  const [draft, setDraftState] = useState<string | null>(null); const dref = useRef<string | null>(null); const dp = decimals(step);
  const setDraft = (v: string | null): void => { dref.current = v; setDraftState(v); };
  const commit = (): void => { const d = dref.current; if (d === null) return; setDraft(null); const n = Number(d); if (d.trim() !== "" && Number.isFinite(n)) onChange(clampTo(n, min, max)); };
  const shown = Number.isFinite(value) ? String(Math.round(value * 10 ** Math.max(dp, 2)) / 10 ** Math.max(dp, 2)) : "0";
  return <span className={`num ${wide ? "wide" : ""}`}><input aria-label={label} type="text" inputMode="decimal" spellCheck={false} value={draft ?? shown}
    onFocus={(e) => e.currentTarget.select()} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
    onKeyDown={(e) => {
      if (e.key === "Enter") { commit(); (e.target as HTMLInputElement).blur(); } else if (e.key === "Escape") { setDraft(null); (e.target as HTMLInputElement).blur(); }
      else if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); const k = e.shiftKey ? 10 : e.altKey ? 0.1 : 1, base = draft !== null && Number.isFinite(Number(draft)) ? Number(draft) : value; setDraft(null); onChange(clampTo(Math.round((base + (e.key === "ArrowUp" ? 1 : -1) * step * k) * 10 ** (dp + 1)) / 10 ** (dp + 1), min, max)); }
    }} />{unit !== undefined && <i>{unit}</i>}</span>;
}

export function Slider({ label, value, min, max, step = 1, onChange, def, unit = "", keyed, bare, hint }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; def?: number; unit?: string; keyed?: ReactNode; bare?: boolean; hint?: string }) {
  const pct = Math.min(100, Math.max(0, ((value - min) / (max - min || 1)) * 100)); const origin = def === undefined ? 0 : Math.min(100, Math.max(0, ((def - min) / (max - min || 1)) * 100)); const lo = Math.min(pct, origin), hi = Math.max(pct, origin); const dirty = def !== undefined && Math.abs(value - def) > 1e-9; const dp = decimals(step);
  const scrub = (e: React.PointerEvent): void => {
    if (e.button !== 0) return; e.preventDefault(); const x0 = e.clientX, v0 = value; gesture.begin();
    const mv = (ev: PointerEvent): void => { const k = ev.shiftKey ? 0.25 : 1, raw = v0 + ((ev.clientX - x0) / 220) * (max - min) * k; onChange(clampTo(Math.round(raw / step) * step, min, max)); };
    const up = (): void => { gesture.end(); window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); }; window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
  };
  return (
    <div className="field scrub" onDoubleClick={(e) => { if (def !== undefined && !(e.target as HTMLElement).closest("input,button")) onChange(def); }}>
      <span className={`lab ${hint ? "has-tip" : ""}`} onPointerDown={scrub} {...(hint ? tip(hint, "Drag to scrub") : {})} title={hint ? undefined : def !== undefined ? "Drag to scrub · double-click to reset" : "Drag to scrub"}>{label}</span>
      <div className="ctl">
        {!bare && <input aria-label={label} aria-description={hint} aria-valuetext={`${value}${unit}`} type="range" className="range" style={{ "--lo": `${lo}%`, "--hi": `${hi}%` } as CSSProperties} min={min} max={max} step={step} value={value}
          onPointerDown={() => gesture.begin()} onPointerUp={() => gesture.end()} onPointerCancel={() => gesture.end()} onBlur={() => gesture.end()} onChange={(e) => onChange(Number(e.target.value))} />}
        <NumberBox label={`${label} value`} value={Math.round(value * 10 ** dp) / 10 ** dp} min={min} max={max} step={step} onChange={onChange} unit={unit} wide={bare} />
        <span className="slot">{dirty && <button className="ibtn xs reset" aria-label={`Reset ${label}`} data-tip={`Reset ${label}`} onClick={() => onChange(def!)}><Icon name="reset" size={12} /></button>}</span>
        {keyed !== undefined && <span className="slot">{keyed}</span>}
      </div>
    </div>
  );
}
export function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return <label className="chk"><input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />{label}</label>;
}
export function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void }) {
  return <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)} className="sel grow">{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>;
}
export function Color({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <input aria-label={label} type="color" value={value} className="swatch" onPointerDown={() => gesture.begin()} onPointerUp={() => gesture.end()} onBlur={() => gesture.end()} onChange={(e) => onChange(e.target.value)} />;
}
export function Btn({ children, onClick, disabled, primary, sm, danger, label, className = "", tipLabel, keys, type = "button", autoFocus }: { children: ReactNode; onClick?: () => void; disabled?: boolean; primary?: boolean; sm?: boolean; danger?: boolean; label?: string; className?: string; tipLabel?: string; keys?: string; type?: "button" | "submit"; autoFocus?: boolean }) {
  return <button type={type} className={`btn ${primary ? "primary" : ""} ${sm ? "sm" : ""} ${danger ? "danger" : ""} ${className}`} onClick={onClick} disabled={disabled} aria-label={label} autoFocus={autoFocus} {...(tipLabel ? tip(tipLabel, keys) : {})}>{children}</button>;
}
export function useTimeoutFlag(ms: number): [boolean, () => void] { const [on, set] = useState(false); useEffect(() => { if (!on) return; const t = setTimeout(() => set(false), ms); return () => clearTimeout(t); }, [on, ms]); return [on, () => set(true)]; }
export function useOutside(ref: { current: HTMLElement | null }, active: boolean, close: () => void): void {
  useEffect(() => { if (!active) return; const f = (e: PointerEvent): void => { if (!(e.target instanceof Node && ref.current?.contains(e.target))) close(); }; window.addEventListener("pointerdown", f); return () => window.removeEventListener("pointerdown", f); }, [active, close, ref]);
}
export const fmt = (t: number, fps = 30): string => { const s = Math.max(0, t), m = Math.floor(s / 60), sec = Math.floor(s % 60), f = Math.floor((s % 1) * fps + 1e-6); return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}:${String(f).padStart(2, "0")}`; };
export const fmtSize = (n: number): string => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
