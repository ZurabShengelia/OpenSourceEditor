const { chromium } = require("./launch.cjs"); const http = require("http"), fs = require("fs");
const srv = http.createServer((q, r) => { const f = q.url.split("?")[0] === "/" ? "index.html" : q.url.slice(1); try { const b = fs.readFileSync((process.env.BUNDLE_DIR || "dist") + "/" + f); r.setHeader("content-type", f.endsWith(".js") ? "text/javascript" : f.endsWith(".css") ? "text/css" : "text/html"); r.end(b); } catch { r.statusCode = 404; r.end(); } });
const res = []; const check = (n, ok, x = "") => { res.push(ok); console.log(ok ? "PASS" : "FAIL", n, x); };
(async () => {
  await new Promise((r) => srv.listen(8131, r)); const b = await chromium.launch({ args: ["--no-sandbox"] });
  for (const mode of ["video", "photo"]) {
    const ctx = await b.newContext({ viewport: { width: 1500, height: 900 } }); await ctx.addInitScript(() => sessionStorage.setItem("loupe.started", "1")); const pg = await ctx.newPage(); await pg.goto("http://localhost:8131/#/editor"); await pg.waitForTimeout(500);
    await pg.getByRole("tab", { name: mode }).click(); await pg.waitForTimeout(250);
    const top = (sel) => pg.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); if (r.width < 20 || r.height < 20) return false; for (const [x, y] of [[r.x + r.width / 2, r.y + 8], [r.x + 12, r.y + r.height - 8]]) if (!e.contains(document.elementFromPoint(x, y))) return false; return true; }, sel);
    for (const n of ["File", "Edit", "View"]) { await pg.getByRole("button", { name: n, exact: true }).click(); await pg.waitForTimeout(150); check(`${mode}: ${n} menu is visible and on top`, await top("[role=menu]")); await pg.keyboard.press("Escape"); await pg.waitForTimeout(100); }
    await pg.getByRole("button", { name: /^Export/ }).first().click(); await pg.waitForTimeout(150); check(`${mode}: Export menu is visible and on top`, await top("[role=menu]"));
    await pg.getByRole("menuitem", { name: /Export (video|image)/ }).click(); await pg.waitForTimeout(300); check(`${mode}: Export opens its dialog`, await top("[role=dialog]"));
    await ctx.close();
  }
  const ok = res.filter(Boolean).length; console.log(`${ok}/${res.length} passed`); await b.close(); srv.close(); process.exit(ok === res.length ? 0 : 1);
})().catch((e) => { console.error("ERROR", e); process.exit(1); });
