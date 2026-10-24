const { spawnSync } = require("node:child_process"); const path = require("node:path");
const plain = ["smoke-ui", "smoke-redesign", "smoke-storage-audio", "smoke-export-audio", "smoke-timeline", "smoke-responsive", "smoke-compound-palette", "smoke-photo-tools", "smoke-menus", "smoke-brand"], hooked = ["smoke-offline-export", "smoke-reliability", "smoke-inspector", "smoke-rotation"];
let failed = 0;
for (const [list, dir] of [[plain, process.env.BUNDLE_DIR || "dist"], [hooked, process.env.BUNDLE_TEST_DIR || "dist-test"]]) for (const s of list) {
  const r = spawnSync("node", [path.join(__dirname, `${s}.cjs`)], { env: { ...process.env, BUNDLE_DIR: dir }, encoding: "utf8", timeout: 600000 });
  const out = (r.stdout || "") + (r.stderr || ""); const sum = /(\d+)\/(\d+) passed/.exec(out); const ok = r.status === 0; if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${s}: ${sum ? sum[0] : out.trim().split("\n").slice(-2).join(" | ")}`); if (!ok) console.log(out.split("\n").filter((l) => /^FAIL|ERROR/.test(l)).join("\n"));
}
process.exit(failed ? 1 : 0);
