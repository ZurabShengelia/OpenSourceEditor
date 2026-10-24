import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { Icon, type IconName } from "../ui/Icon";

export type MenuItem =
  | { sep: true }
  | { heading: string }
  | { label: string; shortcut?: string; disabled?: boolean; checked?: boolean; danger?: boolean; onSelect: () => void };

export function MenuItems({ items, close }: { items: readonly MenuItem[]; close: () => void }) {
  return <>{items.map((it, i) => {
    if ("sep" in it) return <div key={`s${i}`} className="hsep" role="separator" />;
    if ("heading" in it) return <div key={`h${i}`} className="mi-label">{it.heading}</div>;
    const check = it.checked !== undefined;
    return <button key={`${i}${it.label}`} role={check ? "menuitemcheckbox" : "menuitem"} aria-checked={check ? it.checked : undefined} disabled={it.disabled} className={`mi ${it.danger ? "danger" : ""}`} onClick={() => { close(); it.onSelect(); }}>
      {it.checked && <span className="chk-ico"><Icon name="check" size={13} /></span>}<span>{it.label}</span>{it.shortcut && <span className="mi-k">{it.shortcut}</span>}</button>;
  })}</>;
}
export function menuKeys(e: { key: string; preventDefault(): void }, root: HTMLElement | null): void {
  if (!root) return; const items = Array.from(root.querySelectorAll<HTMLButtonElement>(".mi:not(:disabled)")); if (!items.length) return;
  const i = items.indexOf(document.activeElement as HTMLButtonElement);
  if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length]!.focus(); } else if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length]!.focus(); }
  else if (e.key === "Home") { e.preventDefault(); items[0]!.focus(); } else if (e.key === "End") { e.preventDefault(); items[items.length - 1]!.focus(); }
}

let openId: string | null = null; const subs = new Set<() => void>();
const setOpen = (id: string | null): void => { openId = id; subs.forEach((f) => f()); };
const useOpen = (): string | null => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => openId);
export const isMenuOpen = (): boolean => openId !== null;

export function Menu({ id, label, icon, items, align = "left", bar, primary, trigger, ghost }: { id: string; ghost?: boolean; label?: string; icon?: IconName; items: readonly MenuItem[]; align?: "left" | "right"; bar?: boolean; primary?: boolean; trigger?: ReactNode }) {
  const open = useOpen() === id; const ref = useRef<HTMLDivElement>(null), pop = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return; pop.current?.focus();
    const away = (e: PointerEvent): void => { if (!(e.target instanceof Node && ref.current?.contains(e.target))) setOpen(null); };
    const esc = (e: KeyboardEvent): void => { if (e.key === "Escape") { setOpen(null); (ref.current?.querySelector("button") as HTMLElement | null)?.focus(); } };
    const blur = (): void => setOpen(null);
    window.addEventListener("pointerdown", away); window.addEventListener("keydown", esc); window.addEventListener("blur", blur);
    return () => { window.removeEventListener("pointerdown", away); window.removeEventListener("keydown", esc); window.removeEventListener("blur", blur); };
  }, [open]);
  const cls = primary ? "btn primary" : bar ? "menu-btn" : trigger ? "ibtn" : ghost ? "btn sm ghost" : "btn";
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button className={cls} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(open ? null : id)} onPointerEnter={() => { if (bar && openId !== null && openId !== id) setOpen(id); }}
        onKeyDown={(e) => { if (e.key === "ArrowDown" && !open) { e.preventDefault(); setOpen(id); } }}>{trigger ?? <>{icon && <Icon name={icon} size={14} />}{label}</>}</button>
      {open && <div ref={pop} tabIndex={-1} role="menu" aria-label={label} className="menu" style={{ top: "100%", marginTop: 3, ...(align === "right" ? { right: 0 } : { left: 0 }) }} onKeyDown={(e) => menuKeys(e, pop.current)}><MenuItems items={items} close={() => { const trig = ref.current?.querySelector("button[aria-haspopup]") as HTMLElement | null; trig?.focus(); setOpen(null); setTimeout(() => { if (trig && document.activeElement === trig && !document.querySelector("[role=dialog]")) trig.blur(); }, 0); }} /></div>}
    </div>
  );
}
