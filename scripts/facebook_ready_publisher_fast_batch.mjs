#!/usr/bin/env node
import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";

const IMAGE_EXTENSIONS = new Set([".avif", ".gif", ".heic", ".jpeg", ".jpg", ".png", ".webp"]);
const DEFAULT_ALLOWED_DEALERSHIPS = new Set([
  "O'Regan's Kia Halifax",
  "O'Regan's Infiniti/Nissan Halifax",
  "O'Regan's Chevrolet Buick GMC Cadillac",
  "O'Regan's Volkswagen Halifax",
]);
const KNOWN_MAKES = [
  "buick",
  "chevrolet",
  "gmc",
  "nissan",
  "volvo",
  "volkswagen",
  "hyundai",
  "kia",
  "mini",
  "mitsubishi",
  "lexus",
  "toyota",
  "mercedes-benz",
  "infiniti",
];

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.command) {
  printHelp();
  process.exit(args.help ? 0 : 1);
}

const startedAt = new Date();
const ledger = createTimingLedger(startedAt);

try {
  if (args.command === "plan") {
    await runPlan(args, ledger);
  } else if (args.command === "prep-packages") {
    await runPrepPackages(args, ledger);
  } else {
    throw new Error(`Unknown command: ${args.command}`);
  }
} catch (error) {
  ledger.status = "error";
  ledger.error = String(error?.stack || error);
  if (args.runDir) {
    ensureDir(args.runDir);
    writeJson(path.join(args.runDir, "fast-batch-timing-ledger.json"), finishTimingLedger(ledger));
  }
  throw error;
}

function createTimingLedger(started) {
  return {
    schema: "facebook-ready-publisher-fast-batch-timing-v1",
    startedAt: started.toISOString(),
    status: "running",
    phases: [],
    vehicles: {},
  };
}

function finishTimingLedger(activeLedger) {
  activeLedger.finishedAt = new Date().toISOString();
  activeLedger.elapsedMs = Math.round(performance.now() - activeLedger._startMs);
  delete activeLedger._startMs;
  return activeLedger;
}

async function timePhase(name, fn) {
  const startedMs = performance.now();
  const startedAtIso = new Date().toISOString();
  try {
    const result = await fn();
    const elapsedMs = Math.round(performance.now() - startedMs);
    ledger.phases.push({ name, startedAt: startedAtIso, elapsedMs, ok: true });
    return result;
  } catch (error) {
    const elapsedMs = Math.round(performance.now() - startedMs);
    ledger.phases.push({
      name,
      startedAt: startedAtIso,
      elapsedMs,
      ok: false,
      error: String(error?.message || error),
    });
    throw error;
  }
}

function timeVehicle(stock, phaseName, startedMs, extra = {}) {
  const vehicle = ledger.vehicles[stock] || {};
  vehicle[phaseName] = {
    elapsedMs: Math.round(performance.now() - startedMs),
    ...extra,
  };
  ledger.vehicles[stock] = vehicle;
}

async function runPlan(options, activeLedger) {
  activeLedger._startMs = performance.now();
  const runDir = requiredPath(options.runDir, "--run-dir");
  ensureDir(runDir);

  const inventoryRows = await timePhase("candidateScan", async () => {
    const body = readJson(requiredPath(options.inventoryFile, "--inventory-file"));
    return normalizeInventoryRows(body, options);
  });

  const facebookRows = await timePhase("facebookLiveCheck", async () => {
    const body = readJson(requiredPath(options.facebookFile, "--facebook-file"));
    const baseRows = normalizeFacebookRows(body);
    const publishedRows = options.publishedResultsFile
      ? normalizePublishedRows(readJson(options.publishedResultsFile))
      : [];
    return [...baseRows, ...publishedRows];
  });

  const plan = await timePhase("queueBuild", async () => buildPostingPlan(inventoryRows, facebookRows, options));
  const outPath = path.join(runDir, options.output || "fast-batch-plan.json");
  writeJson(outPath, plan);

  activeLedger.status = "ok";
  activeLedger.counts = {
    candidates: plan.summary.candidateCount,
    readyToPost: plan.readyToPost.length,
    alreadyLive: plan.alreadyLive.length,
    alreadyLiveButNeedsUpdate: plan.alreadyLiveButNeedsUpdate.length,
    manualReview: plan.manualReview.length,
  };
  writeJson(path.join(runDir, "fast-batch-timing-ledger.json"), finishTimingLedger(activeLedger));

  printJson({
    ok: true,
    command: "plan",
    output: outPath,
    timingLedger: path.join(runDir, "fast-batch-timing-ledger.json"),
    summary: plan.summary,
  });
}

async function runPrepPackages(options, activeLedger) {
  activeLedger._startMs = performance.now();
  const runDir = requiredPath(options.runDir, "--run-dir");
  ensureDir(runDir);

  const queue = await timePhase("candidateScan", async () => {
    const body = readJson(requiredPath(options.postQueueFile, "--post-queue-file"));
    return normalizeQueueRows(body);
  });

  const coverChoices = await timePhase("coverPlanLoad", async () => loadCoverChoices(options.coverOrderFile));
  const result = await timePhase("photoPackagePrep", async () => prepareUploadReadyPackages(queue, coverChoices, options));

  const outputPath = path.join(runDir, options.output || "upload-ready-summary.json");
  writeJson(outputPath, result);

  activeLedger.status = "ok";
  activeLedger.counts = {
    queue: queue.length,
    prepared: result.prepared.length,
    blocked: result.blocked.length,
    dryRun: Boolean(options.dryRun),
  };
  writeJson(path.join(runDir, "fast-batch-timing-ledger.json"), finishTimingLedger(activeLedger));

  printJson({
    ok: true,
    command: "prep-packages",
    output: outputPath,
    timingLedger: path.join(runDir, "fast-batch-timing-ledger.json"),
    summary: activeLedger.counts,
  });
}

function normalizeInventoryRows(body, options) {
  const rows = Array.isArray(body)
    ? body
    : body?.cars || body?.albums || body?.vehicles || [];
  if (!Array.isArray(rows)) throw new Error("Inventory file does not contain cars[], albums[], vehicles[], or an array.");

  const minPhotos = positiveInteger(options.minPhotos, 5);
  const allowedDealerships = parseAllowedDealerships(options.allowedDealerships);

  return rows
    .map((row) => normalizeInventoryRow(row))
    .filter((row) => {
      if (!row.stock && !row.vin && !row.albumId) return false;
      if (row.sourceActive === false) return false;
      if (row.inventoryType && row.inventoryType !== "used") return false;
      if (row.facebookReadyForPosting === false) return false;
      if (row.mediaCount !== null && row.mediaCount < minPhotos) return false;
      if (allowedDealerships.size && row.dealershipName && !allowedDealerships.has(row.dealershipName)) return false;
      return true;
    });
}

function normalizeInventoryRow(row) {
  const year = text(row.year || row.vehicle?.year);
  const make = text(row.make || row.vehicle?.make);
  const model = text(row.model || row.vehicle?.model);
  const priceText = row.price || row.priceFormatted || row.marketplace?.fields?.price || row.fields?.price;
  const explicitMediaCount = row.mediaCount ?? row.photoCount;
  const embeddedMedia = row.media || row.photos || row.images;
  return {
    source: "inventory",
    stock: text(row.stockNumber || row.stock || row.vehicle?.stockNumber),
    vin: text(row.vin || row.inventoryKey || row.vehicle?.vin),
    albumId: text(row.albumId || row.id || row.album?.id),
    albumName: text(row.albumName || row.name || row.album?.name),
    title: titleFromParts(year, make, model) || text(row.title || row.marketplace?.title),
    year,
    make,
    model,
    price: formatMoney(priceText),
    priceValue: moneyToInt(priceText),
    mediaCount: explicitMediaCount === null || explicitMediaCount === undefined
      ? (Array.isArray(embeddedMedia) && embeddedMedia.length ? embeddedMedia.length : null)
      : numberOrNull(explicitMediaCount),
    bodyStyle: text(row.bodyStyle || row.marketplace?.fields?.bodyStyle || row.fields?.bodyStyle),
    dealershipName: text(row.dealershipName || row.dealership?.name || row.marketplace?.fields?.dealershipName),
    inventoryType: normalizeInventoryType(row),
    facebookReadyForPosting: row.facebookReadyForPosting ?? row.facebookReady ?? null,
    sourceActive: row.sourceActive ?? row.inventoryStatus?.active ?? true,
    detailUrl: text(row.detailUrl || row.url),
    raw: row,
  };
}

function normalizeFacebookRows(body) {
  const rows = Array.isArray(body)
    ? body
    : body?.listings || body?.facebookListings || body?.cards || [];
  if (!Array.isArray(rows)) throw new Error("Facebook file does not contain listings[], facebookListings[], cards[], or an array.");

  return rows.map((row) => ({
    source: row.source || "facebook",
    stock: text(row.stock || row.stockNumber),
    vin: text(row.vin || row.inventoryKey),
    title: text(row.title),
    price: formatMoney(row.price),
    priceValue: moneyToInt(row.price),
    status: text(row.status || row.listingStatus || "Active"),
    listedOn: text(row.listedOn || row.date || row.listedDate),
    key: text(row.key),
    listingId: text(row.listingId || row.id),
    listingUrl: text(row.url || row.listingUrl || row.href),
    raw: row,
  })).filter((row) => lower(row.status) === "active" && row.title && row.priceValue !== null);
}

function normalizeInventoryType(row) {
  const explicit = lower(row.inventoryType || row.inventoryTypeName || row.type);
  if (explicit) return explicit;
  if (text(row.inventoryTypeId) === "2") return "used";
  return "";
}

function normalizePublishedRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row) => row?.published)
    .map((row) => ({
      source: "published-results",
      stock: text(row.stock || row.stockNumber),
      vin: text(row.vin),
      title: text(row.title),
      price: formatMoney(row.price),
      priceValue: moneyToInt(row.price),
      status: "Active",
      listedOn: text(row.listedOn || row.finishedAt),
      key: "",
      listingId: text(row.listingId || row.id),
      listingUrl: text(row.url || row.listingUrl),
      raw: row,
    }))
    .filter((row) => row.title && row.priceValue !== null);
}

function buildPostingPlan(inventoryRows, facebookRows, options) {
  const nearPriceThreshold = positiveInteger(options.nearPriceThreshold, 1000);
  const indexedFacebookRows = facebookRows.map((row, index) => ({ ...row, _matchId: index }));
  const facebookCounts = new Map();
  const remainingByTitle = new Map();
  const facebookByStock = buildUniqueIndex(indexedFacebookRows, "stock");
  const facebookByVin = buildUniqueIndex(indexedFacebookRows, "vin");
  const consumedFacebookIds = new Set();

  for (const row of indexedFacebookRows) {
    const key = listingKey(row.title, row.priceValue);
    facebookCounts.set(key, (facebookCounts.get(key) || 0) + 1);
    const titleKey = normalizeTitle(row.title);
    if (!remainingByTitle.has(titleKey)) remainingByTitle.set(titleKey, []);
    remainingByTitle.get(titleKey).push(row);
  }

  const duplicateInventoryKeys = countInventoryKeys(inventoryRows);
  const alreadyLive = [];
  const alreadyLiveButNeedsUpdate = [];
  const readyToPost = [];
  const manualReview = [];

  for (const candidate of inventoryRows) {
    const identityMatch = findIdentityMatch(candidate, { stock: facebookByStock, vin: facebookByVin }, consumedFacebookIds);
    if (identityMatch.ambiguous) {
      manualReview.push({
        ...candidateSummary(candidate),
        reason: identityMatch.reason,
        match: identityMatch.match,
      });
      continue;
    }
    if (identityMatch.row) {
      consumeFacebookRow(identityMatch.row, facebookCounts, consumedFacebookIds);
      alreadyLive.push({
        ...candidateSummary(candidate),
        match: {
          type: `identity-${identityMatch.field}`,
          value: identityMatch.value,
          facebookTitle: identityMatch.row.title,
          facebookPrice: identityMatch.row.price,
          listingId: identityMatch.row.listingId,
          listingUrl: identityMatch.row.listingUrl,
          source: identityMatch.row.source,
        },
      });
      continue;
    }

    const key = listingKey(candidate.title, candidate.priceValue);
    const exactCount = facebookCounts.get(key) || 0;
    if (exactCount > 0) {
      facebookCounts.set(key, exactCount - 1);
      alreadyLive.push({
        ...candidateSummary(candidate),
        match: { type: "exact-title-price", key },
      });
      continue;
    }

    const titleKey = normalizeTitle(candidate.title);
    const sameTitleRows = remainingByTitle.get(titleKey) || [];
    const closeRows = sameTitleRows.filter((row) => !consumedFacebookIds.has(row._matchId)
      && row.priceValue !== null
      && candidate.priceValue !== null
      && Math.abs(row.priceValue - candidate.priceValue) <= nearPriceThreshold);
    if (closeRows.length) {
      alreadyLiveButNeedsUpdate.push({
        ...candidateSummary(candidate),
        match: {
          type: "same-title-near-price",
          facebookPrices: closeRows.map((row) => row.price),
        },
      });
      continue;
    }

    if ((duplicateInventoryKeys.get(titleKey) || 0) > 1) {
      manualReview.push({
        ...candidateSummary(candidate),
        reason: "duplicate-inventory-title-without-live-exact-price",
      });
      continue;
    }

    readyToPost.push(candidateSummary(candidate));
  }

  return {
    schema: "facebook-ready-publisher-fast-batch-plan-v1",
    generatedAt: new Date().toISOString(),
    inputs: {
      inventoryFile: options.inventoryFile,
      facebookFile: options.facebookFile,
      publishedResultsFile: options.publishedResultsFile || "",
    },
    summary: {
      candidateCount: inventoryRows.length,
      facebookActiveCount: facebookRows.length,
      readyToPostCount: readyToPost.length,
      alreadyLiveCount: alreadyLive.length,
      alreadyLiveButNeedsUpdateCount: alreadyLiveButNeedsUpdate.length,
      manualReviewCount: manualReview.length,
      nearPriceThreshold,
    },
    readyToPost,
    alreadyLive,
    alreadyLiveButNeedsUpdate,
    manualReview,
  };
}

function buildUniqueIndex(rows, fieldName) {
  const index = new Map();
  for (const row of rows) {
    const value = lower(row[fieldName]);
    if (!value) continue;
    if (!index.has(value)) index.set(value, []);
    index.get(value).push(row);
  }
  return index;
}

function findIdentityMatch(candidate, indexes, consumedIds) {
  for (const field of ["stock", "vin"]) {
    const value = lower(candidate[field]);
    if (!value) continue;
    const matches = (indexes[field].get(value) || []).filter((row) => !consumedIds.has(row._matchId));
    if (matches.length === 1) return { row: matches[0], field, value };
    if (matches.length > 1) {
      return {
        ambiguous: true,
        reason: `ambiguous-live-${field}-match`,
        match: {
          type: `identity-${field}`,
          value,
          candidates: matches.map((row) => ({
            title: row.title,
            price: row.price,
            listingId: row.listingId,
            listingUrl: row.listingUrl,
            source: row.source,
          })),
        },
      };
    }
  }
  return {};
}

function consumeFacebookRow(row, facebookCounts, consumedIds) {
  consumedIds.add(row._matchId);
  const key = listingKey(row.title, row.priceValue);
  const count = facebookCounts.get(key) || 0;
  if (count > 0) facebookCounts.set(key, count - 1);
}

function countInventoryKeys(inventoryRows) {
  const counts = new Map();
  for (const row of inventoryRows) {
    const key = normalizeTitle(row.title);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function normalizeQueueRows(body) {
  const rows = Array.isArray(body) ? body : body?.targets || body?.readyToPost || body?.vehicles || [];
  if (!Array.isArray(rows)) throw new Error("Queue file does not contain targets[], readyToPost[], vehicles[], or an array.");
  return rows.map((row) => ({
    stock: text(row.stock || row.stockNumber),
    vin: text(row.vin),
    albumId: text(row.albumId),
    title: text(row.title || titleFromParts(row.year, row.make, row.model)),
    price: formatMoney(row.price),
    raw: row,
  })).filter((row) => row.stock || row.albumId);
}

function loadCoverChoices(filePath) {
  if (!filePath) return new Map();
  const body = readJson(filePath);
  const rows = Array.isArray(body) ? body : body?.covers || body?.items || [];
  const choices = new Map();
  for (const row of rows) {
    const stock = text(row.stock || row.stockNumber);
    const cover = text(row.chosenCover || row.cover || row.firstSourceFile);
    if (stock && cover) choices.set(stock, cover);
  }
  return choices;
}

async function prepareUploadReadyPackages(queue, coverChoices, options) {
  const runDir = requiredPath(options.runDir, "--run-dir");
  const packagesDir = requiredPath(options.packagesDir, "--packages-dir");
  const unpackedRoot = path.join(runDir, "unpacked");
  const uploadRoot = path.join(runDir, "upload-ready");
  const blocked = [];
  const prepared = [];

  if (!options.dryRun) {
    ensureDir(unpackedRoot);
    ensureDir(uploadRoot);
  }

  for (const target of queue) {
      const startedMs = performance.now();
      try {
        const zipPath = findPackageZip(packagesDir, target);
      let rawPackageRoot = "";
      let mediaFiles = [];
      let fieldsPath = "";
      let descriptionPath = "";
      let manifestPath = "";
      if (options.dryRun) {
        rawPackageRoot = `zip:${zipPath}`;
        mediaFiles = listZipImageEntries(zipPath);
      } else {
        const packageRoot = await extractPackage(zipPath, unpackedRoot);
        rawPackageRoot = findPackageRoot(packageRoot);
        fieldsPath = path.join(rawPackageRoot, "facebook-marketplace-fields.json");
        descriptionPath = path.join(rawPackageRoot, "facebook-marketplace-description.txt");
        manifestPath = path.join(rawPackageRoot, "package-manifest.json");
        mediaFiles = listImageFiles(path.join(rawPackageRoot, "media"));
      }
      if (!mediaFiles.length) throw new Error(`No package image files found for ${target.stock || target.albumId}`);

      const chosenCover = coverChoices.get(target.stock);
      if (!chosenCover && !options.allowFirstImageCover) {
        blocked.push({
          stock: target.stock,
          zipPath,
          reason: "missing-cover-selection",
          message: "Provide --cover-order-file or pass --allow-first-image-cover for dry prep only.",
        });
        timeVehicle(target.stock, "photoPackagePrep", startedMs, { ok: false, reason: "missing-cover-selection" });
        continue;
      }

      const coverName = chosenCover || path.basename(mediaFiles[0]);
      const coverPath = mediaFiles.find((file) => path.basename(file) === coverName);
      if (!coverPath) {
        const mediaLocation = options.dryRun
          ? zipPath
          : path.join(rawPackageRoot, "media");
        throw new Error(`Cover ${coverName} not found in ${mediaLocation}`);
      }

      const orderedFiles = [coverPath, ...mediaFiles.filter((file) => file !== coverPath)];
      const uploadPackageRoot = path.join(uploadRoot, `${target.stock || target.albumId}-upload-package`);
      const photosDir = path.join(uploadPackageRoot, "photos");
      const pickerDir = path.join(uploadPackageRoot, "facebook-upload-photos");
      const records = [];
      const photoPaths = [];

      if (!options.dryRun) {
        removeDir(uploadPackageRoot);
        ensureDir(photosDir);
        ensureDir(pickerDir);
      }

      orderedFiles.forEach((sourcePath, index) => {
        const ext = path.extname(sourcePath).toLowerCase();
        const safeBase = sanitizeFilename(path.basename(sourcePath, ext));
        const filename = `${String(index + 1).padStart(2, "0")}-${safeBase}${ext}`;
        const photosPath = path.join(photosDir, filename);
        const pickerPath = path.join(pickerDir, filename);
        if (!options.dryRun) {
          fs.copyFileSync(sourcePath, photosPath);
          fs.copyFileSync(sourcePath, pickerPath);
        }
        photoPaths.push(pickerPath);
        records.push({
          filename,
          originalName: path.basename(sourcePath),
          sourcePath,
          order: index + 1,
          selectedCover: index === 0,
        });
      });

      if (!options.dryRun) {
        writeJson(path.join(photosDir, "photo-records.json"), { photos: records });
        copyIfExists(fieldsPath, path.join(uploadPackageRoot, "facebook-marketplace-fields.json"));
        copyIfExists(descriptionPath, path.join(uploadPackageRoot, "facebook-marketplace-description.txt"));
        copyIfExists(manifestPath, path.join(uploadPackageRoot, "package-manifest.json"));
        writeJson(path.join(uploadPackageRoot, "inventory-car.json"), target.raw || target);
        writeJson(path.join(uploadPackageRoot, "photo-upload-plan.json"), {
          uploadScope: "inventory-package-photos-only",
          photoCount: photoPaths.length,
          pickerFolder: pickerDir,
          chromeDirectAttachment: {
            preference: "try-first",
            note: "Pass photoPaths to filechooser.setFiles(photoPaths) after clicking Add photos.",
            photoPaths,
          },
        });
      }

      const item = {
        stock: target.stock,
        albumId: target.albumId,
        zipPath,
        sourcePackageRoot: rawPackageRoot,
        uploadPackageRoot,
        chosenCover: coverName,
        firstUploadFile: path.basename(photoPaths[0]),
        photoCount: photoPaths.length,
        dryRun: Boolean(options.dryRun),
      };
      prepared.push(item);
      timeVehicle(target.stock, "photoPackagePrep", startedMs, { ok: true, photoCount: photoPaths.length });
    } catch (error) {
      blocked.push({
        stock: target.stock,
        albumId: target.albumId,
        reason: "package-prep-error",
        message: String(error?.message || error),
      });
      timeVehicle(target.stock || target.albumId || "unknown", "photoPackagePrep", startedMs, {
        ok: false,
        reason: "package-prep-error",
      });
    }
  }

  return {
    schema: "facebook-ready-publisher-upload-ready-summary-v1",
    generatedAt: new Date().toISOString(),
    dryRun: Boolean(options.dryRun),
    prepared,
    blocked,
  };
}

async function extractPackage(zipPath, unpackedRoot) {
  const outputDir = path.join(unpackedRoot, path.basename(zipPath, ".zip"));
  removeDir(outputDir);
  ensureDir(outputDir);
  await spawnChecked("unzip", ["-q", zipPath, "-d", outputDir]);
  return outputDir;
}

function findPackageRoot(unpackedPath) {
  const directManifest = path.join(unpackedPath, "package-manifest.json");
  if (fs.existsSync(directManifest)) return unpackedPath;
  const children = fs.readdirSync(unpackedPath, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  for (const child of children) {
    const candidate = path.join(unpackedPath, child.name);
    if (fs.existsSync(path.join(candidate, "package-manifest.json"))) return candidate;
  }
  return unpackedPath;
}

function inferPackageRootFromZip(unpackedRoot, zipPath) {
  return path.join(unpackedRoot, path.basename(zipPath, ".zip"));
}

function findPackageZip(packagesDir, target) {
  const files = fs.readdirSync(packagesDir)
    .filter((file) => file.toLowerCase().endsWith(".zip"));
  const needles = [target.stock, target.albumId].filter(Boolean).map((value) => lower(value));
  const matches = files.filter((file) => needles.some((needle) => lower(file).includes(needle)));
  if (matches.length !== 1) {
    throw new Error(`Expected one package zip for ${target.stock || target.albumId}, found ${matches.length}: ${matches.join(", ")}`);
  }
  return path.join(packagesDir, matches[0]);
}

function listImageFiles(mediaDir) {
  if (!fs.existsSync(mediaDir)) return [];
  return fs.readdirSync(mediaDir)
    .filter((file) => IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase()))
    .filter((file) => !/cover-photo-candidates|contact-sheet|proof/i.test(file))
    .sort(naturalCompare)
    .map((file) => path.join(mediaDir, file));
}

function listZipImageEntries(zipPath) {
  const output = childProcess.execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" });
  return output.split(/\r?\n/)
    .filter(Boolean)
    .filter((entry) => entry.includes("media/"))
    .filter((entry) => IMAGE_EXTENSIONS.has(path.extname(entry).toLowerCase()))
    .filter((entry) => !/cover-photo-candidates|contact-sheet|proof/i.test(entry))
    .sort(naturalCompare)
    .map((entry) => `zip://${zipPath}!/${entry}`);
}

function spawnChecked(command, commandArgs) {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(command, commandArgs, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited ${code}: ${stderr.trim()}`));
    });
  });
}

function candidateSummary(row) {
  return {
    stock: row.stock,
    vin: row.vin,
    albumId: row.albumId,
    title: row.title,
    price: row.price,
    priceValue: row.priceValue,
    mediaCount: row.mediaCount,
    bodyStyle: row.bodyStyle,
    dealershipName: row.dealershipName,
    detailUrl: row.detailUrl,
  };
}

function listingKey(title, priceValue) {
  return `${normalizeTitle(title)}|${priceValue ?? ""}`;
}

function normalizeTitle(value) {
  let output = lower(value).replace(/\s+/g, " ").trim();
  for (const make of KNOWN_MAKES) {
    output = output.replace(new RegExp(`\\b${escapeRegExp(make)}\\s+${escapeRegExp(make)}\\b`, "g"), make);
  }
  return output;
}

function titleFromParts(year, make, model) {
  return [year, make, model].map(text).filter(Boolean).join(" ");
}

function formatMoney(value) {
  const parsed = moneyToInt(value);
  if (parsed === null) return "";
  return `CA$${parsed.toLocaleString("en-CA")}`;
}

function moneyToInt(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  const digits = String(value).replace(/[^0-9]/g, "");
  return digits ? Number(digits) : null;
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseAllowedDealerships(value) {
  if (value === "all") return new Set();
  if (!value) return DEFAULT_ALLOWED_DEALERSHIPS;
  return new Set(String(value).split(",").map((item) => item.trim()).filter(Boolean));
}

function naturalCompare(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function sanitizeFilename(value) {
  return String(value).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "photo";
}

function copyIfExists(source, destination) {
  if (fs.existsSync(source)) fs.copyFileSync(source, destination);
}

function removeDir(dirPath) {
  fs.rmSync(dirPath, { force: true, recursive: true });
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function text(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function requiredPath(value, name) {
  if (!value) throw new Error(`Missing required ${name}`);
  return path.resolve(value);
}

function parseArgs(argv) {
  if (argv[0] === "--help" || argv[0] === "-h") return { help: true };
  const options = { command: argv[0] };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--run-dir") options.runDir = argv[++index];
    else if (arg === "--inventory-file") options.inventoryFile = argv[++index];
    else if (arg === "--facebook-file") options.facebookFile = argv[++index];
    else if (arg === "--published-results-file") options.publishedResultsFile = argv[++index];
    else if (arg === "--post-queue-file") options.postQueueFile = argv[++index];
    else if (arg === "--packages-dir") options.packagesDir = argv[++index];
    else if (arg === "--cover-order-file") options.coverOrderFile = argv[++index];
    else if (arg === "--output") options.output = argv[++index];
    else if (arg === "--min-photos") options.minPhotos = argv[++index];
    else if (arg === "--near-price-threshold") options.nearPriceThreshold = argv[++index];
    else if (arg === "--allowed-dealerships") options.allowedDealerships = argv[++index];
    else if (arg === "--allow-first-image-cover") options.allowFirstImageCover = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function printHelp() {
  console.log(`Usage:
  node scripts/facebook_ready_publisher_fast_batch.mjs plan \\
    --run-dir <dir> \\
    --inventory-file <production-active-gallery-cars.json> \\
    --facebook-file <facebook-selling-full.json> \\
    [--published-results-file <publish-results.json>]

  node scripts/facebook_ready_publisher_fast_batch.mjs prep-packages \\
    --run-dir <dir> \\
    --post-queue-file <post-queue.json> \\
    --packages-dir <dir> \\
    --cover-order-file <cover-upload-order.json>

Commands:
  plan            Build a batch queue from one inventory snapshot and one Facebook selling sweep.
  prep-packages   Convert current CPC media/ package zips into clean upload-ready folders.

Timing:
  Both commands write fast-batch-timing-ledger.json with phase timings. prep-packages also
  records per-vehicle photoPackagePrep timing. Chrome posting loops should append per-car
  photoUpload, formFill, publish, finalVerification, and markerRepair timings to the same schema.

Safety:
  This helper does not open Facebook, click Next, click Publish, mutate production, or repair markers.
`);
}
