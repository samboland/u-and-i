/**
 * The offline card ("The app isn't running") must not be a dead zone: it is
 * served by the live proxy itself, gets the probe like any real page, and
 * relays ctrl+wheel zoom and middle-drag pan to the editor. It must NOT get
 * the select overlay — there is nothing to select, and the `npm run dev`
 * text has to stay copyable.
 *
 * Needs u-and-i's dev server (`npx vite`, 4400) and the target app DOWN —
 * the inverse of the live-* checks. Skips itself if the app is running.
 *
 *   node scripts/checks/live-offline.mjs
 */
import { playwright, reporter } from "./_shared.mjs";

/** 4400 like every check; UAI_PORT lets it run against a side instance. */
const PORT = process.env.UAI_PORT ?? "4400";

const { chromium } = playwright();
const { check, done } = reporter();

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

try {
  const live = await fetch(`http://localhost:${PORT}/api/project`)
    .then((r) => r.json())
    .then((r) => r.live?.origin ?? null);
  check(!!live, `live mirror is up at ${live}`);

  const html = await (await fetch(live + "/")).text();
  if (!html.includes("The app isn't running")) {
    check(true, "SKIP: the target app is running; the offline card never shows");
  } else {
    check(
      html.includes("/__uai/probe.js") && html.includes("__uaiStatic"),
      "offline card includes the probe with the static flag",
    );

    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);
    const frame = page.frames().find((f) => f.url().startsWith(live));
    check(!!frame, "editor canvas shows the offline card");

    const wrapperTransform = () =>
      page.evaluate((origin) => {
        const el = document.querySelector(`iframe[src^="${origin}"]`);
        return el?.parentElement ? getComputedStyle(el.parentElement).transform : null;
      }, live);
    const zoomLabel = () =>
      page.evaluate(() => {
        const m = document.body.textContent.match(/(\d+)%/);
        return m ? Number(m[1]) : null;
      });

    const z0 = await zoomLabel();
    await frame.evaluate(() => {
      window.dispatchEvent(new WheelEvent("wheel", { deltaY: -120, ctrlKey: true, clientX: 200, clientY: 200, cancelable: true }));
    });
    await page.waitForTimeout(500);
    const z1 = await zoomLabel();
    check(z1 !== null && z0 !== null && z1 > z0, `ctrl+wheel over the offline card zooms the canvas: ${z0}% -> ${z1}%`);

    const t0 = await wrapperTransform();
    await frame.evaluate(() => {
      window.dispatchEvent(new MouseEvent("mousedown", { button: 1, screenX: 300, screenY: 300, cancelable: true }));
      window.dispatchEvent(new MouseEvent("mousemove", { screenX: 380, screenY: 350 }));
      window.dispatchEvent(new MouseEvent("mouseup", { button: 1 }));
    });
    await page.waitForTimeout(500);
    const t1 = await wrapperTransform();
    check(t0 !== t1, `middle-drag over the offline card pans the frame: ${t0} -> ${t1}`);

    const hasOverlay = await frame.evaluate(() => {
      const els = [...document.querySelectorAll("div")];
      return els.some((d) => d.style.position === "fixed" && d.style.inset === "0px" && d.style.display !== "none");
    });
    check(!hasOverlay, "no select overlay sits over the offline card");
  }
} catch (err) {
  check(false, `check script threw: ${err?.message ?? err}`);
} finally {
  await browser.close();
  done();
}
