export interface History<T> { past: T[]; present: T; future: T[]; open: boolean; limit: number }
export const createHistory = <T,>(doc: T, limit = 200): History<T> => ({ past: [], present: doc, future: [], open: false, limit });

export function commit<T>(h: History<T>, next: T): History<T> {
  if (next === h.present) return h;
  return { ...h, past: [...h.past, h.present].slice(-h.limit), present: next, future: [], open: false };
}
export function beginGesture<T>(h: History<T>): History<T> {
  return h.open ? h : { ...h, past: [...h.past, h.present].slice(-h.limit), future: [], open: true };
}
export function updateGesture<T>(h: History<T>, next: T): History<T> { return h.open ? { ...h, present: next } : commit(h, next); }
export function endGesture<T>(h: History<T>): History<T> {
  if (!h.open) return h;
  const last = h.past[h.past.length - 1];
  return last === h.present ? { ...h, past: h.past.slice(0, -1), open: false } : { ...h, open: false };
}
export function undo<T>(h: History<T>): History<T> {
  const h2 = endGesture(h); const prev = h2.past[h2.past.length - 1]; if (prev === undefined) return h2;
  return { ...h2, past: h2.past.slice(0, -1), present: prev, future: [h2.present, ...h2.future] };
}
export function redo<T>(h: History<T>): History<T> {
  const next = h.future[0]; if (next === undefined) return h;
  return { ...h, past: [...h.past, h.present], present: next, future: h.future.slice(1) };
}
export const canUndo = <T,>(h: History<T>): boolean => h.past.length > 0;
export const canRedo = <T,>(h: History<T>): boolean => h.future.length > 0;
