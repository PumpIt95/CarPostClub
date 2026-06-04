#!/usr/bin/env node
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import process from "node:process";

import { chromium } from "playwright";

const args = parseArgs(process.argv.slice(2));
const username = args.username || process.env.CARPOSTCLUB_VISUAL_QA_USERNAME || "visual.qa";
const baseUrl = new URL(args.baseUrl || process.env.CARPOSTCLUB_VISUAL_QA_BASE_URL || "https://carpostclub.com");
const credentialsFile = args.credentialsFile
  || process.env.CARPOSTCLUB_VISUAL_QA_CREDENTIALS_FILE
  || "/var/lib/konner-upload/visual-qa-credentials.txt";
const outputDir = args.outputDir
  || process.env.CARPOSTCLUB_GALLERY_QA_OUTPUT_DIR
  || "/var/lib/konner-upload/debug-screenshots/gallery-qa";
const albumSeenFile = args.albumSeenFile
  || process.env.CARPOSTCLUB_ALBUM_SEEN_PATH
  || process.env.KONNER_ALBUM_SEEN_PATH
  || process.env.ALBUM_SEEN_PATH
  || "/var/lib/konner-upload/album-seen.json";
const keepRuns = positiveInteger(args.keepRuns || process.env.CARPOSTCLUB_GALLERY_QA_KEEP_RUNS, 8);
const restoreReadState = args.restoreReadState !== false;
const browserExecutablePath = args.browserExecutablePath
  || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  || process.env.CHROMIUM_EXECUTABLE_PATH
  || (fsSync.existsSync("/usr/bin/google-chrome-stable") ? "/usr/bin/google-chrome-stable" : "")
  || (fsSync.existsSync("/snap/bin/chromium") ? "/snap/bin/chromium" : "");

const runId = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const runDir = path.join(outputDir, runId);
const screenshots = [];
let browser = null;
let readStateSnapshot = null;

try {
  const password = await visualQaPassword();
  await fs.mkdir(runDir, { recursive: true });
  readStateSnapshot = restoreReadState ? await snapshotAlbumSeenUser(username) : null;

  browser = await chromium.launch({
    executablePath: browserExecutablePath || undefined,
    headless: true,
  });
  const context = await browser.newContext({
    baseURL: baseUrl.toString(),
    ignoreHTTPSErrors: false,
  });
  const page = await context.newPage();

  await login(page, username, password);
  await page.goto("/gallery", { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.locator("#pageTitle").waitFor({ state: "visible" });
  await assertText(page.locator("#pageTitle"), "Media gallery", "gallery page title");
  const albumState = await page.evaluate(async () => {
    const response = await fetch("/api/albums", { headers: { Accept: "application/json" } });
    return response.json();
  });
  assert(albumState.ok === true, "visual QA account could not read /api/albums");
  assert(Array.isArray(albumState.albums), "/api/albums did not return albums[]");
  assert(albumState.albums.length > 0, "gallery has no albums to visually inspect");

  await page.locator(".gallery-folder-card").first().waitFor({ state: "visible" });
  await captureViewports(page, "folders", { requireFolderBadge: Number(albumState.unreadTotal || 0) > 0 });

  const folder = page.locator(".gallery-folder-card.has-unread").first();
  const folderCount = await folder.count();
  await (folderCount ? folder : page.locator(".gallery-folder-card").first()).click();
  await page.locator(".gallery-folder-bar").waitFor({ state: "visible" });
  await page.locator(".album-card").first().waitFor({ state: "visible" });
  await captureViewports(page, "feed", { requireAlbumBadge: folderCount > 0 });

  await page.locator(".album-card .album-summary-button").first().click();
  await page.locator(".album-posting-kit").first().waitFor({ state: "visible" });
  await captureViewports(page, "expanded");

  await browser.close();
  browser = null;
  if (restoreReadState && readStateSnapshot) await restoreAlbumSeenUser(username, readStateSnapshot);
  await rotateRuns(outputDir, keepRuns);

  console.log(JSON.stringify({
    ok: true,
    baseUrl: baseUrl.toString(),
    username,
    runDir,
    screenshots,
    restoredReadState: Boolean(restoreReadState),
    keepRuns,
  }, null, 2));
} catch (error) {
  if (browser) await browser.close().catch(() => {});
  if (restoreReadState && readStateSnapshot) {
    await restoreAlbumSeenUser(username, readStateSnapshot).catch((restoreError) => {
      console.error(`Failed to restore ${username} album read-state: ${restoreError.message}`);
    });
  }
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
}

async function visualQaPassword() {
  if (process.env.CARPOSTCLUB_VISUAL_QA_PASSWORD) return process.env.CARPOSTCLUB_VISUAL_QA_PASSWORD;
  const text = await fs.readFile(credentialsFile, "utf8");
  const password = text.match(/^Password:\s*(.+)$/m)?.[1]?.trim();
  if (!password) throw new Error(`Could not read Password from ${credentialsFile}`);
  return password;
}

async function login(page, loginUsername, password) {
  await page.goto("/login", { waitUntil: "networkidle" });
  await page.getByLabel("Username").fill(loginUsername);
  await page.getByLabel("Password").fill(password);
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/", { timeout: 15_000 }),
    page.getByRole("button", { name: "Sign in" }).click(),
  ]);
}

async function captureViewports(page, stage, options = {}) {
  for (const viewport of viewports()) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.waitForTimeout(150);
    await assertPageFits(page);
    await assertControlTextFits(page);
    if (options.requireFolderBadge) await assertVisible(page.locator(".gallery-unread-badge").first(), "gallery unread badge");
    if (options.requireAlbumBadge) await assertVisible(page.locator(".album-unread-badge").first(), "album unread badge");
    const screenshotPath = path.join(runDir, `${stage}-${viewport.name}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    screenshots.push(screenshotPath);
  }
}

function viewports() {
  return [
    { name: "desktop", width: 1440, height: 900 },
    { name: "laptop", width: 1280, height: 800 },
    { name: "tablet", width: 820, height: 1180 },
    { name: "mobile", width: 390, height: 844 },
    { name: "compact-mobile", width: 360, height: 740 },
  ];
}

async function assertPageFits(page) {
  const metrics = await page.evaluate(() => {
    const viewportWidth = window.innerWidth;
    const visibleOffenders = [...document.querySelectorAll("body *")]
      .filter((element) => {
        if (element.closest("[hidden], .chat-panel")) return false;
        const style = window.getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden") return false;
        const box = element.getBoundingClientRect();
        return box.width > 1
          && box.height > 1
          && (box.left < -1 || box.right > viewportWidth + 1);
      })
      .slice(0, 12)
      .map((element) => {
        const box = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          id: element.id,
          className: String(element.className || ""),
          left: Math.round(box.left),
          right: Math.round(box.right),
          width: Math.round(box.width),
        };
      });
    return {
      viewportWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      visibleOffenders,
    };
  });

  assert(metrics.documentWidth <= metrics.viewportWidth + 1, `document overflows viewport: ${JSON.stringify(metrics, null, 2)}`);
  assert(metrics.bodyWidth <= metrics.viewportWidth + 1, `body overflows viewport: ${JSON.stringify(metrics, null, 2)}`);
  assert(metrics.visibleOffenders.length === 0, `visible elements overflow viewport: ${JSON.stringify(metrics, null, 2)}`);
}

async function assertControlTextFits(page) {
  const overflowingControls = await page.evaluate(() => [...document.querySelectorAll(
    "button, .icon-text-button, .gallery-folder-open, .gallery-unread-badge, .album-unread-badge"
  )]
    .filter((element) => {
      if (element.closest("[hidden]")) return false;
      const style = window.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") return false;
      return element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1;
    })
    .map((element) => ({
      tag: element.tagName.toLowerCase(),
      className: String(element.className || ""),
      text: String(element.textContent || "").trim(),
    })));

  assert(overflowingControls.length === 0, `control text overflows: ${JSON.stringify(overflowingControls, null, 2)}`);
}

async function assertVisible(locator, label) {
  if (!await locator.isVisible().catch(() => false)) throw new Error(`${label} is not visible`);
}

async function assertText(locator, expected, label) {
  const text = (await locator.textContent())?.trim();
  assert(text === expected, `${label} expected ${JSON.stringify(expected)}, got ${JSON.stringify(text)}`);
}

async function snapshotAlbumSeenUser(snapshotUsername) {
  const store = await readJson(albumSeenFile, { users: {} });
  const userStore = store.users?.[snapshotUsername];
  return {
    existed: Boolean(userStore),
    userStore: userStore ? JSON.parse(JSON.stringify(userStore)) : null,
  };
}

async function restoreAlbumSeenUser(restoreUsername, snapshot) {
  const store = await readJson(albumSeenFile, { users: {} });
  store.users = store.users && typeof store.users === "object" ? store.users : {};
  if (snapshot.existed) {
    store.users[restoreUsername] = snapshot.userStore || { albums: {} };
  } else {
    delete store.users[restoreUsername];
  }
  await writeJsonAtomic(albumSeenFile, store);
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return JSON.parse(JSON.stringify(fallback));
    throw error;
  }
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const existingStat = await fs.stat(filePath).catch(() => null);
  const tempPath = `${filePath}.tmp-${process.pid}`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: existingStat?.mode || 0o644 });
  if (existingStat) await fs.chown(tempPath, existingStat.uid, existingStat.gid).catch(() => {});
  await fs.rename(tempPath, filePath);
}

async function rotateRuns(parentDir, keepCount) {
  if (!keepCount) return;
  const entries = await fs.readdir(parentDir, { withFileTypes: true }).catch(() => []);
  const runs = entries
    .filter((entry) => entry.isDirectory() && /^\d{8}T\d{6}Z$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const oldRun of runs.slice(keepCount)) {
    await fs.rm(path.join(parentDir, oldRun), { recursive: true, force: true });
  }
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseArgs(argv) {
  const options = { restoreReadState: true };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--base-url") options.baseUrl = argv[++index];
    else if (arg === "--username") options.username = argv[++index];
    else if (arg === "--credentials-file") options.credentialsFile = argv[++index];
    else if (arg === "--output-dir") options.outputDir = argv[++index];
    else if (arg === "--album-seen-file") options.albumSeenFile = argv[++index];
    else if (arg === "--browser-executable") options.browserExecutablePath = argv[++index];
    else if (arg === "--keep-runs") options.keepRuns = argv[++index];
    else if (arg === "--no-restore-read-state") options.restoreReadState = false;
    else if (arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/gallery_visual_qa.mjs [options]

Logs in as the visual QA account, captures gallery screenshots across desktop, laptop,
tablet, and mobile viewports, and checks for horizontal overflow.

Options:
  --base-url <url>              App URL. Default: https://carpostclub.com
  --username <name>             QA username. Default: visual.qa
  --credentials-file <path>     File containing a "Password:" line.
  --output-dir <path>           Screenshot parent directory.
  --album-seen-file <path>      User-specific album read-state file.
  --browser-executable <path>   Chromium/Chrome executable path.
  --keep-runs <n>               Number of screenshot runs to keep. Default: 8.
  --no-restore-read-state       Leave QA account read-state changed after the run.
`);
}
