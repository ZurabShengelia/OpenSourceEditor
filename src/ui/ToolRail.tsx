import type { ReactNode } from "react";
import { tip } from "./controls";
import { Icon, type IconName } from "./Icon";

export type { IconName };
export interface RailItem { icon: IconName; label: string; shortcut?: string; onClick: () => void; group: number; active?: boolean }

export function ToolRail({ items, color, onColor }: { items: RailItem[]; color?: string; onColor?: (c: string) => void }) {
  const out: ReactNode[] = [];
  items.forEach((it, i) => {
    const prev = items[i - 1]; if (prev && prev.group !== it.group) out.push(<hr key={`s${i}`} />);
    out.push(<button key={it.label} className="ibtn" onClick={it.onClick} aria-label={it.label} aria-pressed={it.active} {...tip(it.label, it.shortcut)}><Icon name={it.icon} size={17} /></button>);
  });
  return (
    <nav aria-label="Tools" className="toolrail">{out}
      {color !== undefined && onColor && <><div style={{ flex: 1 }} /><input type="color" className="swatch" style={{ width: 26, height: 26 }} aria-label="Brush and fill color" value={color} onChange={(e) => onColor(e.target.value)} {...tip("Brush and fill color")} /></>}
    </nav>
  );
}
