/**
 * Live click-to-source: clicking an element in the live canvas resolves it
 * through the target's source maps and lands the editor on the owning file
 * with a node selected. Needs BOTH dev servers: u-and-i's (`npx vite`, 4400)
 * and the target's (`npm run dev`, default 3000).
 *
 *   node scripts/checks/live-click.mjs [screenshot-prefix]
 */
import { playwright, reporter, liveOrigin } from "./_shared.mjs";

const { chromium } = playwright();
const { check, done } = reporter();
const shot = process.argv[2] ?? null;

const origin = await liveOrigin();
check(!!origin, `live mirror reachable: ${origin}`);
if (!origin) done();

// Signed-out canvas: /terms serves without a redirect.
const OPEN_PATH = "/terms";

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

// The proof that the daemon resolved the click, not just that the UI moved.
const resolves = [];
page.on("response", async (r) => {
  if (r.url().includes("/api/live-resolve")) {
    try {
      resolves.push(await r.json());
    } catch {
      /* non-JSON — ignore */
    }
  }
});

try {
  // The Layout workspace IS the live canvas — nothing to switch to.
  await page.goto("http://localhost:4400/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);

  const pathInput = page.getByLabel("Live app path");
  await pathInput.fill(OPEN_PATH);
  await pathInput.press("Enter");
  await page.waitForTimeout(5000);

  const frame = page.frames().find((f) => f.url().startsWith(origin));
  check(!!frame, `live frame present: ${frame?.url()}`);
  if (!frame) throw new Error("no live frame");

  // Click a real content element (`:visible` skips Next's hidden route
  // announcer) so the fiber walk has something real. A cold dev server can
  // still be compiling/hydrating — retry until a resolution arrives.
  const target = frame.locator("h1:visible, h2:visible, p:visible").first();
  for (let attempt = 0; attempt < 4 && !resolves.some((r) => r.ok); attempt++) {
    await target.click();
    await page.waitForTimeout(3000);
  }
  if (shot) await page.screenshot({ path: `${shot}-clicked.png` });

  const hit = resolves.find((r) => r.ok && r.file);
  check(!!hit, `live-resolve returned a source file: ${JSON.stringify(resolves.at(-1) ?? null)}`);
  if (hit) {
    check(/^src\//.test(hit.file), `resolved inside the target's src/: ${hit.file}`);
    check(!!hit.id, `resolved to a JSX node id: ${hit.id}`);
    // The editor opened that file (top bar shows the open file's path).
    const barShowsFile = await page
      .locator(`text=${hit.file}`)
      .first()
      .isVisible()
      .catch(() => false);
    check(barShowsFile, `editor opened ${hit.file}`);
  }
} catch (err) {
  check(false, `check threw: ${err}`);
} finally {
  await browser.close();
  done();
}
