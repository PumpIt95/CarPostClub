#!/usr/bin/env node
import childProcess from "node:child_process";
import crypto from "node:crypto";
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
    const runDir = requiredPath(args.runDir, "--run-dir");
    ensureDir(runDir);
    writeJson(safeChildPath(runDir, "fast-batch-timing-ledger.json"), finishTimingLedger(ledger));
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
    return dedupeFacebookEvidence([...baseRows, ...publishedRows]);
  });

  const plan = await timePhase("queueBuild", async () => buildPostingPlan(inventoryRows, facebookRows, options));
  const outPath = safeChildPath(runDir, safeOutputFilename(options.output || "fast-batch-plan.json"));
  writeJson(outPath, plan);

  activeLedger.status = "ok";
  activeLedger.counts = {
    candidates: plan.summary.candidateCount,
    readyToPost: plan.readyToPost.length,
    alreadyLive: plan.alreadyLive.length,
    alreadyLiveButNeedsUpdate: plan.alreadyLiveButNeedsUpdate.length,
    manualReview: plan.manualReview.length,
  };
  writeJson(safeChildPath(runDir, "fast-batch-timing-ledger.json"), finishTimingLedger(activeLedger));

  printJson({
    ok: true,
    command: "plan",
    output: outPath,
    timingLedger: safeChildPath(runDir, "fast-batch-timing-ledger.json"),
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

  const outputPath = safeChildPath(runDir, safeOutputFilename(options.output || "upload-ready-summary.json"));
  writeJson(outputPath, result);

  activeLedger.status = "ok";
  activeLedger.counts = {
    queue: queue.length,
    prepared: result.prepared.length,
    blocked: result.blocked.length,
    dryRun: Boolean(options.dryRun),
  };
  writeJson(safeChildPath(runDir, "fast-batch-timing-ledger.json"), finishTimingLedger(activeLedger));

  printJson({
    ok: true,
    command: "prep-packages",
    output: outputPath,
    timingLedger: safeChildPath(runDir, "fast-batch-timing-ledger.json"),
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
    .map((row) => ({
      ...row,
      eligibility: inventoryCandidateEligibility(row, { minPhotos, allowedDealerships }),
    }));
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
    facebookReadyForPosting: normalizeFacebookReady(row),
    sourceActive: normalizeSourceActive(row),
    detailUrl: text(row.detailUrl || row.url),
    raw: row,
  };
}

function inventoryCandidateEligibility(row, { minPhotos, allowedDealerships }) {
  const reasons = [];
  if (!row.stock && !row.vin && !row.albumId) reasons.push("missing-vehicle-identity");
  if (row.sourceActive !== true) reasons.push(row.sourceActive === false ? "source-inactive" : "source-active-uncertain");
  if (!row.inventoryType) reasons.push("inventory-type-uncertain");
  else if (row.inventoryType !== "used") reasons.push("inventory-type-disallowed");
  if (allowedDealerships.size) {
    if (!row.dealershipName) reasons.push("dealership-uncertain");
    else if (!allowedDealerships.has(row.dealershipName)) reasons.push("dealership-disallowed");
  }
  if (row.mediaCount === null) reasons.push("media-readiness-uncertain");
  else if (row.mediaCount < minPhotos) reasons.push("insufficient-media");
  if (row.facebookReadyForPosting !== true) {
    reasons.push(row.facebookReadyForPosting === false ? "facebook-readiness-false" : "facebook-readiness-uncertain");
  }
  return {
    ok: reasons.length === 0,
    reasons,
  };
}

function normalizeSourceActive(row) {
  const explicit = row.sourceActive ?? row.inventoryStatus?.sourceActive ?? row.inventoryStatus?.active;
  if (typeof explicit === "boolean") return explicit;
  const status = lower(row.sourceStatus || row.inventoryStatus?.sourceStatus || row.inventoryStatus?.lifecycle?.sourceStatus);
  if (["active", "source_active", "available"].includes(status)) return true;
  if (["removed", "source_removed", "sold", "inactive"].includes(status)) return false;
  return null;
}

function normalizeFacebookReady(row) {
  const explicit = row.facebookReadyForPosting
    ?? row.facebookReady
    ?? row.readyToPost
    ?? row.inventoryStatus?.lifecycle?.canPostToFacebook;
  return typeof explicit === "boolean" ? explicit : null;
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

function dedupeFacebookEvidence(rows) {
  const selected = [];
  const strongKeyToIndex = new Map();
  const fallbackKeyToIndex = new Map();

  for (const row of rows) {
    const keys = facebookEvidenceKeys(row);
    let existingIndex = keys.strong.find((key) => strongKeyToIndex.has(key));
    if (existingIndex) {
      existingIndex = strongKeyToIndex.get(existingIndex);
    } else if (strongKeyToIndex.has(keys.rowKey)) {
      existingIndex = strongKeyToIndex.get(keys.rowKey);
    } else if (keys.fallback && fallbackKeyToIndex.has(keys.fallback)) {
      const fallbackIndex = fallbackKeyToIndex.get(keys.fallback);
      const fallbackRow = selected[fallbackIndex];
      const fallbackKeys = facebookEvidenceKeys(fallbackRow);
      if (
        row.source === "published-results"
        || fallbackRow.source === "published-results"
        || !keys.strong.length
        || !fallbackKeys.strong.length
      ) {
        existingIndex = fallbackIndex;
      }
    }

    if (existingIndex === undefined) {
      rememberFacebookEvidenceRow(selected, strongKeyToIndex, fallbackKeyToIndex, row);
      continue;
    }

    const preferred = preferredFacebookEvidence(selected[existingIndex], row);
    selected[existingIndex] = preferred;
    rebuildFacebookEvidenceIndexes(selected, strongKeyToIndex, fallbackKeyToIndex);
  }

  return selected;
}

function facebookEvidenceKeys(row) {
  const strong = [];
  if (row.listingId) strong.push(`id:${lower(row.listingId)}`);
  if (row.listingUrl) strong.push(`url:${normalizeListingUrl(row.listingUrl)}`);
  if (row.stock) strong.push(`stock:${lower(row.stock)}`);
  if (row.vin) strong.push(`vin:${lower(row.vin)}`);
  const fallback = row.title && row.priceValue !== null ? `title-price:${listingKey(row.title, row.priceValue)}` : "";
  return {
    strong,
    fallback,
    rowKey: `row:${crypto.createHash("sha256").update(JSON.stringify(row.raw || row)).digest("hex")}`,
  };
}

function rememberFacebookEvidenceRow(selected, strongKeyToIndex, fallbackKeyToIndex, row) {
  const index = selected.length;
  selected.push(row);
  rememberFacebookEvidenceKeys(strongKeyToIndex, fallbackKeyToIndex, row, index);
}

function rememberFacebookEvidenceKeys(strongKeyToIndex, fallbackKeyToIndex, row, index) {
  const keys = facebookEvidenceKeys(row);
  for (const key of keys.strong) strongKeyToIndex.set(key, index);
  strongKeyToIndex.set(keys.rowKey, index);
  if (keys.fallback && !fallbackKeyToIndex.has(keys.fallback)) fallbackKeyToIndex.set(keys.fallback, index);
}

function rebuildFacebookEvidenceIndexes(selected, strongKeyToIndex, fallbackKeyToIndex) {
  strongKeyToIndex.clear();
  fallbackKeyToIndex.clear();
  selected.forEach((row, index) => rememberFacebookEvidenceKeys(strongKeyToIndex, fallbackKeyToIndex, row, index));
}

function preferredFacebookEvidence(left, right) {
  const leftFresh = left.source !== "published-results";
  const rightFresh = right.source !== "published-results";
  if (leftFresh !== rightFresh) return rightFresh ? right : left;
  return left;
}

function normalizeListingUrl(value) {
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString().replace(/\/+$/, "").toLowerCase();
  } catch {
    return lower(value).replace(/\/+$/, "");
  }
}

function buildPostingPlan(inventoryRows, facebookRows, options) {
  const nearPriceThreshold = positiveInteger(options.nearPriceThreshold, 1000);
  const indexedFacebookRows = facebookRows.map((row, index) => ({ ...row, _matchId: index }));
  const remainingByListingKey = new Map();
  const remainingByTitle = new Map();
  const facebookByStock = buildUniqueIndex(indexedFacebookRows, "stock");
  const facebookByVin = buildUniqueIndex(indexedFacebookRows, "vin");
  const consumedFacebookIds = new Set();

  for (const row of indexedFacebookRows) {
    const key = listingKey(row.title, row.priceValue);
    if (!remainingByListingKey.has(key)) remainingByListingKey.set(key, []);
    remainingByListingKey.get(key).push(row);
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
    if (!candidate.eligibility?.ok) {
      manualReview.push({
        ...candidateSummary(candidate),
        reason: candidate.eligibility?.reasons?.[0] || "candidate-not-eligible",
        eligibilityReasons: candidate.eligibility?.reasons || ["candidate-not-eligible"],
      });
      continue;
    }

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
      consumeFacebookRow(identityMatch.row, consumedFacebookIds);
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
    const exactMatch = findListingKeyMatch(key, remainingByListingKey, consumedFacebookIds);
    if (exactMatch) {
      consumeFacebookRow(exactMatch, consumedFacebookIds);
      alreadyLive.push({
        ...candidateSummary(candidate),
        match: {
          type: "exact-title-price",
          key,
          facebookTitle: exactMatch.title,
          facebookPrice: exactMatch.price,
          listingId: exactMatch.listingId,
          listingUrl: exactMatch.listingUrl,
          source: exactMatch.source,
        },
      });
      continue;
    }

    const titleKey = normalizeTitle(candidate.title);
    const duplicateTitleCount = duplicateInventoryKeys.get(titleKey) || 0;
    const sameTitleRows = remainingByTitle.get(titleKey) || [];
    const closeRows = sameTitleRows.filter((row) => !consumedFacebookIds.has(row._matchId)
      && row.priceValue !== null
      && candidate.priceValue !== null
      && Math.abs(row.priceValue - candidate.priceValue) <= nearPriceThreshold);
    if (closeRows.length) {
      if (duplicateTitleCount > 1) {
        manualReview.push({
          ...candidateSummary(candidate),
          reason: "ambiguous-near-price-duplicate-title",
          match: nearPriceMatchSummary(closeRows),
        });
        continue;
      }
      if (closeRows.length > 1) {
        manualReview.push({
          ...candidateSummary(candidate),
          reason: "ambiguous-near-price-facebook-match",
          match: nearPriceMatchSummary(closeRows),
        });
        continue;
      }
      consumeFacebookRow(closeRows[0], consumedFacebookIds);
      alreadyLiveButNeedsUpdate.push({
        ...candidateSummary(candidate),
        match: {
          type: "same-title-near-price",
          facebookPrices: [closeRows[0].price],
          listingId: closeRows[0].listingId,
          listingUrl: closeRows[0].listingUrl,
          source: closeRows[0].source,
        },
      });
      continue;
    }

    if (duplicateTitleCount > 1) {
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

function findListingKeyMatch(key, rowsByListingKey, consumedIds) {
  return (rowsByListingKey.get(key) || []).find((row) => !consumedIds.has(row._matchId)) || null;
}

function nearPriceMatchSummary(rows) {
  return {
    type: "same-title-near-price",
    candidates: rows.map((row) => ({
      facebookTitle: row.title,
      facebookPrice: row.price,
      listingId: row.listingId,
      listingUrl: row.listingUrl,
      source: row.source,
    })),
    facebookPrices: rows.map((row) => row.price),
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

function consumeFacebookRow(row, consumedIds) {
  consumedIds.add(row._matchId);
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
  const unpackedRoot = safeChildPath(runDir, "unpacked");
  const uploadRoot = safeChildPath(runDir, "upload-ready");
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

      const coverName = safeArchiveFilename(chosenCover || path.basename(mediaFiles[0]), "cover");
      const coverPath = mediaFiles.find((file) => path.basename(file) === coverName);
      if (!coverPath) {
        const mediaLocation = options.dryRun
          ? zipPath
          : path.join(rawPackageRoot, "media");
        throw new Error(`Cover ${coverName} not found in ${mediaLocation}`);
      }

      const orderedFiles = [coverPath, ...mediaFiles.filter((file) => file !== coverPath)];
      const uploadPackageRoot = safeChildPath(uploadRoot, safePackageDirectoryName(target));
      const photosDir = safeChildPath(uploadPackageRoot, "photos");
      const pickerDir = safeChildPath(uploadPackageRoot, "facebook-upload-photos");
      const records = [];
      const photoPaths = [];

      if (!options.dryRun) {
        removeDirStrictChild(uploadRoot, uploadPackageRoot);
        ensureDir(photosDir);
        ensureDir(pickerDir);
      }

      orderedFiles.forEach((sourcePath, index) => {
        const ext = path.extname(sourcePath).toLowerCase();
        const safeBase = sanitizePathLabel(path.basename(sourcePath, ext), "photo");
        const filename = `${String(index + 1).padStart(2, "0")}-${safeBase}${ext}`;
        const photosPath = safeChildPath(photosDir, filename);
        const pickerPath = safeChildPath(pickerDir, filename);
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
        writeJson(safeChildPath(photosDir, "photo-records.json"), { photos: records });
        copyIfExists(fieldsPath, safeChildPath(uploadPackageRoot, "facebook-marketplace-fields.json"));
        copyIfExists(descriptionPath, safeChildPath(uploadPackageRoot, "facebook-marketplace-description.txt"));
        copyIfExists(manifestPath, safeChildPath(uploadPackageRoot, "package-manifest.json"));
        writeJson(safeChildPath(uploadPackageRoot, "inventory-car.json"), target.raw || target);
        writeJson(safeChildPath(uploadPackageRoot, "photo-upload-plan.json"), {
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
  const outputDir = safeChildPath(unpackedRoot, safeExtractDirectoryName(zipPath));
  removeDirStrictChild(unpackedRoot, outputDir);
  ensureDir(outputDir);
  const entries = safeZipEntries(zipPath);
  const outputPaths = new Set();
  for (const entry of entries) {
    if (entry.directory) continue;
    const outputPath = safeZipOutputPath(outputDir, entry.name);
    if (outputPaths.has(outputPath)) throw new Error(`Duplicate ZIP output path: ${entry.raw}`);
    outputPaths.add(outputPath);
  }
  for (const entry of entries) {
    if (entry.directory) continue;
    const outputPath = safeZipOutputPath(outputDir, entry.name);
    ensureDir(path.dirname(outputPath));
    const body = childProcess.execFileSync("unzip", ["-p", zipPath, entry.raw], { encoding: "buffer", maxBuffer: 100 * 1024 * 1024 });
    fs.writeFileSync(outputPath, body);
  }
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

function findPackageZip(packagesDir, target) {
  const files = fs.readdirSync(packagesDir)
    .filter((file) => file.toLowerCase().endsWith(".zip"));
  const needles = packageSearchTokens(target);
  const matches = files.filter((file) => needles.some((needle) => lower(file).includes(needle)));
  if (matches.length !== 1) {
    throw new Error(`Expected one package zip for ${target.stock || target.albumId}, found ${matches.length}: ${matches.join(", ")}`);
  }
  return safeChildPath(packagesDir, safeArchiveFilename(matches[0], "package.zip"));
}

function listImageFiles(mediaDir) {
  if (!fs.existsSync(mediaDir)) return [];
  return fs.readdirSync(mediaDir)
    .map((file) => safeArchiveFilename(file, "photo"))
    .filter((file) => IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase()))
    .filter((file) => !/cover-photo-candidates|contact-sheet|proof/i.test(file))
    .sort(naturalCompare)
    .map((file) => safeChildPath(mediaDir, file));
}

function listZipImageEntries(zipPath) {
  return safeZipEntries(zipPath)
    .filter((entry) => !entry.directory)
    .map((entry) => entry.name)
    .filter((entry) => entry.split("/").includes("media"))
    .filter((entry) => IMAGE_EXTENSIONS.has(path.extname(entry).toLowerCase()))
    .filter((entry) => !/cover-photo-candidates|contact-sheet|proof/i.test(entry))
    .sort(naturalCompare)
    .map((entry) => `zip://${zipPath}!/${entry}`);
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

function packageSearchTokens(target) {
  const tokens = new Set();
  for (const value of [target.stock, target.albumId, target.vin]) {
    const raw = text(value);
    if (!raw) continue;
    const label = sanitizePathLabel(raw, "");
    if (label) tokens.add(lower(label));
    if (safePlainToken(raw)) tokens.add(lower(raw));
  }
  if (!tokens.size) throw new Error(`No safe package search token for ${target.title || "vehicle"}`);
  return [...tokens];
}

function safePlainToken(value) {
  const token = text(value);
  return Boolean(token && !/[\\/:\u0000-\u001f\u007f]/.test(token) && token !== "." && token !== ".." && !path.isAbsolute(token));
}

function safePackageDirectoryName(target) {
  const identity = [target.stock, target.albumId, target.vin, target.title].map(text).filter(Boolean).join("_") || "vehicle";
  return `${safeHashedSegment(identity, "vehicle")}-upload-package`;
}

function safeExtractDirectoryName(zipPath) {
  return `${safeHashedSegment(path.basename(zipPath, ".zip"), "package")}-extract`;
}

function safeHashedSegment(value, fallback) {
  const label = sanitizePathLabel(value, fallback).slice(0, 48);
  const digest = crypto.createHash("sha256").update(text(value) || fallback).digest("hex").slice(0, 12);
  return `${label}-${digest}`;
}

function sanitizePathLabel(value, fallback = "item") {
  const label = String(value || "")
    .replace(/[\u0000-\u001f\u007f\\/:\s]+/g, "-")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .replace(/-+/g, "-")
    .slice(0, 80);
  return label || fallback;
}

function safeOutputFilename(value) {
  return safeArchiveFilename(value, "output.json");
}

function safeArchiveFilename(value, fallback) {
  const name = text(value);
  if (!name) return fallback;
  if (path.isAbsolute(name) || /[\\/:\u0000-\u001f\u007f]/.test(name) || name === "." || name === "..") {
    throw new Error(`Unsafe filename: ${name}`);
  }
  const base = path.basename(name);
  if (base !== name || !base || base === "." || base === "..") throw new Error(`Unsafe filename: ${name}`);
  return base;
}

function safeChildPath(root, ...segments) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(resolvedRoot, ...segments);
  if (resolvedTarget === resolvedRoot || !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Path escapes expected root: ${resolvedTarget}`);
  }
  return resolvedTarget;
}

function removeDirStrictChild(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  if (resolvedTarget === resolvedRoot || !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Refusing recursive removal outside expected root: ${resolvedTarget}`);
  }
  fs.rmSync(resolvedTarget, { force: true, recursive: true });
}

function safeZipEntries(zipPath) {
  const output = childProcess.execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" });
  const seen = new Set();
  return output.split(/\r?\n/)
    .filter(Boolean)
    .map((raw) => safeZipEntry(raw))
    .map((entry) => {
      if (seen.has(entry.name)) throw new Error(`Duplicate ZIP entry: ${entry.raw}`);
      seen.add(entry.name);
      return entry;
    });
}

function safeZipEntry(raw) {
  const value = String(raw || "");
  if (!value || /[\u0000-\u001f\u007f\\]/.test(value) || path.isAbsolute(value) || /^[A-Za-z]:/.test(value)) {
    throw new Error(`Unsafe ZIP entry: ${value}`);
  }
  const directory = value.endsWith("/");
  const trimmed = value.replace(/\/+$/g, "");
  const segments = trimmed.split("/");
  if (!trimmed || segments.some((segment) => !segment || segment === "." || segment === ".." || /[\u0000-\u001f\u007f\\/]/.test(segment))) {
    throw new Error(`Unsafe ZIP entry: ${value}`);
  }
  return {
    raw: value,
    name: segments.join("/"),
    directory,
  };
}

function safeZipOutputPath(root, entryName) {
  return safeChildPath(root, ...entryName.split("/"));
}

function copyIfExists(source, destination) {
  if (fs.existsSync(source)) fs.copyFileSync(source, destination);
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
