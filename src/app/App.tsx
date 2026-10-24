import { lazy, Suspense, useEffect } from "react";
import { useRoute } from "./router";
import { Landing } from "../pages/Landing";
import { Mark } from "../ui/Icon";

const loadEditor = (): Promise<{ default: typeof import("../ui/EditorShell").EditorShell }> => import("../ui/EditorShell").then((m) => ({ default: m.EditorShell }));
const EditorShell = lazy(loadEditor);

function Boot() { return <div className="boot" role="status"><Mark size={44} /><span className="sr">Loading the editor</span></div>; }

export function App() {
  const route = useRoute();
  useEffect(() => { if (route === "editor") return; const t = setTimeout(() => void loadEditor(), 400); return () => clearTimeout(t); }, [route]);
  return route === "editor" ? <Suspense fallback={<Boot />}><EditorShell /></Suspense> : <Landing />;
}
