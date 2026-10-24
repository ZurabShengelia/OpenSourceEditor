const { chromium } = require("./launch.cjs"); const http = require("http"), fs = require("fs");
const srv = http.createServer((q, r) => { const f = q.url.split("?")[0] === "/" ? "index.html" : q.url.slice(1); try { const b = fs.readFileSync((process.env.BUNDLE_DIR || "dist") + "/" + f); r.setHeader("content-type", f.endsWith(".js") ? "text/javascript" : f.endsWith(".css") ? "text/css" : "text/html"); r.end(b); } catch { r.statusCode = 404; r.end(); } });
const res = []; const check = (n, ok, x = "") => { res.push(ok); console.log(ok ? "PASS" : "FAIL", n, x); };
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{FE0F}]/u;
(async () => {
  await new Promise((r) => srv.listen(8132, r)); const b = await chromium.launch({ args: ["--no-sandbox"] });
  let ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); let pg = await ctx.newPage(); await pg.goto("http://localhost:8132/#/"); await pg.waitForTimeout(500);
  const text = async () => pg.evaluate(() => document.body.innerText + " " + [...document.querySelectorAll("[aria-label],[title],[placeholder]")].map((e) => (e.getAttribute("aria-label") || "") + " " + (e.getAttribute("title") || "") + " " + (e.getAttribute("placeholder") || "")).join(" "));
  check("tab title is OpenSourceEditor", (await pg.title()).startsWith("OpenSourceEditor"), await pg.title());
  let t = await text(); check("landing names the product", t.includes("OpenSourceEditor")); check("landing has no old name", !/Loupe/i.test(t)); check("landing has no emoji", !EMOJI.test(t));
  check("landing has a logo (svg)", await pg.locator(".brand svg").count() > 0 && await pg.locator(".ld-brand svg").count() === 1);
  check("landing has no glow/blob layers", await pg.locator(".ld-glow, [class*=blob], [class*=glow]").count() === 0);
  const bgImgs = await pg.evaluate(() => [...document.querySelectorAll("*")].filter((e) => /radial-gradient/.test(getComputedStyle(e).backgroundImage)).length); check("no radial-gradient backgrounds anywhere on landing", bgImgs === 0, String(bgImgs));
  await ctx.close();
  for (const mode of ["video", "photo"]) {
    ctx = await b.newContext({ viewport: { width: 1500, height: 900 } }); await ctx.addInitScript(() => sessionStorage.setItem("loupe.started", "1")); pg = await ctx.newPage(); await pg.goto("http://localhost:8132/#/editor"); await pg.waitForTimeout(500); await pg.getByRole("tab", { name: mode }).click(); await pg.waitForTimeout(250);
    t = await text(); check(`${mode}: header shows OpenSourceEditor`, t.includes("OpenSourceEditor")); check(`${mode}: no old name`, !/Loupe/i.test(t)); check(`${mode}: no emoji`, !EMOJI.test(t));
    await pg.getByRole("button", { name: /^Export/ }).first().click(); await pg.getByRole("menuitem", { name: /Export (video|image)/ }).click(); await pg.waitForTimeout(500);
    t = await text(); check(`${mode}: export dialog has no old name or emoji`, !/Loupe/i.test(t) && !EMOJI.test(t));
    const glow = await pg.evaluate(() => [...document.querySelectorAll("*")].filter((e) => /radial-gradient/.test(getComputedStyle(e).backgroundImage)).length); check(`${mode}: no radial-gradient glow layers`, glow === 0, String(glow));
    await ctx.close();
  }
  const ok = res.filter(Boolean).length; console.log(`${ok}/${res.length} passed`); await b.close(); srv.close(); process.exit(ok === res.length ? 0 : 1);
})().catch((e) => { console.error("ERROR", e); process.exit(1); });
