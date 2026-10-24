import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./app/App";

const container = document.getElementById("root");
if (!container) throw new Error("Root element missing");

async function start(): Promise<void> {
  if (__LOUPE_TEST__) (await import("./app/testHook")).installTestHook();
  createRoot(container!).render(<StrictMode><App /></StrictMode>);
}
void start();
