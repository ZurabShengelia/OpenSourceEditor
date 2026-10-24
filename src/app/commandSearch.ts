import type { MenuItem } from "../editor/Menu";

export interface Command { id: string; title: string; group: string; shortcut?: string; keywords?: string; enabled: boolean; checked?: boolean; run: () => void }

export function score(c: Pick<Command, "title" | "group" | "keywords">, query: string): number | null {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean); if (!words.length) return 0; const title = c.title.toLowerCase(), rest = `${c.group} ${c.keywords ?? ""}`.toLowerCase(); let total = 0;
  for (const w of words) {
    const i = title.indexOf(w);
    if (i >= 0) total += (i === 0 || /\W/.test(title[i - 1]!) ? 0 : 6) + Math.min(i, 5); else if (rest.includes(w)) total += 20; else return null;
  }
  return total + title.length / 100;
}
export function search(cmds: readonly Command[], query: string): Command[] {
  return cmds.map((c, i) => ({ c, i, s: score(c, query) })).filter((x): x is { c: Command; i: number; s: number } => x.s !== null).sort((a, b) => (a.c.enabled === b.c.enabled ? 0 : a.c.enabled ? -1 : 1) || a.s - b.s || a.i - b.i).map((x) => x.c);
}
export function fromMenu(group: string, items: readonly MenuItem[]): Command[] {
  return items.flatMap((it, i): Command[] => ("label" in it && it.label && it.onSelect ? [{ id: `${group}:${it.label}:${i}`, title: it.label.replace(/…$/, ""), group, ...(it.shortcut ? { shortcut: it.shortcut } : {}), enabled: !it.disabled, ...(it.checked !== undefined ? { checked: it.checked } : {}), run: it.onSelect }] : []));
}
