const { chromium } = require("./launch.cjs"); const http = require("http"), fs = require("fs");
const srv = http.createServer((q, r) => { const f = q.url.split("?")[0] === "/" ? "index.html" : q.url.slice(1); try { r.setHeader("content-type", f.endsWith(".js") ? "text/javascript" : f.endsWith(".css") ? "text/css" : "text/html"); r.end(fs.readFileSync((process.env.BUNDLE_DIR || "dist") + "/" + f)); } catch { r.statusCode = 404; r.end(); } });
const res = []; const check = (n, ok, x = "") => { res.push(ok); console.log(ok ? "PASS" : "FAIL", n, x); };
(async () => {
  await new Promise((r) => srv.listen(8129, r));
  const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ["--no-sandbox"] }); const errs = [];
  for (const [w, h] of [[1920, 1080], [1440, 900], [1280, 720], [1024, 700]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h } }); await ctx.addInitScript(() => { try { sessionStorage.setItem("loupe.started", "1"); localStorage.clear(); } catch {} });
    const pg = await ctx.newPage(); pg.on("pageerror", (e) => errs.push(e.message)); await pg.goto("http://localhost:8129/index.html#/editor"); await pg.waitForSelector("text=Media", { timeout: 8000 }).catch(() => null); await pg.waitForTimeout(400);
    const m = await pg.evaluate(() => { const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), l: Math.round(b.left), r: Math.round(b.right) }; }; return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, tl: r("section.tl"), center: r(".center"), preview: r(".center canvas") || r(".center") }; });
    check(`${w}px: no horizontal page overflow`, m.sw <= m.cw + 1, `${m.sw}/${m.cw}`);
    check(`${w}px: timeline and preview area are usable`, !!m.tl && m.tl.w >= (w < 1180 ? 640 : 520) && m.tl.h >= 120 && m.center.w >= 520, `timeline ${m.tl && m.tl.w}x${m.tl && m.tl.h}, center ${m.center && m.center.w}`);
    if (w < 1180) {
      const insp = pg.getByRole("button", { name: "Show inspector" }); check(`${w}px: inspector starts collapsed to a rail`, await insp.count() === 1);
      await insp.click(); await pg.waitForTimeout(300); const d = await pg.evaluate(() => { const e = document.querySelector(".drawer.r"); const c = document.querySelector(".center"); if (!e || !c) return null; const eb = e.getBoundingClientRect(), cb = c.getBoundingClientRect(); return { drawerW: Math.round(eb.width), drawerL: Math.round(eb.left), centerW: Math.round(cb.width) }; });
      check(`${w}px: inspector opens as an overlay drawer without shrinking the preview/timeline`, !!d && d.drawerW >= 240 && d.drawerL + d.drawerW <= w + 1 && d.centerW >= m.center.w - 2, JSON.stringify(d));
      await pg.screenshot({ path: `/tmp/resp-${w}-drawer.png` }); await pg.locator(".drawer-scrim").click({ position: { x: 100, y: 100 } }); await pg.waitForTimeout(200); check(`${w}px: clicking outside closes the drawer`, await pg.locator(".drawer").count() === 0);
      await pg.getByRole("button", { name: "Show media panel" }).click(); await pg.waitForTimeout(250); check(`${w}px: media panel opens as a left drawer`, await pg.locator(".drawer.l").count() === 1); await pg.keyboard.press("Escape");
    } else { check(`${w}px: media panel and inspector docked`, await pg.locator(".drawer").count() === 0 && await pg.getByRole("button", { name: "Show inspector" }).count() === 0); await pg.screenshot({ path: `/tmp/resp-${w}.png` }); }
    await ctx.close();
  }
  check("no page errors", errs.length === 0, errs.join(" | "));
  console.log(`\n${res.filter(Boolean).length}/${res.length} passed`); await b.close(); srv.close(); process.exit(res.every(Boolean) ? 0 : 1);
})().catch((e) => { console.log("HARNESS ERROR", e.message.slice(0, 600)); process.exit(2); });
