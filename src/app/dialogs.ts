export type DialogReq =
  | { kind: "text"; title: string; label: string; value: string; ok: string; resolve: (v: string | null) => void }
  | { kind: "confirm"; title: string; message: string; ok: string; danger: boolean; resolve: (v: boolean) => void };
let host: ((r: DialogReq | null) => void) | null = null;
export const registerDialogHost = (f: ((r: DialogReq | null) => void) | null): void => { host = f; };

export function askText(title: string, value = "", opts: { label?: string; ok?: string } = {}): Promise<string | null> {
  if (!host) return Promise.resolve(window.prompt(title, value));
  return new Promise((resolve) => host!({ kind: "text", title, label: opts.label ?? "Name", value, ok: opts.ok ?? "OK", resolve }));
}
export function askConfirm(title: string, message: string, opts: { ok?: string; danger?: boolean } = {}): Promise<boolean> {
  if (!host) return Promise.resolve(window.confirm(message));
  return new Promise((resolve) => host!({ kind: "confirm", title, message, ok: opts.ok ?? "OK", danger: opts.danger ?? false, resolve }));
}
