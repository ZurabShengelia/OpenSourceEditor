const { chromium } = require("./launch.cjs"); const http = require("http"), fs = require("fs");
const srv = http.createServer((q, r) => { const f = q.url.split("?")[0] === "/" ? "index.html" : q.url.slice(1); try { const b = fs.readFileSync((process.env.BUNDLE_DIR || "dist") + "/" + f); r.setHeader("content-type", f.endsWith(".js") ? "text/javascript" : f.endsWith(".css") ? "text/css" : "text/html"); r.end(b); } catch { r.statusCode = 404; r.end(); } });
const results = []; const check = (n, ok, x = "") => { results.push(ok); console.log(ok ? "PASS" : "FAIL", n, x); };
(async () => {
  await new Promise((r) => srv.listen(8124, r));
  const b = await chromium.launch({ args: ["--no-sandbox"] }); const errs = [];
  const open = async (entry) => { const ctx = await b.newContext({ viewport: { width: 1500, height: 900 } }); await ctx.addInitScript((e) => { try { sessionStorage.setItem("loupe.entry", e); } catch {} }, entry); const pg = await ctx.newPage(); pg.on("pageerror", (e) => errs.push(e.message)); await pg.goto("http://localhost:8124/#/editor"); return pg; };
  const px = (pg, x, y) => pg.evaluate(([x, y]) => { const c = document.querySelector("canvas[aria-label='Image canvas']"); return Array.from(c.getContext("2d").getImageData(x, y, 1, 1).data); }, [x, y]);
  const dims = (pg) => pg.evaluate(() => { const c = document.querySelector("canvas[aria-label='Image canvas']"); return [c.width, c.height]; });
  const setNum = async (pg, label, v) => { const i = pg.getByLabel(label, { exact: true }); await i.fill(String(v)); await i.press("Tab"); };

  let pg = await open("photo"); await pg.getByRole("dialog", { name: "New photo project" }).waitFor();
  check("landing 'photo' entry opens the New photo project dialog", true);
  await pg.getByLabel("Document name").fill("Poster"); await setNum(pg, "Width in pixels", 800); await setNum(pg, "Height in pixels", 600);
  await pg.getByRole("button", { name: "Black", exact: true }).click();
  check("dialog states exact pixel size", (await pg.locator(".np-note").innerText()).startsWith("800 × 600 px"), await pg.locator(".np-note").innerText());
  await pg.getByRole("button", { name: "Create" }).click(); await pg.getByRole("dialog").waitFor({ state: "detached" });
  await pg.waitForTimeout(300);
  check("document is exactly 800x600", JSON.stringify(await dims(pg)) === "[800,600]", JSON.stringify(await dims(pg)));
  check("black background is real pixels", JSON.stringify(await px(pg, 10, 10)) === "[0,0,0,255]", JSON.stringify(await px(pg, 10, 10)));
  check("a Background layer exists", await pg.getByText("Background", { exact: true }).count() > 0);

  const cv = pg.locator("canvas[aria-label='Image canvas']"); const box = await cv.boundingBox(); const z = box.width / 800; const at = (x, y) => [box.x + x * z, box.y + y * z];
  await pg.getByRole("button", { name: "Shape" }).first().click(); await pg.getByRole("button", { name: "Rectangle", exact: true }).click().catch(() => {});
  let [x0, y0] = at(100, 100), [x1, y1] = at(300, 200); await pg.mouse.move(x0, y0); await pg.mouse.down(); await pg.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 }); await pg.mouse.move(x1, y1, { steps: 4 }); await pg.mouse.up(); await pg.waitForTimeout(300);
  const inShape = await px(pg, 200, 150); check("shape was drawn (light pixels inside)", inShape[0] > 200, JSON.stringify(inShape));
  await pg.getByRole("button", { name: "Magic Wand" }).click(); const [cx, cy] = at(200, 150); await pg.mouse.click(cx, cy); await pg.waitForTimeout(300);
  const t = await pg.locator(".opts .mono").first().innerText(); const m = /Selection (\d+)×(\d+)/.exec(t);
  check("Magic Wand selects the shape's pixels (≈200×100)", !!m && Math.abs(+m[1] - 200) <= 3 && Math.abs(+m[2] - 100) <= 3, t);
  check("selection overlay is drawn", await pg.locator("canvas[aria-hidden=true]").count() > 0);

  await pg.evaluate(() => { const i = document.querySelector("nav[aria-label=Tools] input[type=color]"); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(i, "#ff0000"); i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true })); });
  await pg.getByRole("button", { name: "Fill" }).click(); await pg.mouse.click(cx, cy); await pg.waitForTimeout(300);
  const inside = await px(pg, 200, 150), outside = await px(pg, 50, 50), edgeIn = await px(pg, 150, 120);
  check("fill paints inside the selection", inside[0] > 230 && inside[1] < 40, JSON.stringify(inside)); check("fill leaves the outside untouched", JSON.stringify(outside) === "[0,0,0,255]", JSON.stringify(outside));
  check("fill reaches inside the selected shape up to its edge", edgeIn[0] > 230 && edgeIn[1] < 40, JSON.stringify(edgeIn));

  await pg.keyboard.press("Control+Shift+I"); await pg.waitForTimeout(200);
  await pg.getByRole("button", { name: "Magic Wand" }).click(); const t2 = await pg.locator(".opts .mono").first().innerText(); await pg.getByRole("button", { name: "Fill" }).click(); check("invert selection covers the rest of the image", /Selection 800×600/.test(t2), t2);
  await pg.evaluate(() => { const i = document.querySelector("nav[aria-label=Tools] input[type=color]"); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(i, "#00ff00"); i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true })); });
  const [ox, oy] = at(600, 400); await pg.mouse.click(ox, oy); await pg.waitForTimeout(300);
  const o2 = await px(pg, 50, 50), i2 = await px(pg, 200, 150);
  check("after invert, fill paints outside", o2[1] > 230 && o2[0] < 40, JSON.stringify(o2)); check("after invert, the shape area is protected", i2[0] > 230 && i2[1] < 40, JSON.stringify(i2));
  await pg.keyboard.press("Control+d"); await pg.waitForTimeout(150); await pg.getByRole("button", { name: "Magic Wand" }).click(); check("deselect clears the selection", !/Selection \d/.test(await pg.locator(".opts").innerText()));
  await pg.keyboard.press("Control+z"); await pg.waitForTimeout(250); const u = await px(pg, 50, 50); check("undo reverts the last fill", JSON.stringify(u) === "[0,0,0,255]", JSON.stringify(u));
  await pg.context().close();

  pg = await open("photo"); await pg.getByRole("dialog", { name: "New photo project" }).waitFor(); await setNum(pg, "Width in pixels", 640); await setNum(pg, "Height in pixels", 360);
  await pg.getByRole("button", { name: "Transparent", exact: true }).click(); await pg.getByRole("button", { name: "Create" }).click(); await pg.getByRole("dialog").waitFor({ state: "detached" }); await pg.waitForTimeout(300);
  check("transparent document is 640x360", JSON.stringify(await dims(pg)) === "[640,360]"); check("transparent document has alpha 0 (not white)", (await px(pg, 5, 5))[3] === 0, JSON.stringify(await px(pg, 5, 5)));
  check("checkerboard is shown", await pg.locator(".vp-content .checker").count() === 1); check("no Background layer is created", await pg.getByText("Background", { exact: true }).count() === 0);
  await pg.keyboard.press("Escape");
  await pg.context().close();

  pg = await open("photo"); await pg.getByRole("dialog", { name: "New photo project" }).waitFor(); await pg.getByRole("button", { name: "1080 × 1920" }).click();
  check("preset fills width/height", (await pg.getByLabel("Width in pixels", { exact: true }).inputValue()).includes("1080") && (await pg.getByLabel("Height in pixels", { exact: true }).inputValue()).includes("1920"));
  await pg.context().close();
  check("no page errors", errs.length === 0, errs.join(" | "));
  const ok = results.filter(Boolean).length; console.log(`${ok}/${results.length} passed`); await b.close(); srv.close(); process.exit(ok === results.length ? 0 : 1);
})().catch((e) => { console.error("ERROR", e); process.exit(1); });
