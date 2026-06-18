import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  assertPostPublishEditVerificationAllowed,
  extractFacebookVehicleFormFields,
  validatePostPublishEditSnapshotText,
} from "../scripts/facebook_ready_publisher_browser_executor.mjs";

const ROOT = process.cwd();
const FAST_BATCH_SCRIPT = path.join(ROOT, "scripts/facebook_ready_publisher_fast_batch.mjs");
const PUBLISHER_SCRIPT = path.join(ROOT, "scripts/facebook_ready_publisher.mjs");
const FIXTURE_RUN = path.join(ROOT, "automation-runs/facebook-gallery-post-20260617T093505Z");
const INVENTORY_FILE = path.join(ROOT, "production-active-gallery-cars-current.json");
const FACEBOOK_FILE = path.join(ROOT, "facebook-selling-full-current.json");
const PUBLISH_RESULTS = path.join(FIXTURE_RUN, "publish-results.json");
const FINAL_VERIFICATION = path.join(FIXTURE_RUN, "final-facebook-selling-verification.json");
const COVER_ORDER = path.join(FIXTURE_RUN, "cover-upload-order.json");
const POST_QUEUE = path.join(FIXTURE_RUN, "post-queue.json");
const PACKAGES_DIR = path.join(FIXTURE_RUN, "packages");
const PROOFS_DIR = path.join(FIXTURE_RUN, "proofs");
const TEST_ROOT = path.join(ROOT, "automation-runs/facebook-ready-publisher-fast-batch-test");

const fixturesAvailable = [
  FAST_BATCH_SCRIPT,
  PUBLISHER_SCRIPT,
  INVENTORY_FILE,
  FACEBOOK_FILE,
  PUBLISH_RESULTS,
  FINAL_VERIFICATION,
  COVER_ORDER,
  POST_QUEUE,
  PACKAGES_DIR,
  PROOFS_DIR,
].every((item) => fs.existsSync(item));

test("fast-batch helper classifies the current gallery state", {
  skip: fixturesAvailable ? false : "missing facebook-ready-publisher fixture artifacts",
}, () => {
  const runDir = freshRunDir("plan");
  execNode(FAST_BATCH_SCRIPT, [
    "plan",
    "--run-dir", runDir,
    "--inventory-file", INVENTORY_FILE,
    "--facebook-file", FACEBOOK_FILE,
    "--published-results-file", PUBLISH_RESULTS,
  ]);

  const plan = readJson(path.join(runDir, "fast-batch-plan.json"));
  assert.equal(plan.summary.candidateCount, 34);
  assert.equal(plan.summary.readyToPostCount, 0);
  assert.equal(plan.summary.alreadyLiveCount, 31);
  assert.equal(plan.summary.alreadyLiveButNeedsUpdateCount, 2);
  assert.equal(plan.summary.manualReviewCount, 1);
  assert.deepEqual(
    plan.alreadyLiveButNeedsUpdate.map((vehicle) => vehicle.stock).sort(),
    ["U6560", "U6570"],
  );
  assert.deepEqual(
    plan.manualReview.map((vehicle) => vehicle.stock),
    ["U6584"],
  );
});

test("integrated publisher dry-run gates publishing and skips already-live vehicles", {
  skip: fixturesAvailable ? false : "missing facebook-ready-publisher fixture artifacts",
}, () => {
  const runDir = freshRunDir("integrated-dry-run");
  execNode(PUBLISHER_SCRIPT, [
    "--dry-run",
    "--run-dir", runDir,
    "--inventory-file", INVENTORY_FILE,
    "--facebook-file", FACEBOOK_FILE,
    "--published-results-file", PUBLISH_RESULTS,
    "--packages-dir", PACKAGES_DIR,
    "--cover-order-file", COVER_ORDER,
  ]);

  const report = readJson(path.join(runDir, "integrated-dry-run-report.json"));
  const classifications = readJson(path.join(runDir, "classification-ledger.json"));
  const priceUpdates = readJson(path.join(runDir, "price-update-candidates.json"));
  const skipped = readJson(path.join(runDir, "skipped-vehicles.json"));

  assert.equal(report.publishGate.publishEnabled, false);
  assert.equal(report.publishGate.willClickPublish, false);
  assert.equal(report.publishGate.publishImpossibleWithoutFlag, true);
  assert.equal(report.publishGate.reason, "missing --publish");
  assert.equal(report.summary.readyToPostCount, 0);
  assert.equal(report.summary.alreadyLiveCount, 31);
  assert.equal(report.summary.priceUpdateCandidateCount, 2);
  assert.equal(report.summary.publishedCount, 0);
  assert.equal(report.summary.productionMutations, 0);
  assert.equal(classifications.classifications.readyToPost.length, 0);
  assert.equal(skipped.alreadyLive.length, 31);
  assert.deepEqual(priceUpdates.map((vehicle) => vehicle.stock).sort(), ["U6560", "U6570"]);
});

test("package prep dry-run validates the successful 10-car upload packages", {
  skip: fixturesAvailable ? false : "missing facebook-ready-publisher fixture artifacts",
}, () => {
  const runDir = freshRunDir("prep-dry-run");
  execNode(FAST_BATCH_SCRIPT, [
    "prep-packages",
    "--dry-run",
    "--run-dir", runDir,
    "--post-queue-file", POST_QUEUE,
    "--packages-dir", PACKAGES_DIR,
    "--cover-order-file", COVER_ORDER,
  ]);

  const summary = readJson(path.join(runDir, "upload-ready-summary.json"));
  assert.equal(summary.dryRun, true);
  assert.equal(summary.prepared.length, 10);
  assert.equal(summary.blocked.length, 0);
  assert.ok(summary.prepared.every((item) => item.photoCount > 0));
  assert.ok(summary.prepared.every((item) => item.firstUploadFile.startsWith("01-")));
});

test("successful 10-car proof artifacts preserve upload and verification patterns", {
  skip: fixturesAvailable ? false : "missing facebook-ready-publisher fixture artifacts",
}, () => {
  const publishResults = readJson(PUBLISH_RESULTS);
  const finalVerification = readJson(FINAL_VERIFICATION);
  const coverOrder = readJson(COVER_ORDER);
  const proofFiles = fs.readdirSync(PROOFS_DIR);
  const uploadPlans = proofFiles.filter((file) => file.endsWith("-photo-upload-plan.json"));
  const preNextSnapshots = proofFiles.filter((file) => file.endsWith("-pre-next-snapshot.txt"));

  assert.equal(publishResults.length, 10);
  assert.ok(publishResults.every((vehicle) => vehicle.published === true));
  assert.equal(finalVerification.targets.length, 10);
  assert.ok(finalVerification.targets.every((target) => (
    target.titlePresent && target.pricePresent && target.activePresentNearPage
  )));
  assert.equal(coverOrder.length, 10);
  assert.ok(coverOrder.every((item) => item.firstUploadFile.startsWith("01-")));
  assert.equal(uploadPlans.length, 10);
  assert.ok(preNextSnapshots.length >= 9);

  for (const file of uploadPlans) {
    const plan = readJson(path.join(PROOFS_DIR, file));
    assert.equal(plan.uploadScope, "inventory-package-photos-only");
    assert.equal(plan.photoPaths.length, plan.photoCount);
    assert.ok(plan.photoPaths.every((photoPath) => photoPath.includes("facebook-upload-photos")));
  }

  for (const file of preNextSnapshots) {
    const snapshot = fs.readFileSync(path.join(PROOFS_DIR, file), "utf8");
    assert.match(snapshot, /Konner John/);
    assert.match(snapshot, /Photos[\s\S]*\d+ \/ 20/);
  }
});

test("post-publish edit verification blocks Facebook numeric model ID leaks", () => {
  const snapshot = `
    - generic: About this vehicle
    - generic: Location
    - combobox "Location": Halifax
    - combobox "Year":
      - generic: Year
      - generic: "2025"
    - combobox "Make":
      - generic: Make
      - generic: Volkswagen
    - generic: Model
    - textbox "Model": "585892855224515"
    - generic: Mileage
    - textbox "Mileage": "51885"
    - generic: Price
    - textbox "Price": CA$28,990
    - combobox "Body style":
      - generic: Body style
      - generic: Sedan
    - combobox "Fuel type":
      - generic: Fuel type
      - generic: Gasoline
    - combobox "Transmission":
      - generic: Transmission
      - generic: Automatic transmission
  `;

  const fields = extractFacebookVehicleFormFields(snapshot);
  assert.equal(fields.make, "Volkswagen");
  assert.equal(fields.model, "585892855224515");

  const verification = validatePostPublishEditSnapshotText(snapshot, {
    year: 2025,
    make: "Volkswagen",
    model: "Jetta",
    mileage: 51885,
    price: 28990,
    bodyStyle: "Sedan",
    fuelType: "Gasoline",
    transmission: "Automatic transmission",
  });

  assert.equal(verification.ok, false);
  assert.equal(verification.numericIdLeaks.model, true);
  assert.ok(verification.issues.some((issue) => issue.reason === "numeric-facebook-model-id"));
  assert.throws(
    () => assertPostPublishEditVerificationAllowed(verification),
    /numeric-facebook-model-id/,
  );
});

test("post-publish edit verification accepts readable Make and Model values", () => {
  const snapshot = `
    - generic: About this vehicle
    - generic: Location
    - combobox "Location": Halifax
    - combobox "Year":
      - generic: Year
      - generic: "2025"
    - combobox "Make":
      - generic: Make
      - generic: Volkswagen
    - generic: Model
    - textbox "Model": "Jetta"
    - generic: Mileage
    - textbox "Mileage": "51885"
    - generic: Price
    - textbox "Price": CA$28,990
    - combobox "Body style":
      - generic: Body style
      - generic: Sedan
    - combobox "Fuel type":
      - generic: Fuel type
      - generic: Gasoline
    - combobox "Transmission":
      - generic: Transmission
      - generic: Automatic transmission
  `;
  const verification = validatePostPublishEditSnapshotText(snapshot, {
    year: 2025,
    make: "Volkswagen",
    model: "Jetta",
    mileage: 51885,
    price: 28990,
    bodyStyle: "Sedan",
    fuelType: "Gasoline",
    transmission: "Automatic transmission",
  });

  assert.equal(verification.fields.model, "Jetta");
  assert.equal(verification.numericIdLeaks.model, false);
  assert.equal(verification.ok, true);
  assert.doesNotThrow(() => assertPostPublishEditVerificationAllowed(verification));
});

function freshRunDir(name) {
  const dir = path.join(TEST_ROOT, `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.rmSync(dir, { force: true, recursive: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function execNode(script, args) {
  return childProcess.execFileSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
