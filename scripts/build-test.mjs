import { spawnSync } from "node:child_process";
const r = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["vite", "build", "--mode", "test", "--outDir", "dist-test"], { stdio: "inherit" });
process.exit(r.status ?? 1);
