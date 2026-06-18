#!/usr/bin/env node
import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";
import {
  FAST_BROWSER_METHOD,
  buildDryRunPostingPlan,
  buildPerVehicleDryRunTimings,
  createPublishGate,
} from "./facebook_ready_publisher_browser_executor.mjs";

const ROOT = process.cwd();
const FAST_BATCH_SCRIPT = path.join(ROOT, "scripts/facebook_ready_publisher_fast_batch.mjs");
const DEFAULT_ARTIFACT_ROOT = path.join(ROOT, "automation-runs");
const SOURCE_FILES = [
  path.join(ROOT, "scripts/facebook_ready_publisher.mjs"),
  path.join(ROOT, "scripts/facebook_ready_publisher_fast_batch.mjs"),
  path.join(ROOT, "scripts/facebook_ready_publisher_browser_executor.mjs"),
  path.join(ROOT, "docs/ready-publisher-fast-batch.md"),
  path.join(ROOT, "package.json"),
];

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}

const startedAt = new Date();
const startedMs = performance.now();
const runDir = resolveRunDir(options);
ensureDir(runDir);

try {
  const result = await runPublisher(options, runDir, startedAt, startedMs);
  printJson({
    ok: true,
    command: "facebook-ready-publisher",
    mode: result.mode,
    runDir,
    report: result.reportPath,
    timingLedger: result.timingLedgerPath,
    summary: result.summary,
    publishGate: result.publishGate,
  });
} catch (error) {
  const failurePath = path.join(runDir, "integrated-dry-run-report.json");
  writeJson(failurePath, {
    schema: "facebook-ready-publisher-integrated-report-v1",
    generatedAt: new Date().toISOString(),
    ok: false,
    error: String(error?.stack || error),
  });
  throw error;
}

async function runPublisher(rawOptions, activeRunDir, started, startedPerformanceMs) {
  const resolved = applyDefaultInputs(rawOptions);
  const mode = getMode(resolved);
  const timing = createTimingLedger(started);
  const artifacts = {};
  const publishGate = createPublishGate({
    publish: resolved.publish,
    dryRun: resolved.dryRun,
    stopBeforeNext: resolved.stopBeforeNext,
    stopBeforePublish: resolved.stopBeforePublish,
  });

  if (resolved.prepOnly) {
    const prep = await timePhase(timing, "packagePrep", () => runPrepHelper(resolved, activeRunDir, "prep-only"));
    artifacts.uploadReadySummary = prep.summaryPath;
    artifacts.prepTimingLedger = prep.timingPath;
    const report = writeFinalArtifacts({
      runDir: activeRunDir,
      mode,
      timing,
      publishGate,
      classification: emptyClassification(),
      postingLoopPlan: buildDryRunPostingPlan([], prep.summary, publishGate),
      uploadSummary: prep.summary,
      helperOutputs: { prep },
      startedPerformanceMs,
      started,
      artifacts,
      rawOptions: resolved,
    });
    return report;
  }

  const plan = await timePhase(timing, "fastBatchPlan", () => runPlanHelper(resolved, activeRunDir));
  artifacts.fastBatchPlan = plan.planPath;
  artifacts.planTimingLedger = plan.timingPath;

  const classification = await timePhase(timing, "candidateClassification", () => (
    buildClassification(plan.plan, resolved)
  ));

  artifacts.classificationLedger = path.join(activeRunDir, "classification-ledger.json");
  artifacts.skippedVehicles = path.join(activeRunDir, "skipped-vehicles.json");
  artifacts.priceUpdateCandidates = path.join(activeRunDir, "price-update-candidates.json");
  artifacts.blockedVehicles = path.join(activeRunDir, "blocked-vehicles.json");

  let prep = {
    summary: emptyUploadSummary(resolved.dryRun),
    summaryPath: path.join(activeRunDir, "upload-ready-summary.json"),
    timingPath: "",
    skipped: true,
    reason: "plan-only",
  };

  if (!resolved.planOnly) {
    prep = await timePhase(timing, "packagePrep", () => runPrepForReadyToPost(resolved, activeRunDir, classification));
  }
  artifacts.uploadReadySummary = prep.summaryPath;
  if (prep.timingPath) artifacts.prepTimingLedger = prep.timingPath;

  const postingLoopPlan = await timePhase(timing, "browserPostingLoop", () => {
    const loopPlan = buildDryRunPostingPlan(classification.classifications.readyToPost, prep.summary, publishGate);
    writeJson(path.join(activeRunDir, "posting-loop-plan.json"), loopPlan);
    timing.vehicles = {
      ...timing.vehicles,
      ...buildPerVehicleDryRunTimings(classification.classifications.readyToPost, publishGate),
    };
    return loopPlan;
  });
  artifacts.postingLoopPlan = path.join(activeRunDir, "posting-loop-plan.json");

  await timePhase(timing, "finalVerification", () => writeJson(path.join(activeRunDir, "final-verification-plan.json"), {
    schema: "facebook-ready-publisher-final-verification-plan-v1",
    generatedAt: new Date().toISOString(),
    status: publishGate.canClickPublish ? "required-after-publish" : "skipped-no-publish",
    requiredChecks: [
      "selling-page active card title and price verification",
      "public listing detail page exposes the real edit listing_id",
      "edit form readback for Year, Make, Model, Mileage, Price, and Body style",
      "all-digit Facebook Make or Model values block completion until repaired",
    ],
    note: "The final selling-page and edit-form verification runs after explicit publish attempts and before marker/status repair.",
  }));
  artifacts.finalVerificationPlan = path.join(activeRunDir, "final-verification-plan.json");

  await timePhase(timing, "markerRepair", () => writeJson(path.join(activeRunDir, "marker-repair-plan.json"), {
    schema: "facebook-ready-publisher-marker-repair-plan-v1",
    generatedAt: new Date().toISOString(),
    status: "deferred-until-after-final-live-verification",
    dryRun: !publishGate.canClickPublish,
    productionMutation: false,
  }));
  artifacts.markerRepairPlan = path.join(activeRunDir, "marker-repair-plan.json");

  return writeFinalArtifacts({
    runDir: activeRunDir,
    mode,
    timing,
    publishGate,
    classification,
    postingLoopPlan,
    uploadSummary: prep.summary,
    helperOutputs: { plan, prep },
    startedPerformanceMs,
    started,
    artifacts,
    rawOptions: resolved,
  });
}

function runPlanHelper(options, activeRunDir) {
  requireReadable(options.inventoryFile, "--inventory-file");
  requireReadable(options.facebookFile, "--facebook-file");
  if (options.publishedResultsFile) requireReadable(options.publishedResultsFile, "--published-results-file");

  const helperRunDir = path.join(activeRunDir, "01-fast-batch-plan");
  const helperArgs = [
    "plan",
    "--run-dir", helperRunDir,
    "--inventory-file", options.inventoryFile,
    "--facebook-file", options.facebookFile,
  ];
  if (options.publishedResultsFile) helperArgs.push("--published-results-file", options.publishedResultsFile);
  if (options.minPhotos) helperArgs.push("--min-photos", String(options.minPhotos));
  if (options.nearPriceThreshold) helperArgs.push("--near-price-threshold", String(options.nearPriceThreshold));
  if (options.allowedDealerships) helperArgs.push("--allowed-dealerships", options.allowedDealerships);

  const helper = runFastBatchHelper(helperArgs);
  const planPath = path.join(helperRunDir, "fast-batch-plan.json");
  const timingPath = path.join(helperRunDir, "fast-batch-timing-ledger.json");
  return {
    helper,
    planPath,
    timingPath,
    plan: readJson(planPath),
    timing: readJson(timingPath),
  };
}

function runPrepForReadyToPost(options, activeRunDir, classification) {
  const ready = classification.classifications.readyToPost;
  if (!ready.length) {
    const summary = emptyUploadSummary(Boolean(options.dryRun || !options.publish));
    const summaryPath = path.join(activeRunDir, "upload-ready-summary.json");
    writeJson(summaryPath, summary);
    return {
      summary,
      summaryPath,
      timingPath: "",
      skipped: true,
      reason: "no-ready-to-post",
    };
  }

  if (!options.packagesDir || !options.coverOrderFile) {
    const summary = {
      ...emptyUploadSummary(true),
      blocked: ready.map((vehicle) => ({
        stock: vehicle.stock,
        albumId: vehicle.albumId,
        reason: "missing-package-prep-inputs",
        message: "Provide --packages-dir and --cover-order-file before entering the browser posting loop.",
      })),
    };
    const summaryPath = path.join(activeRunDir, "upload-ready-summary.json");
    writeJson(summaryPath, summary);
    return { summary, summaryPath, timingPath: "", skipped: true, reason: "missing-package-prep-inputs" };
  }

  const queuePath = path.join(activeRunDir, "ready-to-post-queue.json");
  writeJson(queuePath, { vehicles: ready });
  return runPrepHelper({ ...options, postQueueFile: queuePath }, activeRunDir, "ready-to-post");
}

function runPrepHelper(options, activeRunDir, prefix) {
  requireReadable(options.postQueueFile, "--post-queue-file");
  requireDirectory(options.packagesDir, "--packages-dir");
  requireReadable(options.coverOrderFile, "--cover-order-file");

  const helperRunDir = path.join(activeRunDir, prefix === "prep-only" ? "01-upload-ready-prep" : "02-upload-ready-prep");
  const helperArgs = [
    "prep-packages",
    "--run-dir", helperRunDir,
    "--post-queue-file", options.postQueueFile,
    "--packages-dir", options.packagesDir,
    "--cover-order-file", options.coverOrderFile,
  ];
  if (options.dryRun || !options.publish) helperArgs.push("--dry-run");
  if (options.allowFirstImageCover) helperArgs.push("--allow-first-image-cover");

  const helper = runFastBatchHelper(helperArgs);
  const summaryPath = path.join(helperRunDir, "upload-ready-summary.json");
  const timingPath = path.join(helperRunDir, "fast-batch-timing-ledger.json");
  return {
    helper,
    summaryPath,
    timingPath,
    summary: readJson(summaryPath),
    timing: readJson(timingPath),
  };
}

function runFastBatchHelper(args) {
  const child = childProcess.spawnSync(process.execPath, [FAST_BATCH_SCRIPT, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (child.status !== 0) {
    throw new Error([
      `fast-batch helper failed with exit ${child.status}`,
      child.stdout.trim(),
      child.stderr.trim(),
    ].filter(Boolean).join("\n"));
  }
  return {
    command: [process.execPath, FAST_BATCH_SCRIPT, ...args],
    stdout: parseMaybeJson(child.stdout),
    stderr: child.stderr.trim(),
  };
}

function buildClassification(plan, options) {
  const stockFilter = parseStockFilter(options.stocks);
  const limitedReady = applyReadyFilters(plan.readyToPost || [], stockFilter, options.max);
  const excludedReady = (plan.readyToPost || []).filter((vehicle) => (
    !limitedReady.some((selected) => selected.stock === vehicle.stock && selected.albumId === vehicle.albumId)
  ));

  const classifications = {
    alreadyLive: plan.alreadyLive || [],
    readyToPost: limitedReady,
    priceUpdateCandidate: plan.alreadyLiveButNeedsUpdate || [],
    blocked: [
      ...(plan.manualReview || []).map((vehicle) => ({ ...vehicle, classificationReason: vehicle.reason || "manual-review" })),
      ...excludedReady.map((vehicle) => ({
        ...vehicle,
        classificationReason: stockFilter.size ? "filtered-by-stocks" : "filtered-by-max",
      })),
    ],
    needsReview: [],
  };

  const counts = Object.fromEntries(Object.entries(classifications).map(([key, value]) => [`${key}Count`, value.length]));
  return {
    schema: "facebook-ready-publisher-classification-ledger-v1",
    generatedAt: new Date().toISOString(),
    matchingPolicy: {
      source: "facebook_ready_publisher_fast_batch.mjs",
      duplicateSafe: true,
      rules: [
        "fresh full selling-page/live-state evidence is preferred over legacy CPC marker rows",
        "published-results from the successful 10-car run can be used as already-live evidence but does not replace a fresh live sweep",
        "exact title/price matches are consumed by count so same-title duplicates do not over-match",
        "same-title near-price matches become priceUpdateCandidate, not readyToPost",
        "duplicate inventory titles without exact live price are blocked for review",
      ],
    },
    filters: {
      stocks: [...stockFilter],
      max: options.max || null,
    },
    counts,
    planSummary: plan.summary,
    classifications,
  };
}

function applyReadyFilters(ready, stockFilter, max) {
  let output = ready;
  if (stockFilter.size) output = output.filter((vehicle) => stockFilter.has(String(vehicle.stock || "").toUpperCase()));
  if (max) output = output.slice(0, max);
  return output;
}

function writeFinalArtifacts(context) {
  const {
    runDir: activeRunDir,
    mode,
    timing,
    publishGate,
    classification,
    postingLoopPlan,
    uploadSummary,
    helperOutputs,
    startedPerformanceMs,
    started,
    artifacts,
    rawOptions,
  } = context;

  const finishedAt = new Date();
  const classificationLedger = classification.schema ? classification : emptyClassification();
  const counts = classificationLedger.counts || {};
  const skippedVehicles = buildSkippedVehicles(classificationLedger.classifications || emptyClassification().classifications);
  const blocked = [
    ...(classificationLedger.classifications?.blocked || []),
    ...(uploadSummary?.blocked || []),
  ];

  timing.status = "ok";
  timing.finishedAt = finishedAt.toISOString();
  timing.elapsedMs = Math.round(performance.now() - startedPerformanceMs);
  timing.publishGate = publishGate;
  timing.summary = counts;
  timing.requestedPhaseTiming = buildRequestedPhaseTiming({
    timing,
    helperOutputs,
    classification: classificationLedger,
    uploadSummary,
    publishGate,
  });

  writeJson(path.join(activeRunDir, "classification-ledger.json"), classificationLedger);
  writeJson(path.join(activeRunDir, "skipped-vehicles.json"), skippedVehicles);
  writeJson(path.join(activeRunDir, "price-update-candidates.json"), classificationLedger.classifications?.priceUpdateCandidate || []);
  writeJson(path.join(activeRunDir, "blocked-vehicles.json"), blocked);
  writeJson(path.join(activeRunDir, "timing-ledger.json"), timing);

  const filesChangedPath = path.join(activeRunDir, "files-changed.json");
  const testResultsPath = path.join(activeRunDir, "test-results.json");
  const reportPath = path.join(activeRunDir, "integrated-dry-run-report.json");
  const report = {
    schema: "facebook-ready-publisher-integrated-report-v1",
    generatedAt: finishedAt.toISOString(),
    ok: true,
    mode,
    startedAt: started.toISOString(),
    finishedAt: finishedAt.toISOString(),
    elapsedMs: timing.elapsedMs,
    inputs: pickInputs(rawOptions),
    helperIntegration: {
      type: "node-child-process",
      script: FAST_BATCH_SCRIPT,
      planCommand: helperOutputs.plan?.helper?.command || [],
      prepCommand: helperOutputs.prep?.helper?.command || [],
    },
    publishGate,
    browserExecutor: {
      importedModule: path.join(ROOT, "scripts/facebook_ready_publisher_browser_executor.mjs"),
      patterns: FAST_BROWSER_METHOD.patterns,
      postingLoopVehicles: postingLoopPlan.vehicles.length,
      publishClicksAttempted: 0,
    },
    counts,
    summary: {
      candidateCount: classificationLedger.planSummary?.candidateCount || 0,
      alreadyLiveCount: counts.alreadyLiveCount || 0,
      readyToPostCount: counts.readyToPostCount || 0,
      priceUpdateCandidateCount: counts.priceUpdateCandidateCount || 0,
      blockedCount: counts.blockedCount || blocked.length,
      needsReviewCount: counts.needsReviewCount || 0,
      preparedPackageCount: uploadSummary?.prepared?.length || 0,
      blockedPackageCount: uploadSummary?.blocked?.length || 0,
      publishedCount: 0,
      productionMutations: 0,
    },
    priceUpdateCandidateStocks: (classificationLedger.classifications?.priceUpdateCandidate || []).map((vehicle) => ({
      stock: vehicle.stock,
      title: vehicle.title,
      appPrice: vehicle.price,
      facebookPrices: vehicle.match?.facebookPrices || [],
    })),
    safety: {
      noFacebookOpenedByThisScript: true,
      noChromeTabClaimedByThisScript: true,
      noPublishClicked: true,
      markerRepairAfterFinalVerification: true,
      productionMutationInDryRun: false,
    },
    artifacts,
  };

  writeJson(filesChangedPath, {
    schema: "facebook-ready-publisher-files-changed-v1",
    generatedAt: finishedAt.toISOString(),
    sourceFiles: SOURCE_FILES,
    generatedArtifacts: [
      reportPath,
      path.join(activeRunDir, "timing-ledger.json"),
      path.join(activeRunDir, "classification-ledger.json"),
      path.join(activeRunDir, "skipped-vehicles.json"),
      path.join(activeRunDir, "price-update-candidates.json"),
      path.join(activeRunDir, "blocked-vehicles.json"),
      filesChangedPath,
      testResultsPath,
    ],
    note: "This artifact is updated by the validation pass with exact command results.",
  });
  writeJson(testResultsPath, {
    schema: "facebook-ready-publisher-test-results-v1",
    generatedAt: finishedAt.toISOString(),
    status: "pending-validation",
    commands: [],
  });
  writeJson(reportPath, report);

  return {
    mode,
    reportPath,
    timingLedgerPath: path.join(activeRunDir, "timing-ledger.json"),
    summary: report.summary,
    publishGate,
  };
}

function buildRequestedPhaseTiming({ timing, helperOutputs, classification, uploadSummary, publishGate }) {
  const planPhases = helperOutputs.plan?.timing?.phases || [];
  const prepPhases = helperOutputs.prep?.timing?.phases || [];
  const integratedPhases = timing.phases || [];
  const readyVehicles = classification.classifications?.readyToPost || [];
  return {
    schema: "facebook-ready-publisher-requested-phase-timing-v1",
    candidateScan: summarizePhase(planPhases, "candidateScan"),
    facebookLiveSweep: summarizePhase(planPhases, "facebookLiveCheck"),
    candidateClassification: summarizePhase(integratedPhases, "candidateClassification"),
    packagePrep: summarizePhase(prepPhases, "photoPackagePrep")
      || summarizePhase(integratedPhases, "packagePrep")
      || skippedPhaseTiming("no-ready-to-post"),
    perVehicle: readyVehicles.map((vehicle) => ({
      stock: vehicle.stock,
      title: vehicle.title,
      photoUpload: timing.vehicles?.[vehicle.stock]?.photoUpload || skippedVehiclePhase(publishGate),
      formFill: timing.vehicles?.[vehicle.stock]?.formFill || skippedVehiclePhase(publishGate),
      preNextVerification: timing.vehicles?.[vehicle.stock]?.preNextVerification || skippedVehiclePhase(publishGate),
      publish: timing.vehicles?.[vehicle.stock]?.publish || skippedVehiclePhase(publishGate),
      postPublishEditVerification: timing.vehicles?.[vehicle.stock]?.postPublishEditVerification || skippedVehiclePhase(publishGate),
    })),
    finalVerification: summarizePhase(integratedPhases, "finalVerification") || skippedPhaseTiming("not-run"),
    markerRepair: summarizePhase(integratedPhases, "markerRepair") || skippedPhaseTiming("not-run"),
    total: {
      elapsedMs: timing.elapsedMs,
      ok: timing.status === "ok",
    },
    uploadSummary: {
      prepared: uploadSummary?.prepared?.length || 0,
      blocked: uploadSummary?.blocked?.length || 0,
    },
  };
}

function summarizePhase(phases, name) {
  const matches = phases.filter((phase) => phase.name === name);
  if (!matches.length) return null;
  return {
    elapsedMs: matches.reduce((total, phase) => total + (phase.elapsedMs || 0), 0),
    ok: matches.every((phase) => phase.ok !== false),
    occurrences: matches.length,
  };
}

function skippedPhaseTiming(reason) {
  return {
    elapsedMs: 0,
    ok: true,
    skipped: true,
    reason,
  };
}

function skippedVehiclePhase(publishGate) {
  return {
    elapsedMs: 0,
    ok: true,
    skipped: true,
    reason: publishGate.reason,
  };
}

async function timePhase(timing, name, fn) {
  const phaseStartedAt = new Date().toISOString();
  const phaseStartedMs = performance.now();
  try {
    const result = await fn();
    timing.phases.push({
      name,
      startedAt: phaseStartedAt,
      elapsedMs: Math.round(performance.now() - phaseStartedMs),
      ok: true,
    });
    return result;
  } catch (error) {
    timing.phases.push({
      name,
      startedAt: phaseStartedAt,
      elapsedMs: Math.round(performance.now() - phaseStartedMs),
      ok: false,
      error: String(error?.message || error),
    });
    throw error;
  }
}

function createTimingLedger(started) {
  return {
    schema: "facebook-ready-publisher-integrated-timing-v1",
    startedAt: started.toISOString(),
    status: "running",
    phases: [],
    vehicles: {},
  };
}

function buildSkippedVehicles(classifications) {
  return {
    schema: "facebook-ready-publisher-skipped-vehicles-v1",
    generatedAt: new Date().toISOString(),
    alreadyLive: (classifications.alreadyLive || []).map((vehicle) => ({ ...vehicle, skipReason: "already-live-on-facebook" })),
    priceUpdateCandidate: (classifications.priceUpdateCandidate || []).map((vehicle) => ({
      ...vehicle,
      skipReason: "price-mismatch-update-review-not-new-post",
    })),
    blocked: (classifications.blocked || []).map((vehicle) => ({ ...vehicle, skipReason: vehicle.classificationReason || "blocked" })),
    needsReview: classifications.needsReview || [],
  };
}

function emptyClassification() {
  return {
    schema: "facebook-ready-publisher-classification-ledger-v1",
    generatedAt: new Date().toISOString(),
    counts: {
      alreadyLiveCount: 0,
      readyToPostCount: 0,
      priceUpdateCandidateCount: 0,
      blockedCount: 0,
      needsReviewCount: 0,
    },
    classifications: {
      alreadyLive: [],
      readyToPost: [],
      priceUpdateCandidate: [],
      blocked: [],
      needsReview: [],
    },
  };
}

function emptyUploadSummary(dryRun) {
  return {
    schema: "facebook-ready-publisher-upload-ready-summary-v1",
    generatedAt: new Date().toISOString(),
    dryRun: Boolean(dryRun),
    prepared: [],
    blocked: [],
  };
}

function getMode(options) {
  if (options.planOnly) return "plan-only";
  if (options.prepOnly) return "prep-only";
  if (options.dryRun || !options.publish) return "dry-run";
  if (options.stopBeforeNext) return "stop-before-next";
  if (options.stopBeforePublish) return "stop-before-publish";
  return "publish";
}

function applyDefaultInputs(options) {
  const currentGalleryRun = readCurrentGalleryRun();
  return {
    ...options,
    inventoryFile: path.resolve(options.inventoryFile || path.join(ROOT, "production-active-gallery-cars-current.json")),
    facebookFile: path.resolve(options.facebookFile || path.join(ROOT, "facebook-selling-full-current.json")),
    publishedResultsFile: resolveOptionalPath(options.publishedResultsFile)
      || (currentGalleryRun ? resolveOptionalPath(path.join(currentGalleryRun, "publish-results.json")) : ""),
    postQueueFile: resolveOptionalPath(options.postQueueFile)
      || (currentGalleryRun ? resolveOptionalPath(path.join(currentGalleryRun, "post-queue.json")) : ""),
    packagesDir: resolveOptionalPath(options.packagesDir)
      || (currentGalleryRun ? resolveOptionalPath(path.join(currentGalleryRun, "packages")) : ""),
    coverOrderFile: resolveOptionalPath(options.coverOrderFile)
      || (currentGalleryRun ? resolveOptionalPath(path.join(currentGalleryRun, "cover-upload-order.json")) : ""),
  };
}

function readCurrentGalleryRun() {
  const pointer = path.join(ROOT, ".current-facebook-gallery-post-run");
  if (!fs.existsSync(pointer)) return "";
  const value = fs.readFileSync(pointer, "utf8").trim();
  if (!value) return "";
  return path.resolve(value);
}

function resolveRunDir(options) {
  if (options.runDir) return path.resolve(options.runDir);
  const stamp = timestampForPath(new Date());
  const artifactRoot = path.resolve(options.artifactRoot || DEFAULT_ARTIFACT_ROOT);
  return path.join(artifactRoot, `facebook-ready-publisher-fast-batch-${stamp}`);
}

function pickInputs(options) {
  return {
    inventoryFile: options.inventoryFile,
    facebookFile: options.facebookFile,
    publishedResultsFile: options.publishedResultsFile || "",
    postQueueFile: options.postQueueFile || "",
    packagesDir: options.packagesDir || "",
    coverOrderFile: options.coverOrderFile || "",
    stocks: options.stocks || "",
    max: options.max || null,
  };
}

function parseStockFilter(value) {
  return new Set(String(value || "").split(",").map((stock) => stock.trim().toUpperCase()).filter(Boolean));
}

function resolveOptionalPath(value) {
  if (!value) return "";
  const resolved = path.resolve(value);
  return fs.existsSync(resolved) ? resolved : "";
}

function timestampForPath(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--fast-batch") options.fastBatch = true;
    else if (arg === "--plan-only") options.planOnly = true;
    else if (arg === "--prep-only") options.prepOnly = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--stop-before-next") options.stopBeforeNext = true;
    else if (arg === "--stop-before-publish") options.stopBeforePublish = true;
    else if (arg === "--publish") options.publish = true;
    else if (arg === "--stocks") options.stocks = argv[++index];
    else if (arg === "--max") options.max = positiveInteger(argv[++index], "--max");
    else if (arg === "--run-dir") options.runDir = argv[++index];
    else if (arg === "--artifact-root") options.artifactRoot = argv[++index];
    else if (arg === "--inventory-file") options.inventoryFile = argv[++index];
    else if (arg === "--facebook-file") options.facebookFile = argv[++index];
    else if (arg === "--published-results-file") options.publishedResultsFile = argv[++index];
    else if (arg === "--post-queue-file") options.postQueueFile = argv[++index];
    else if (arg === "--packages-dir") options.packagesDir = argv[++index];
    else if (arg === "--cover-order-file") options.coverOrderFile = argv[++index];
    else if (arg === "--min-photos") options.minPhotos = positiveInteger(argv[++index], "--min-photos");
    else if (arg === "--near-price-threshold") options.nearPriceThreshold = positiveInteger(argv[++index], "--near-price-threshold");
    else if (arg === "--allowed-dealerships") options.allowedDealerships = argv[++index];
    else if (arg === "--allow-first-image-cover") options.allowFirstImageCover = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.planOnly && options.prepOnly) throw new Error("--plan-only and --prep-only are mutually exclusive.");
  return options;
}

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer.`);
  return parsed;
}

function requireReadable(filePath, label) {
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`Missing readable ${label}: ${filePath || ""}`);
  }
}

function requireDirectory(dirPath, label) {
  if (!dirPath || !fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    throw new Error(`Missing directory ${label}: ${dirPath || ""}`);
  }
}

function parseMaybeJson(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function printHelp() {
  console.log(`Usage:
  node scripts/facebook_ready_publisher.mjs --dry-run
  node scripts/facebook_ready_publisher.mjs --plan-only
  node scripts/facebook_ready_publisher.mjs --prep-only --post-queue-file <post-queue.json> --packages-dir <dir> --cover-order-file <cover-upload-order.json>
  node scripts/facebook_ready_publisher.mjs --publish --stocks STOCK1,STOCK2 --max 1

Fast-batch inputs:
  --inventory-file <production-active-gallery-cars.json>
  --facebook-file <facebook-selling-full.json>
  --published-results-file <publish-results.json>
  --packages-dir <dir>
  --cover-order-file <cover-upload-order.json>

Safe modes:
  --plan-only              Run one candidate/live classification pass, then stop.
  --prep-only              Run upload-ready package prep from a queue, then stop.
  --dry-run                Write reports and plans only; no browser or production mutations.
  --stop-before-next       Prepare for browser flow but never click Next or Publish.
  --stop-before-publish    Allow pre-publish verification flow but never click Publish.
  --publish                Required before any browser publish action is allowed.
  --stocks STOCK1,STOCK2   Limit ready-to-post vehicles by stock.
  --max N                  Limit ready-to-post vehicles.

Default behavior:
  Without --publish, the publish gate reports missing --publish and willClickPublish=false.
  Marker/status repair is deferred until after final live verification and is never run in dry-run.
`);
}
