/**
 * Live mode: the canvas shows the target's own running app, and we can steer
 * it. Needs BOTH dev servers: u-and-i's (`npx vite`, 4400) and the target's
 * (`npm run dev`, default 3000).
 *
 *   node scripts/checks/live-canvas.mjs [screenshot-prefix]
 */
import { playwright, reporter, liveOrigin } from "./_shared.mjs";

const { chromium } = playwright();
const { check, done } = reporter();
const shot = process.argv[2] ?? null;

const origin = await liveOrigin();
check(!!origin, `live mirror reachable: ${origin}`);
if (!origin) done();

// Paths that must NOT redirect while signed out — the canvas has no session.
const OPEN_PATH = "/terms";
const ROUTE_ROW = "support";

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
try {
  await page.goto("http://localhost:4400/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await page.click('button:has-text("Live app")');
  await page.waitForTimeout(6000);

  const liveFrames = () => page.frames().map((f) => f.url()).filter((u) => u.startsWith(origin));
  check(liveFrames().length === 1, `live frame present: ${liveFrames()[0]}`);
  check(!(await page.locator("canvas").count()), "rulers hidden in live mode");

  // The probe hides Next's dev-tools badge (only the badge — error
  // overlays in the same shadow root must survive).
  const badge = await page
    .frames()
    .find((f) => f.url().startsWith(origin))
    .evaluate(() => {
      const p = document.querySelector("nextjs-portal");
      if (!p || !p.shadowRoot) return { portal: false };
      const el = p.shadowRoot.querySelector("#devtools-indicator");
      return {
        portal: true,
        styled: !!p.shadowRoot.querySelector("style[data-uai-hide-badge]"),
        hidden: !el || getComputedStyle(el).display === "none",
      };
    });
  check(badge.portal && badge.styled && badge.hidden, `dev-tools badge hidden: ${JSON.stringify(badge)}`);

  const pathInput = page.getByLabel("Live app path");
  await pathInput.fill(OPEN_PATH);
  await pathInput.press("Enter");
  await page.waitForTimeout(5000);
  check(liveFrames()[0]?.endsWith(OPEN_PATH), `path bar steers the app: ${liveFrames()[0]}`);
  if (shot) await page.screenshot({ path: `${shot}-path.png` });

  const caret = page.locator('.hv-row:has-text("(auth)") button').first();
  if (await caret.count()) {
    await caret.click();
    await page.waitForTimeout(600);
    const row = page.locator(`.hv-row:has-text("${ROUTE_ROW}")`).first();
    if (await row.count()) {
      await row.click();
      await page.waitForTimeout(5000);
      check(liveFrames()[0]?.endsWith(`/${ROUTE_ROW}`), `route click steers the app: ${liveFrames()[0]}`);
      if (shot) await page.screenshot({ path: `${shot}-route.png` });
    } else {
      check(false, `route row "${ROUTE_ROW}" not found`);
    }
  } else {
    check(false, "could not expand the (auth) group");
  }
} finally {
  await browser.close();
  done();
}
