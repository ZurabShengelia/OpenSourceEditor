import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CONTENT_SECURITY_POLICY as csp } from "../scripts/csp";

const root = new URL("..", import.meta.url).pathname;
const directive = (n: string): string[] => (csp.split("; ").find((d) => d.startsWith(n + " ")) ?? "").split(" ").slice(1);

test("the policy keeps the app local: no remote host, no wildcard, no eval, no inline script, no plugins", () => {
  assert.doesNotMatch(csp, /https?:|\*|unsafe-eval|unsafe-inline/); assert.deepEqual(directive("script-src"), ["'self'"]); assert.deepEqual(directive("connect-src"), ["'self'"]);
  assert.deepEqual(directive("object-src"), ["'none'"]); assert.deepEqual(directive("base-uri"), ["'none'"]); assert.deepEqual(directive("form-action"), ["'none'"]);
  assert.ok(directive("worker-src").includes("'self'"), "the export worker is same-origin");
  assert.ok(directive("media-src").includes("blob:") && directive("img-src").includes("blob:"), "opened files are blob: URLs");
});

test("index.html has no inline script (script-src 'self' would block it) and the production build adds the policy", () => {
  const html = readFileSync(root + "index.html", "utf8"); for (const m of html.matchAll(/<script\b([^>]*)>/g)) assert.match(m[1]!, /\bsrc=/, "inline <script> found");
  const cfg = readFileSync(root + "vite.config.ts", "utf8"); assert.match(cfg, /Content-Security-Policy/); assert.match(cfg, /apply:\s*"build"/, "the dev server must not get the policy (hot reload needs inline scripts)");
});
