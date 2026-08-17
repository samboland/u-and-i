/**
 * Live edit round-trip: a click in the live canvas resolves to a JSX node,
 * an edit to that node flows through the normal funnel onto disk, the
 * TARGET's own HMR pushes the change back into the live frame, and undo
 * (byte-verbatim restore) rolls everything back. Needs BOTH dev servers:
 * u-and-i's (`npx vite`, 4400) and the target's (`npm run dev`).
 *
 *   node scripts/checks/live-edit.mjs [screenshot-prefix]
 */
import { playwright, reporter, liveOrigin, isDirty, clickInFrame } from "./_shared.mjs";

const { chromium } = playwright();
const { check, done } = reporter();
const shot = process.argv[2] ?? null;

const origin = await liveOrigin();
check(!!origin, `live mirror reachable: ${origin}`);
if (!origin) done();

// /support serves signed-out, and this h2's content is one static JSXText.
const PATH = "/support";
const TEXT = "Get in touch";
const MARKER = "Get in touch (uai live-edit check)";

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

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

const liveFrame = () => page.frames().find((f) => f.url().startsWith(origin));
const frameHas = async (text) => {
  const f = liveFrame();
  if (!f) return false;
  return (await f.locator(`text=${text}`).count().catch(() => 0)) > 0;
};
const waitFrame = async (predicate, ms) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await predicate()) return true;
    await page.waitForTimeout(500);
  }
  return false;
};
const waitFrameHas = (text, ms) => waitFrame(() => frameHas(text), ms);

let editedFile = null;
let restore = null;
try {
  // The Layout workspace IS the live canvas — nothing to switch to.
  await page.goto("http://localhost:4400/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  const pathInput = page.getByLabel("Live app path");
  await pathInput.fill(PATH);
  await pathInput.press("Enter");
  await page.waitForTimeout(5000);

  check(!!liveFrame(), `live frame present: ${liveFrame()?.url()}`);
  // A cold dev server can still be compiling/hydrating — retry the click
  // until a resolution arrives rather than trusting one fixed wait.
  for (let attempt = 0; attempt < 4 && !resolves.some((r) => r.ok && r.id); attempt++) {
    await clickInFrame(liveFrame(), "h2", TEXT);
    await page.waitForTimeout(3000);
  }

  const hit = resolves.find((r) => r.ok && r.id);
  check(!!hit, `click resolved: ${JSON.stringify(resolves.at(-1) ?? null)}`);
  if (!hit) throw new Error("no resolution");
  editedFile = hit.file;
  check(!isDirty(editedFile), `${editedFile} starts git-clean`);

  // The edit goes through the same API the editor funnel uses. Find the
  // node's one text slot from the served model.
  const model = (await fetch(`http://localhost:4400/api/component?file=${encodeURIComponent(hit.file)}`).then((r) => r.json())).model;
  const flat = [];
  const walk = (nodes) => nodes.forEach((n) => (flat.push(n), walk(n.children)));
  walk(model);
  const node = flat.find((n) => n.id === hit.id);
  check(!!node && node.textChildren?.length === 1 && !node.children.length, `resolved node has one text slot (<${node?.tag}> "${node?.textChildren?.[0]?.value?.trim()}")`);

  const edit = await fetch("http://localhost:4400/api/edit", {
    method: "POST",
    body: JSON.stringify({
      file: hit.file,
      edit: { op: "set-text", index: node.index, slot: node.textChildren[0].slot, value: MARKER },
      expectTag: node.tag,
    }),
  }).then((r) => r.json());
  check(edit.ok === true, `edit written: ${edit.error ?? "ok"}`);
  restore = edit.before;

  // The target's own HMR must carry the change into the live frame.
  check(await waitFrameHas(MARKER, 20000), "HMR pushed the edit into the live canvas");
  if (shot) await page.screenshot({ path: `${shot}-edited.png` });

  // Editor survived the reload: the file is still open in the top bar.
  check(await page.locator(`text=${hit.file}`).first().isVisible().catch(() => false), "editor still shows the edited file after HMR");
} catch (err) {
  check(false, `check threw: ${err}`);
} finally {
  // Undo — byte-verbatim restore, whatever happened above.
  if (editedFile && restore != null) {
    const r = await fetch("http://localhost:4400/api/restore", {
      method: "POST",
      body: JSON.stringify({ file: editedFile, text: restore }),
    }).then((x) => x.json());
    check(r.ok === true, "restore written");
    // MARKER contains TEXT, so "rolled back" means the marker is GONE.
    check(
      (await waitFrame(async () => !(await frameHas(MARKER)), 20000)) && (await frameHas(TEXT)),
      "HMR rolled the live canvas back",
    );
    check(!isDirty(editedFile), `${editedFile} is git-clean after restore`);
  }
  await browser.close();
  done();
}
