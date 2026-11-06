/**
 * Browser smoke test: drives the built SPA in a real Chromium.
 *
 *   bun test/ui.ts [baseUrl]
 *
 * Requires a running server (API + built web/dist) and a Playwright Chromium:
 *   PLAYWRIGHT_BROWSERS_PATH=../.pw-browsers bun test/ui.ts
 */
import { chromium, type ConsoleMessage, type Page } from "playwright";
import { mkdirSync } from "node:fs";

const base = (process.argv[2] ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const shotDir = new URL("../../.ui-shots/", import.meta.url).pathname;
mkdirSync(shotDir, { recursive: true });

const USER = process.env.UI_USER ?? "admin";
const PASS = process.env.UI_PASS ?? "silverbed123";

let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const consoleErrors: string[] = [];
const pageErrors: string[] = [];
const failedRequests: string[] = [];

function watch(page: Page) {
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error") consoleErrors.push(`${page.url()} :: ${msg.text()}`);
  });
  page.on("pageerror", (err) => pageErrors.push(`${page.url()} :: ${err.message}`));
  page.on("requestfailed", (req) => {
    const failure = req.failure()?.errorText ?? "";
    if (!failure.includes("ERR_ABORTED")) failedRequests.push(`${req.method()} ${req.url()} :: ${failure}`);
  });
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${shotDir}${name}.png`, fullPage: true });
}

/** SPA navigations must actually render the expected view, not the fallback. */
async function expectRoute(page: Page, path: string, marker: string) {
  await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
  const found = await page
    .locator(marker)
    .first()
    .waitFor({ state: "visible", timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  check(`route ${path} renders ${marker}`, found, found ? "" : `url=${page.url()}`);
  return found;
}

const browser = await chromium.launch();

// ── 1. public surface ──────────────────────────────────────────────────────
console.log("\n▸ public pages");
const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const publicPage = await anon.newPage();
watch(publicPage);

await expectRoute(publicPage, "/", "h1");
await shot(publicPage, "01-landing");
const landingTitle = await publicPage.title();
check("landing has a title", landingTitle.length > 0, landingTitle);

await expectRoute(publicPage, "/login", "#auth-user");
await shot(publicPage, "02-login");
await expectRoute(publicPage, "/register", "#auth-email");
await shot(publicPage, "03-register");

// the shared sheet is open to visitors and never offers management controls
await expectRoute(publicPage, "/gallery", "h1");
const anonGalleryFrames = await publicPage.locator("article").count();
check("shared gallery lists public frames for visitors", anonGalleryFrames > 0, `${anonGalleryFrames} frames`);
check(
  "shared gallery hides checkboxes from visitors",
  (await publicPage.locator("article button[aria-pressed]").count()) === 0,
);
check(
  "shared gallery invites visitors to sign in",
  (await publicPage.locator("text=/(Sign in|登录)/").count()) > 0,
);
await shot(publicPage, "03b-gallery-public");

// auth guard: /app/library redirects an anonymous visitor to /login
await publicPage.goto(`${base}/app/library`, { waitUntil: "networkidle" });
check("guard redirects anonymous visitor to /login", publicPage.url().includes("/login"), publicPage.url());

// ── 2. sign in ─────────────────────────────────────────────────────────────
console.log("\n▸ authentication");
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
watch(page);

await page.goto(`${base}/login`, { waitUntil: "networkidle" });
await page.fill("#auth-user", USER);
await page.fill("#auth-pass", PASS);
await page.click('button[type="submit"]');
const loggedIn = await page
  .locator("text=/" + USER + "/")
  .first()
  .waitFor({ state: "visible", timeout: 10000 })
  .then(() => true)
  .catch(() => false);
check("login lands inside the app", loggedIn && page.url().includes("/app"), page.url());
check("session token is persisted", Boolean(await page.evaluate(() => localStorage.getItem("sb.token"))));

// ── 3. authenticated routes ────────────────────────────────────────────────
console.log("\n▸ app views");
await expectRoute(page, "/app/library", "article, .empty");
await shot(page, "04-library");
const frameCount = await page.locator("article").count();
check("library shows seeded frames", frameCount > 0, `${frameCount} frames`);

// selection + batch bar
if (frameCount > 0) {
  // selection is driven by the toggle inside each tile, not the tile body
  await page.locator("article").first().locator("button[aria-pressed]").first().click();
  await page.waitForTimeout(300);
  const pressed = await page
    .locator("article button[aria-pressed='true']")
    .count();
  const barVisible = await page
    .locator("text=/(selected|已选中)/")
    .first()
    .isVisible()
    .catch(() => false);
  check("selecting a frame marks it pressed", pressed > 0, `${pressed} pressed`);
  check("selection bar appears", barVisible);
  await shot(page, "05-library-selected");
}

// lightbox
if (frameCount > 0) {
  await page.locator("article").first().dblclick();
  const lightbox = await page
    .locator("[role='dialog'], .fixed.inset-0")
    .first()
    .isVisible()
    .catch(() => false);
  check("double click opens the lightbox", lightbox);
  await shot(page, "06-lightbox");
  if (lightbox) await page.keyboard.press("Escape");
}

// shared gallery, signed in: own frames become selectable and the toolbar appears
await expectRoute(page, "/gallery", "h1");
const galleryFrames = await page.locator("article").count();
check("shared gallery renders frames for signed-in users", galleryFrames > 0, `${galleryFrames} frames`);
check(
  "shared gallery makes the uploader's frames selectable",
  (await page.locator("article button[aria-pressed]").count()) > 0,
);
if (galleryFrames > 0) {
  await page.locator("article button[aria-pressed]").first().click();
  await page.waitForTimeout(250);
  const bar = await page
    .locator("text=/(selected|已选中)/")
    .first()
    .isVisible()
    .catch(() => false);
  check("shared gallery batch bar appears", bar);
  await shot(page, "06b-gallery-admin");
}
check(
  "administrators get the shared trash scope",
  (await page.locator("button").filter({ hasText: /Trash|回收站/ }).count()) > 0,
);

await expectRoute(page, "/app/upload", "input[type=file]");
await shot(page, "07-upload");

await expectRoute(page, "/app/stats", ".num, canvas, svg");
await shot(page, "08-stats");

await expectRoute(page, "/app/shares", "h1");
await shot(page, "09-shares");

await expectRoute(page, "/app/keys", "h1");
await shot(page, "10-keys");

await expectRoute(page, "/app/settings", "h1");
await shot(page, "11-settings");

await expectRoute(page, "/app/admin", "h1");
await shot(page, "12-admin");

// ── 4. dark theme ──────────────────────────────────────────────────────────
console.log("\n▸ dark theme");
await page.goto(`${base}/app/library`, { waitUntil: "networkidle" });
const themeToggle = page.locator("header button[title], button[title]").filter({ hasText: /[\u25d0\u25d1]/ }).first();
if (await themeToggle.isVisible().catch(() => false)) {
  await themeToggle.click();
  await page.waitForTimeout(400);
  const isDark = await page.evaluate(() =>
    document.documentElement.dataset.theme === "dark",
  );
  check("theme toggle switches to the dark palette", isDark);
  await shot(page, "13-library-dark");
} else {
  check("theme toggle present", false, "no toggle found");
}

// ── 5. public share page ───────────────────────────────────────────────────────
console.log("\n▸ public share");
{
  // Create a share for one existing file through the API, then open it as an
  // anonymous visitor — that is the flow a recipient actually experiences.
  const token = await page.evaluate(async (origin) => {
    const token = localStorage.getItem("sb.token");
    const auth = token ? { authorization: `Bearer ${token}` } : {};
    const listRes = await fetch(`${origin}/api/v1/files?page=1&pageSize=1`, { headers: auth });
    const list = await listRes.json();
    const file = list?.data?.items?.[0];
    if (!file) return null;
    const res = await fetch(`${origin}/api/v1/shares`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ title: "Smoke share", fileIds: [file.id], accessLevel: "public" }),
    });
    const body = await res.json();
    return body?.data?.share?.token ?? body?.data?.token ?? null;
  }, base);

  if (token) {
    const shareCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const sharePage = await shareCtx.newPage();
    watch(sharePage);
    await expectRoute(sharePage, `/s/${token}`, "img");
    await shot(sharePage, "14-public-share");

    const zip = await sharePage.evaluate(async (url) => {
      const res = await fetch(`${url}/download`);
      return { status: res.status, type: res.headers.get("content-type") ?? "" };
    }, `${base}/s/${token}`);
    check("share zip downloads", zip.status === 200, `${zip.status} ${zip.type}`);
    await shareCtx.close();
  } else {
    check("created a public share to open", false, "share creation returned no token");
  }
}

// ── 6. responsive check ────────────────────────────────────────────────────
console.log("\n▸ mobile viewport");
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const mobilePage = await mobile.newPage();
watch(mobilePage);
await mobilePage.goto(`${base}/app/library`, { waitUntil: "networkidle" });
await mobilePage.waitForTimeout(600);
const overflow = await mobilePage.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
check("no horizontal overflow on mobile", overflow <= 1, `${overflow}px overflow`);
await shot(mobilePage, "15-mobile-library");
await mobile.close();

// ── 7. no console noise ────────────────────────────────────────────────────
console.log("\n▸ console hygiene");
check("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
check("no failed requests", failedRequests.length === 0, failedRequests.slice(0, 3).join(" | "));

await browser.close();

// ── summary ────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`${passed} passed, ${failures.length} failed   (screenshots in .ui-shots/)`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
