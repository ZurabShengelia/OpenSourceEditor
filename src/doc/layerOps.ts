import { group } from "./migrate";
import type { GroupNode, LayerNode } from "./schema";

export interface Found { node: LayerNode; parent: GroupNode; index: number }
export function find(root: GroupNode, id: string): Found | null {
  for (let i = 0; i < root.children.length; i++) {
    const n = root.children[i]!; if (n.id === id) return { node: n, parent: root, index: i };
    if (n.kind === "group") { const r = find(n, id); if (r) return r; }
  }
  return null;
}
const mapTree = (g: GroupNode, f: (n: LayerNode) => LayerNode | null): GroupNode => {
  const children: LayerNode[] = [];
  for (const n of g.children) { const m = f(n); if (m === null) continue; children.push(m.kind === "group" ? mapTree(m, f) : m); }
  return { ...g, children };
};
export const patchNode = (root: GroupNode, id: string, p: Partial<LayerNode>): GroupNode => mapTree(root, (n) => (n.id === id ? ({ ...n, ...p } as LayerNode) : n));
export const removeNode = (root: GroupNode, id: string): GroupNode => mapTree(root, (n) => (n.id === id ? null : n));
const editGroup = (root: GroupNode, gid: string, fn: (ch: LayerNode[]) => LayerNode[]): GroupNode =>
  gid === root.id ? { ...root, children: fn([...root.children]) }
    : mapTree(root, (n) => (n.kind === "group" && n.id === gid ? { ...n, children: fn([...n.children]) } : n));
const isInside = (g: GroupNode, id: string): boolean => g.children.some((c) => c.id === id || (c.kind === "group" && isInside(c, id)));

export function addNode(root: GroupNode, node: LayerNode, parentId?: string, index?: number): GroupNode {
  return editGroup(root, parentId ?? root.id, (ch) => { ch.splice(index ?? ch.length, 0, node); return ch; });
}
export function reorder(root: GroupNode, id: string, delta: number): GroupNode {
  const f = find(root, id); if (!f) return root;
  const to = Math.min(f.parent.children.length - 1, Math.max(0, f.index + delta)); if (to === f.index) return root;
  return editGroup(root, f.parent.id, (ch) => { const [m] = ch.splice(f.index, 1); ch.splice(to, 0, m!); return ch; });
}
export function moveTo(root: GroupNode, id: string, parentId: string, index?: number): GroupNode {
  const f = find(root, id); if (!f) return root;
  if (f.node.kind === "group" && (f.node.id === parentId || isInside(f.node, parentId))) return root;
  if (parentId !== root.id && find(root, parentId)?.node.kind !== "group") return root;
  return addNode(removeNode(root, id), f.node, parentId, index);
}
export function groupNodes(root: GroupNode, ids: readonly string[], gid: string, name = "Group"): GroupNode {
  const fs = ids.map((i) => find(root, i)).filter((x): x is Found => !!x); if (!fs.length) return root;
  const parent = fs[0]!.parent; if (fs.some((f) => f.parent.id !== parent.id)) return root;
  const members = [...fs].sort((a, b) => a.index - b.index).map((f) => f.node), top = Math.max(...fs.map((f) => f.index));
  return editGroup(root, parent.id, (ch) => { const rest = ch.filter((c) => !ids.includes(c.id)); rest.splice(top - (fs.length - 1), 0, group(gid, name, members)); return rest; });
}
export function ungroup(root: GroupNode, gid: string): GroupNode {
  const f = find(root, gid); if (!f || f.node.kind !== "group") return root; const kids = f.node.children;
  return editGroup(root, f.parent.id, (ch) => { ch.splice(f.index, 1, ...kids); return ch; });
}
export function duplicate(root: GroupNode, id: string, newId: () => string): GroupNode {
  const f = find(root, id); if (!f) return root;
  const clone = (n: LayerNode): LayerNode => { const c = { ...n, id: newId(), name: n.name } as LayerNode; return c.kind === "group" ? { ...c, children: c.children.map(clone) } : c; };
  const copy = clone(f.node); copy.name = `${f.node.name} copy`; return addNode(root, copy, f.parent.id, f.index + 1);
}
export function flatten(root: GroupNode): LayerNode[] { return root.children.flatMap((n) => (n.kind === "group" ? [n, ...flatten(n)] : [n])); }
