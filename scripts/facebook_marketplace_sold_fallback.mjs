#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const WORKSPACE = "/Users/konnerhaas/Documents/CPC2";
const CHROME_SOURCE_PROFILE = path.join(os.homedir(), "Library/Application Support/Google/Chrome");
const CHROME_EXECUTABLE = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const STALE_ACTION_HELPER =
  "/Users/konnerhaas/.codex/skills/fb-listing-mark-sold/scripts/stale_listing_action.py";
const ACTION_LOCK_DIR = path.join(WORKSPACE, ".automation-locks/facebook-listing-action.lock");

function parseArgs(argv) {
  const args = {
    apply: false,
    candidates: "",
    cdpUrl: "",
    keepProfile: false,
    profileDir: "",
    runDir: "",
    visible: true,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") args.apply = true;
    else if (arg === "--dry-run") args.apply = false;
    else if (arg === "--keep-profile") args.keepProfile = true;
    else if (arg === "--headless") args.visible = false;
    else if (arg === "--candidates") args.candidates = argv[++index] || "";
    else if (arg === "--cdp-url") args.cdpUrl = argv[++index] || "";
    else if (arg === "--profile-dir") args.profileDir = argv[++index] || "";
    else if (arg === "--run-dir") args.runDir = argv[++index] || "";
    else if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!args.candidates) throw new Error("--candidates is required");
  if (!args.runDir) throw new Error("--run-dir is required");
  return args;
}

function usage() {
  console.log(`Usage:
  node scripts/facebook_marketplace_sold_fallback.mjs --candidates candidates.json --run-dir DIR [--dry-run|--apply] [--cdp-url URL]

Runs a narrow Facebook Marketplace mark-sold fallback. By default it uses a
temporary copied Chrome profile. With --cdp-url it connects to an already
running live Chrome instance over localhost CDP. Candidates must already
include source/public O'Regan's gate booleans. The script still verifies
Konner John, the target listing card, and the existing stale-listing helper
before any live click.`);
}

function normalizeSpaces(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizePriceText(value) {
  const text = normalizeSpaces(value);
  if (!text) return "";
  const match = text.match(/(?:CA\$|\$)?\s*([0-9][0-9,]*)/);
  if (!match) return text;
  return `CA$${match[1]}`;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJson(filePath, data) {
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function withTimeout(promise, ms) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(resolve, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    throw new Error(`${command} exited ${result.status}: ${detail}`);
  }
  return result.stdout;
}

async function prepareProfile({ profileDir, keepProfile, runDir }) {
  if (profileDir) {
    return { dir: profileDir, cleanup: false, copied: false };
  }
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cpc-fb-profile-"));
  const excludes = [
    "Singleton*",
    "Crashpad",
    "BrowserMetrics",
    "GrShaderCache",
    "GraphiteDawnCache",
    "ShaderCache",
    "Safe Browsing",
    "Default/Cache",
    "Default/Code Cache",
    "Default/databases",
    "Default/GPUCache",
    "Default/IndexedDB",
    "Default/Local Storage",
    "Default/Media Cache",
    "Default/Session Storage",
    "Default/Service Worker/CacheStorage",
    "Default/Shared Dictionary",
    "Default/Storage",
    "Default/WebStorage",
  ];
  const rsyncArgs = [
    "-a",
    ...excludes.flatMap((item) => [`--exclude=${item}`]),
    `${CHROME_SOURCE_PROFILE}/`,
    `${tempRoot}/`,
  ];
  runChecked("rsync", rsyncArgs);
  await writeJson(path.join(runDir, "fallback-profile.json"), {
    source: CHROME_SOURCE_PROFILE,
    tempProfile: tempRoot,
    keepProfile,
    copiedAt: new Date().toISOString(),
    excludes,
  });
  return { dir: tempRoot, cleanup: !keepProfile, copied: true };
}

async function launchProfile(profileDir, visible) {
  if (!existsSync(CHROME_EXECUTABLE)) {
    throw new Error(`Chrome executable not found: ${CHROME_EXECUTABLE}`);
  }
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: CHROME_EXECUTABLE,
    headless: !visible,
    viewport: { width: 1280, height: 900 },
    args: [
      "--no-first-run",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-sync",
      "--disable-features=Translate,MediaRouter,OptimizationHints",
      "--hide-crash-restore-bubble",
    ],
  });
  context.setDefaultTimeout(30_000);
  return context;
}

async function openBrowser(args) {
  if (args.cdpUrl) {
    const browser = await chromium.connectOverCDP(args.cdpUrl);
    const context = browser.contexts()[0];
    if (!context) throw new Error(`No Chrome context available from ${args.cdpUrl}`);
    context.setDefaultTimeout(30_000);
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 900 }).catch(() => {});
    return {
      browserMode: "cdp",
      context,
      page,
      profile: { cdpUrl: args.cdpUrl, copied: false, cleanup: false },
      close: async () => {
        await withTimeout(page.close().catch(() => {}), 3_000);
        if (typeof browser.disconnect === "function") {
          await withTimeout(Promise.resolve(browser.disconnect()).catch(() => {}), 1_000);
        }
      },
    };
  }

  const profile = await prepareProfile(args);
  const context = await launchProfile(profile.dir, args.visible);
  const page = context.pages()[0] || (await context.newPage());
  return {
    browserMode: "copied-profile",
    context,
    page,
    profile: { dir: profile.dir, copied: profile.copied, cleanup: profile.cleanup },
    close: async () => {
      await context.close().catch(() => {});
      if (profile.cleanup) await rm(profile.dir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

function buildSellingSearchUrl(candidate) {
  const query = candidate.titleSearch || candidate.facebookTitle || candidate.vehicleTitle || candidate.title;
  return `https://www.facebook.com/marketplace/you/selling?title_search=${encodeURIComponent(query)}`;
}

function candidateTitle(candidate) {
  return normalizeSpaces(candidate.facebookTitle || candidate.vehicleTitle || candidate.title);
}

function candidatePrice(candidate) {
  return normalizePriceText(candidate.facebookPrice || candidate.priceText || candidate.sourcePrice || candidate.price);
}

async function openCandidatePage(page, candidate) {
  const urls = [buildSellingSearchUrl(candidate)];
  if (candidate.facebookListingUrl) urls.push(candidate.facebookListingUrl);
  else if (candidate.facebookListingId) {
    urls.push(`https://www.facebook.com/marketplace/item/${candidate.facebookListingId}/`);
  }

  let best = null;
  for (const url of urls) {
    let navigationError = "";
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    } catch (error) {
      navigationError = error?.message || String(error);
    }
    const verification = await verifyCurrentPageStable(page, candidate, url);
    verification.navigationError = navigationError;
    if (!best || scoreVerification(verification) > scoreVerification(best)) {
      best = verification;
    }
    if (verification.accountVerified && verification.listingVerified) {
      return verification;
    }
  }
  return best || { url: urls[0], accountVerified: false, listingVerified: false };
}

function isNavigationRace(error) {
  const message = error?.message || String(error || "");
  return /Execution context was destroyed|Cannot find context with specified id|navigation/i.test(message);
}

async function verifyCurrentPageStable(page, candidate, url) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(2_000 + attempt * 1_000);
    try {
      return await verifyCurrentPage(page, candidate, url);
    } catch (error) {
      if (!isNavigationRace(error)) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

function scoreVerification(verification) {
  let score = 0;
  if (verification?.accountVerified) score += 10;
  if (verification?.target?.titlePresent) score += 3;
  if (verification?.target?.pricePresent) score += 3;
  if (verification?.target?.markSold?.found) score += 5;
  if (verification?.target?.markAvailable?.found) score += 5;
  if (verification?.listingVerified) score += 10;
  return score;
}

async function verifyCurrentPage(page, candidate, url) {
  const title = candidateTitle(candidate);
  const priceText = candidatePrice(candidate);
  const target = await page.evaluate(
    ({ expectedTitle, expectedPrice }) => {
      const norm = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const bodyText = norm(document.body?.innerText || "");
      const titleLower = expectedTitle.toLowerCase();
      const priceLower = expectedPrice.toLowerCase();
      const titlePresent = bodyText.toLowerCase().includes(titleLower);
      const pricePresent = bodyText.toLowerCase().includes(priceLower);

      function surroundingSnippet() {
        const lower = bodyText.toLowerCase();
        const index = lower.indexOf(titleLower);
        if (index < 0) return bodyText.slice(0, 600);
        return bodyText.slice(Math.max(0, index - 180), Math.min(bodyText.length, index + 900));
      }

      function bestContextFor(element) {
        let node = element;
        for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
          const text = norm(node.innerText || node.textContent || "");
          const lower = text.toLowerCase();
          if (lower.includes(titleLower) && lower.includes(priceLower)) {
            return text.slice(0, 1400);
          }
        }
        return "";
      }

      function isVisible(element) {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      }

      function findAction(actionText) {
        const expectedFull = `${actionText} ${expectedTitle}`.toLowerCase();
        const expectedBare = actionText.toLowerCase();
        const elements = Array.from(document.querySelectorAll("[aria-label], [role='button'], button, a"));
        const matches = [];
        for (const element of elements) {
          if (!isVisible(element)) continue;
          const label = norm(element.getAttribute("aria-label") || element.innerText || element.textContent || "");
          const labelLower = label.toLowerCase();
          const labelMatches =
            labelLower === expectedFull ||
            labelLower === expectedBare ||
            (labelLower.startsWith(expectedBare) && labelLower.includes(titleLower));
          if (!labelMatches) continue;
          const context = bestContextFor(element);
          if (!context) continue;
          const rect = element.getBoundingClientRect();
          matches.push({
            aria: element.getAttribute("aria-label") || "",
            text: norm(element.innerText || element.textContent || ""),
            context,
            rect: {
              x: rect.x,
              y: rect.y,
              w: rect.width,
              h: rect.height,
            },
            x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 2,
          });
        }
        matches.sort((a, b) => a.context.length - b.context.length);
        return {
          found: matches.length > 0,
          count: matches.length,
          best: matches[0] || null,
          matches: matches.slice(0, 5),
        };
      }

      function countTargetContexts() {
        const contexts = new Set();
        const nodes = Array.from(document.querySelectorAll("div"));
        for (const node of nodes) {
          if (!isVisible(node)) continue;
          const text = norm(node.innerText || "");
          const lower = text.toLowerCase();
          if (!lower.includes(titleLower) || !lower.includes(priceLower)) continue;
          if (!/(Listed on Marketplace|Mark as sold|Mark as available|Active|Sold)/i.test(text)) continue;
          if (text.length < 40 || text.length > 1800) continue;
          contexts.add(text.slice(0, 900));
        }
        return Array.from(contexts).slice(0, 8);
      }

      const markSold = findAction("Mark as sold");
      const markAvailable = findAction("Mark as available");
      const targetContexts = countTargetContexts();
      const snippet = surroundingSnippet();
      const status =
        markSold.found || /\bActive\b/.test(snippet)
          ? "Active"
          : markAvailable.found || /\bSold\b/.test(snippet)
            ? "Sold"
            : "Unknown";
      return {
        accountTextPresent: /\bKonner John\b/i.test(bodyText),
        marketplaceProfileTextPresent: /(Marketplace profile|Create new listing|Your listings|active listings)/i.test(bodyText),
        bodySample: bodyText.slice(0, 1200),
        titlePresent,
        pricePresent,
        snippet,
        status,
        targetContextCount: targetContexts.length,
        targetContexts,
        markSold,
        markAvailable,
      };
    },
    { expectedTitle: title, expectedPrice: priceText },
  );

  const bodyText = target.bodySample || "";
  const accountVerified = target.accountTextPresent === true && target.marketplaceProfileTextPresent === true;
  const loggedOutOrCheckpoint = /(log in|login|checkpoint|confirm your identity|two-factor|security check)/i.test(
    bodyText,
  );
  const ambiguous =
    target.markSold.count > 1 ||
    target.markAvailable.count > 1 ||
    (target.markSold.count === 0 && target.markAvailable.count === 0 && target.targetContextCount > 3);
  const listingVerified =
    accountVerified &&
    target.titlePresent &&
    target.pricePresent &&
    !ambiguous &&
    (target.markSold.found || target.markAvailable.found);

  return {
    checkedAt: new Date().toISOString(),
    url,
    title,
    priceText,
    accountVerified,
    loggedOutOrCheckpoint,
    ambiguous,
    listingVerified,
    target,
  };
}

function buildHelperCandidate(candidate, verification, { dryRun, listingActionLockHeld }) {
  const title = candidateTitle(candidate);
  return {
    vehicleTitle: title,
    vin: candidate.vin || "",
    stockNumber: candidate.stockNumber || candidate.stock || "",
    sourceUrl: candidate.sourceUrl || "",
    facebookListingUrl:
      candidate.facebookListingUrl ||
      (candidate.facebookListingId ? `https://www.facebook.com/marketplace/item/${candidate.facebookListingId}/` : ""),
    facebookListingId: candidate.facebookListingId || "",
    sourceInventoryFetchOk: candidate.sourceInventoryFetchOk === true,
    sourceInventoryEmpty: candidate.sourceInventoryEmpty === true,
    sourceInventoryPossiblyBroken: candidate.sourceInventoryPossiblyBroken === true,
    vehicleStillFoundByVinOrStock: candidate.vehicleStillFoundByVinOrStock === true,
    publicOregansInventoryCheckOk: candidate.publicOregansInventoryCheckOk === true,
    publicOregansVehicleFoundByVinOrStock: candidate.publicOregansVehicleFoundByVinOrStock === true,
    publicOregansInventoryPossiblyBroken: candidate.publicOregansInventoryPossiblyBroken === true,
    facebookAccountVerified: verification.accountVerified === true,
    listingVerified: verification.listingVerified === true,
    ambiguousFacebookMatches: verification.ambiguous === true,
    listingActionLockHeld,
    facebookStatus: verification.target?.status || "Unknown",
    facebookPrice: verification.priceText || candidatePrice(candidate),
    matchConfidence: verification.listingVerified ? "high" : "low",
    staleReason:
      candidate.staleReason ||
      "Vehicle absent from current source inventory and public O'Regan's exact VIN/stock check.",
    dryRun,
  };
}

async function runHelper(helperCandidate, outPath) {
  await writeJson(outPath, helperCandidate);
  const stdout = runChecked("python3", [STALE_ACTION_HELPER, "--input", outPath]);
  const result = JSON.parse(stdout);
  await writeJson(outPath.replace(/-candidate\.json$/, "-helper.json"), result);
  return result;
}

async function acquireActionLock({ owner, runDir, stockNumber, lockDir = ACTION_LOCK_DIR }) {
  const token = {
    owner,
    runDir,
    stockNumber,
    pid: process.pid,
    createdAt: new Date().toISOString(),
  };
  try {
    await mkdir(lockDir);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(`action lock already exists: ${lockDir}`);
    }
    throw error;
  }
  const ownerText = [
    `owner=${token.owner}`,
    `created_at=${token.createdAt}`,
    `run_dir=${token.runDir}`,
    `stock=${token.stockNumber}`,
    `pid=${token.pid}`,
    "",
  ].join("\n");
  await writeFile(path.join(lockDir, "owner.txt"), ownerText, "utf8");
  return token;
}

async function releaseActionLock(lockToken, lockDir = ACTION_LOCK_DIR) {
  if (!lockToken) return false;
  const ownerPath = path.join(lockDir, "owner.txt");
  let ownerText = "";
  try {
    ownerText = await readFile(ownerPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  const expected = [
    `owner=${lockToken.owner}`,
    `run_dir=${lockToken.runDir}`,
    `stock=${lockToken.stockNumber}`,
    `pid=${lockToken.pid}`,
  ];
  if (!expected.every((line) => ownerText.includes(line))) {
    return false;
  }
  await rm(lockDir, { recursive: true, force: true });
  return true;
}

async function clickMarkSold(page, verification) {
  const clickInfo = await page.evaluate(
    ({ expectedTitle, expectedPrice }) => {
      const norm = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const titleLower = expectedTitle.toLowerCase();
      const priceLower = expectedPrice.toLowerCase();

      function bestContextFor(element) {
        let node = element;
        for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
          const text = norm(node.innerText || node.textContent || "");
          const lower = text.toLowerCase();
          if (lower.includes(titleLower) && lower.includes(priceLower)) {
            return text.slice(0, 1400);
          }
        }
        return "";
      }

      function isVisible(element) {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      }

      const expectedFull = `mark as sold ${expectedTitle}`.toLowerCase();
      const matches = [];
      for (const element of Array.from(document.querySelectorAll("[aria-label], [role='button'], button, a"))) {
        if (!isVisible(element)) continue;
        const label = norm(element.getAttribute("aria-label") || element.innerText || element.textContent || "");
        const labelLower = label.toLowerCase();
        const labelMatches =
          labelLower === expectedFull ||
          labelLower === "mark as sold" ||
          (labelLower.startsWith("mark as sold") && labelLower.includes(titleLower));
        if (!labelMatches) continue;
        const context = bestContextFor(element);
        if (!context) continue;
        matches.push({ element, context });
      }
      matches.sort((a, b) => a.context.length - b.context.length);
      const match = matches[0];
      if (!match) return null;
      match.element.scrollIntoView({ block: "center", inline: "center" });
      const rect = match.element.getBoundingClientRect();
      return {
        context: match.context,
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
      };
    },
    { expectedTitle: verification.title, expectedPrice: verification.priceText },
  );
  if (!clickInfo) throw new Error("no verified Mark as sold action to click");
  await page.waitForTimeout(500);
  await page.mouse.move(clickInfo.x, clickInfo.y);
  await page.mouse.click(clickInfo.x, clickInfo.y);
  await page.waitForTimeout(1500);
  await settleSoldDialog(page);
  await page.waitForTimeout(2500);
}

async function settleSoldDialog(page) {
  const choices = [
    /^Yes, sold elsewhere$/i,
    /^Sold elsewhere$/i,
    /sold somewhere else/i,
    /^Confirm$/i,
    /^Done$/i,
  ];
  for (let pass = 0; pass < 4; pass += 1) {
    let clicked = false;
    for (const choice of choices) {
      const button = page.getByRole("button", { name: choice }).first();
      if ((await button.count().catch(() => 0)) > 0 && (await button.isVisible().catch(() => false))) {
        await button.click();
        await page.waitForTimeout(1200);
        clicked = true;
        break;
      }
    }
    if (!clicked) return;
  }
}

async function processCandidate(page, candidate, args) {
  const stockNumber = candidate.stockNumber || candidate.stock || "";
  const fileBase = stockNumber || candidateTitle(candidate).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const before = await openCandidatePage(page, candidate);
  await writeJson(path.join(args.runDir, `${fileBase}-verification-before.json`), before);
  await page.screenshot({ path: path.join(args.runDir, `${fileBase}-before.png`), fullPage: false }).catch(() => {});

  const dryCandidate = buildHelperCandidate(candidate, before, {
    dryRun: true,
    listingActionLockHeld: false,
  });
  const dryHelper = await runHelper(dryCandidate, path.join(args.runDir, `${fileBase}-dry-candidate.json`));

  const result = {
    stockNumber,
    vin: candidate.vin || "",
    title: candidateTitle(candidate),
    priceText: candidatePrice(candidate),
    before,
    dryHelper,
    action: "skipped",
    liveHelper: null,
    after: null,
    error: "",
  };

  if (!before.target?.markSold?.found && (before.target?.markAvailable?.found || before.target?.status === "Sold")) {
    result.action = "already_sold";
    result.after = before;
    return result;
  }

  if (dryHelper.proposedAction !== "MARK_SOLD") {
    result.action = "helper_skipped";
    return result;
  }

  if (!args.apply) {
    result.action = "dry_run_would_mark_sold";
    return result;
  }

  const actionLock = await acquireActionLock({ owner: "live-facebook-listing-sync-cdp-fallback", runDir: args.runDir, stockNumber });
  try {
    const liveCandidate = buildHelperCandidate(candidate, before, {
      dryRun: false,
      listingActionLockHeld: true,
    });
    const liveHelper = await runHelper(liveCandidate, path.join(args.runDir, `${fileBase}-live-candidate.json`));
    result.liveHelper = liveHelper;
    if (liveHelper.proposedAction !== "MARK_SOLD") {
      result.action = "live_helper_skipped";
      return result;
    }
    await clickMarkSold(page, before);
    const after = await verifyCurrentPage(page, candidate, page.url());
    result.after = after;
    await writeJson(path.join(args.runDir, `${fileBase}-verification-after.json`), after);
    await page.screenshot({ path: path.join(args.runDir, `${fileBase}-after.png`), fullPage: false }).catch(() => {});
    if (after.target?.markAvailable?.found || after.target?.status === "Sold") {
      result.action = "clicked_mark_sold";
    } else {
      result.action = "click_unverified";
      result.error = "Clicked Mark as sold, but post-click verification did not find Sold/Mark as available.";
    }
  } finally {
    await releaseActionLock(actionLock);
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(args.runDir, { recursive: true });
  const input = await readJson(args.candidates);
  const candidates = Array.isArray(input) ? input : input.candidates || [];
  if (!candidates.length) throw new Error("candidate file contains no candidates");

  let browserSession = null;
  const summary = {
    script: "facebook_marketplace_sold_fallback.mjs",
    mode: args.apply ? "apply" : "dry-run",
    startedAt: new Date().toISOString(),
    runDir: args.runDir,
    candidates: candidates.map((candidate) => ({
      stockNumber: candidate.stockNumber || candidate.stock || "",
      vin: candidate.vin || "",
      title: candidateTitle(candidate),
      priceText: candidatePrice(candidate),
    })),
    browserMode: "",
    profile: null,
    results: [],
    completedAt: "",
    ok: false,
  };

  try {
    browserSession = await openBrowser(args);
    summary.browserMode = browserSession.browserMode;
    summary.profile = browserSession.profile;
    const page = browserSession.page;
    for (const candidate of candidates) {
      const result = await processCandidate(page, candidate, args);
      summary.results.push(result);
      await writeJson(path.join(args.runDir, "facebook-fallback-results.json"), summary);
    }
    summary.completedAt = new Date().toISOString();
    summary.ok = summary.results.every((result) =>
      ["clicked_mark_sold", "already_sold", "dry_run_would_mark_sold", "helper_skipped"].includes(result.action),
    );
  } finally {
    if (browserSession) await browserSession.close().catch(() => {});
  }

  await writeJson(path.join(args.runDir, "facebook-fallback-results.json"), summary);
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exit(2);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main()
    .then(() => process.exit(0))
    .catch(async (error) => {
      console.error(error.stack || error.message || String(error));
      process.exit(1);
    });
}

export { normalizePriceText, buildHelperCandidate, scoreVerification, acquireActionLock, releaseActionLock };
