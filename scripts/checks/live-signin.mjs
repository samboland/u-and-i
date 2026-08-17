/**
 * Live sign-in flow: OAuth can't run inside the canvas iframe (GitHub won't
 * be framed), so the redirect banner opens the target's /signin in a
 * top-level window and reloads the frame when it closes — the session
 * cookie lands on host `localhost`, which ignores ports, so the mirror
 * sees it. A real OAuth completion needs human credentials; this verifies
 * every mechanical link in that chain. Needs BOTH dev servers.
 *
 *   node scripts/checks/live-signin.mjs [screenshot-prefix]
 */
import { playwright, reporter, liveOrigin } from "./_shared.mjs";

const { chromium } = playwright();
const { check, done } = reporter();
const shot = process.argv[2] ?? null;

const origin = await liveOrigin();
check(!!origin, `live mirror reachable: ${origin}`);
if (!origin) done();

const AUTHED_PATH = "/account"; // redirects to /signin while signed out

const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();
try {
  // Premise: a cookie set for host localhost (port 3000) rides along to the
  // mirror's port. If this ever breaks, the whole sign-in story breaks.
  await context.addCookies([
    { name: "uai-premise", value: "shared", url: "http://localhost:3000/" },
  ]);
  const probeReq = await page.request.get(`${origin}/terms`);
  check(probeReq.ok(), "mirror serves /terms");
  // Read document.cookie from a page ON the mirror origin — JS is
  // port-scoped even though the cookie jar isn't, so it must be read from
  // inside, not across window.open.
  const probePage = await context.newPage();
  await probePage.goto(`${origin}/terms`, { waitUntil: "domcontentloaded" });
  const echoed = await probePage.evaluate(() => document.cookie);
  await probePage.close();
  check(echoed.includes("uai-premise=shared"), `localhost cookie visible on the mirror port: "${echoed}"`);

  await page.goto("http://localhost:4400/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await page.click('button:has-text("Live app")');
  const pathInput = page.getByLabel("Live app path");
  await pathInput.fill(AUTHED_PATH);
  await pathInput.press("Enter");
  await page.waitForTimeout(6000);

  const banner = page.locator("text=usually a sign-in redirect");
  check(await banner.isVisible().catch(() => false), "redirect banner shows for an authed route");
  if (shot) await page.screenshot({ path: `${shot}-banner.png` });

  const [popup] = await Promise.all([
    page.waitForEvent("popup", { timeout: 10000 }),
    page.click('button:has-text("Sign in…")'),
  ]);
  await popup.waitForLoadState("domcontentloaded");
  check(popup.url().startsWith("http://localhost:3000/signin"), `sign-in opens top-level at the upstream: ${popup.url()}`);
  // Top-level means the OAuth buttons are actually usable; the page is the
  // app's real signin (it names at least one provider).
  const hasProvider = (await popup.locator("text=/github|google|sign in/i").count()) > 0;
  check(hasProvider, "signin page rendered in the popup");
  if (shot) await popup.screenshot({ path: `${shot}-popup.png` });

  const frameUrlBefore = page.frames().find((f) => f.url().startsWith(origin))?.url();
  await popup.close();
  await page.waitForTimeout(3000);
  const frameUrlAfter = page.frames().find((f) => f.url().startsWith(origin))?.url();
  check(!!frameUrlAfter, `closing the popup reloaded the live frame (${frameUrlBefore} → ${frameUrlAfter})`);
  check(await page.locator("text=Waiting for the sign-in window").count() === 0, "waiting notice cleared after the popup closed");
} catch (err) {
  check(false, `check threw: ${err}`);
} finally {
  await browser.close();
  done();
}
