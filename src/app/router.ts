import { useSyncExternalStore } from "react";

export type Route = "home" | "editor";

function parse(hash: string): Route { return hash.replace(/^#\/?/, "") === "editor" ? "editor" : "home"; }
function subscribe(cb: () => void): () => void {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}
export const useRoute = (): Route => useSyncExternalStore(subscribe, () => parse(window.location.hash));
export const href = (r: Route): string => (r === "home" ? "#/" : "#/editor");
