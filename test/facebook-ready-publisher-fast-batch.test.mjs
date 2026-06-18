import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
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

test("package prep confines traversal-like stock values inside the run directory", () => {
  const root = freshTempRoot("containment");
  const runDir = path.join(root, "run");
  const packagesDir = path.join(root, "packages");
  fs.mkdirSync(packagesDir, { recursive: true });

  const outsidePackage = path.join(root, "outside-upload-package");
  const sentinel = path.join(outsidePackage, "sentinel.txt");
  fs.mkdirSync(outsidePackage, { recursive: true });
  fs.writeFileSync(sentinel, "outside must survive\n");

  writeStoredZip(path.join(packagesDir, "outside.zip"), {
    "package-manifest.json": JSON.stringify({ stock: "../../outside" }),
    "facebook-marketplace-fields.json": JSON.stringify({ title: "Traversal Test", price: "CA$1" }),
    "facebook-marketplace-description.txt": "Traversal Test",
    "media/front.jpg": "fake-jpeg-front",
    "media/second.jpg": "fake-jpeg-second",
  });

  const queueFile = path.join(root, "queue.json");
  const coverFile = path.join(root, "covers.json");
  writeJson(queueFile, [
    {
      stock: "../../outside",
      albumId: "album-1",
      title: "Traversal Test",
      price: 1,
      raw: { stock: "../../outside" },
    },
  ]);
  writeJson(coverFile, [{ stock: "../../outside", chosenCover: "front.jpg" }]);

  execNode(FAST_BATCH_SCRIPT, [
    "prep-packages",
    "--run-dir", runDir,
    "--post-queue-file", queueFile,
    "--packages-dir", packagesDir,
    "--cover-order-file", coverFile,
  ]);

  const summary = readJson(path.join(runDir, "upload-ready-summary.json"));
  assert.equal(summary.prepared.length, 1);
  assert.equal(summary.blocked.length, 0);
  assert.equal(fs.readFileSync(sentinel, "utf8"), "outside must survive\n");

  const uploadRoot = path.join(runDir, "upload-ready");
  const uploadPackageRoot = summary.prepared[0].uploadPackageRoot;
  assert.ok(uploadPackageRoot.startsWith(`${uploadRoot}${path.sep}`));
  assert.doesNotMatch(path.relative(uploadRoot, uploadPackageRoot), /(^|[\\/])\.\.($|[\\/])/);
  assert.ok(fs.existsSync(path.join(uploadPackageRoot, "facebook-upload-photos", "01-front.jpg")));
});

test("package prep rejects ZIP entries that would escape extraction root", () => {
  const root = freshTempRoot("unsafe-zip");
  const runDir = path.join(root, "run");
  const packagesDir = path.join(root, "packages");
  fs.mkdirSync(packagesDir, { recursive: true });

  const outsideDir = path.join(root, "outside");
  const sentinel = path.join(outsideDir, "sentinel.jpg");
  fs.mkdirSync(outsideDir, { recursive: true });
  fs.writeFileSync(sentinel, "safe original\n");

  writeStoredZip(path.join(packagesDir, "BAD.zip"), {
    "../outside/sentinel.jpg": "bad overwrite",
    "media/front.jpg": "fake-jpeg-front",
  });

  const queueFile = path.join(root, "queue.json");
  writeJson(queueFile, [{ stock: "BAD", title: "Bad Zip", price: 1 }]);

  execNode(FAST_BATCH_SCRIPT, [
    "prep-packages",
    "--run-dir", runDir,
    "--post-queue-file", queueFile,
    "--packages-dir", packagesDir,
    "--allow-first-image-cover",
  ]);

  const summary = readJson(path.join(runDir, "upload-ready-summary.json"));
  assert.equal(summary.prepared.length, 0);
  assert.equal(summary.blocked.length, 1);
  assert.match(summary.blocked[0].message, /Unsafe ZIP entry/);
  assert.equal(fs.readFileSync(sentinel, "utf8"), "safe original\n");
});

test("exact title and price Facebook matches consume one listing row only once", () => {
  const root = freshTempRoot("exact-consume");
  const plan = runFastBatchPlan(root, {
    inventory: [
      eligibleInventory({ stock: "EXACT-1", vin: "VINEXACT1", price: 29990 }),
      eligibleInventory({ stock: "EXACT-2", vin: "VINEXACT2", price: 29990 }),
    ],
    facebook: [
      {
        title: "2025 Kia Sorento",
        price: 29990,
        listingId: "fb-exact-1",
        url: "https://facebook.test/marketplace/item/exact-1",
      },
    ],
  });

  assert.equal(plan.summary.alreadyLiveCount, 1);
  assert.equal(plan.summary.manualReviewCount, 1);
  assert.equal(plan.summary.readyToPostCount, 0);
  assert.equal(plan.alreadyLive[0].match.type, "exact-title-price");
  assert.equal(plan.alreadyLive[0].match.listingId, "fb-exact-1");
  assert.equal(plan.manualReview[0].reason, "duplicate-inventory-title-without-live-exact-price");
});

test("duplicate inventory titles with near-price Facebook evidence go to manual review", () => {
  const root = freshTempRoot("near-duplicate");
  const plan = runFastBatchPlan(root, {
    inventory: [
      eligibleInventory({ stock: "NEAR-1", vin: "VINNEAR1", price: 30000 }),
      eligibleInventory({ stock: "NEAR-2", vin: "VINNEAR2", price: 30200 }),
    ],
    facebook: [
      {
        title: "2025 Kia Sorento",
        price: 30500,
        listingId: "fb-near-1",
        url: "https://facebook.test/marketplace/item/near-1",
      },
    ],
  });

  assert.equal(plan.summary.alreadyLiveButNeedsUpdateCount, 0);
  assert.equal(plan.summary.readyToPostCount, 0);
  assert.equal(plan.summary.manualReviewCount, 2);
  assert.deepEqual(
    plan.manualReview.map((vehicle) => vehicle.reason),
    ["ambiguous-near-price-duplicate-title", "ambiguous-near-price-duplicate-title"],
  );
});

test("Facebook evidence deduplicates stale published rows behind fresh live sweep rows", () => {
  const root = freshTempRoot("dedupe-evidence");
  const plan = runFastBatchPlan(root, {
    inventory: [
      eligibleInventory({
        stock: "DEDUP-1",
        vin: "VINDEDUP1",
        year: 2025,
        make: "Kia",
        model: "K4",
        price: 26000,
      }),
    ],
    facebook: [
      {
        source: "facebook-live-sweep",
        title: "2025 Kia K4",
        price: 26000,
        listingId: "fb-dedupe-1",
        url: "https://facebook.test/marketplace/item/dedupe-1?ref=feed",
      },
      {
        source: "facebook-live-sweep",
        title: "2025 Kia K4",
        price: 26000,
        listingId: "fb-dedupe-1",
        url: "https://facebook.test/marketplace/item/dedupe-1?ref=duplicate",
      },
    ],
    published: [
      {
        published: true,
        title: "2025 Kia K4",
        price: 26000,
        listingId: "fb-dedupe-1",
        url: "https://facebook.test/marketplace/item/dedupe-1",
      },
    ],
  });

  assert.equal(plan.summary.facebookActiveCount, 1);
  assert.equal(plan.summary.alreadyLiveCount, 1);
  assert.equal(plan.alreadyLive[0].match.source, "facebook-live-sweep");
});

test("candidate eligibility fails closed for missing or disallowed readiness fields", () => {
  const root = freshTempRoot("eligibility");
  const plan = runFastBatchPlan(root, {
    inventory: [
      eligibleInventory({ stock: "READY-1", vin: "VINREADY1", model: "K4" }),
      eligibleInventory({ stock: "MISS-SOURCE", vin: "VINMISSOURCE", model: "Sportage", sourceActive: undefined }),
      eligibleInventory({ stock: "MISS-TYPE", vin: "VINMISSTYPE", model: "Telluride", inventoryTypeId: undefined }),
      eligibleInventory({ stock: "MISS-DEALER", vin: "VINMISSDEALER", model: "Carnival", dealershipName: undefined }),
      eligibleInventory({ stock: "BAD-DEALER", vin: "VINBADDEALER", model: "Seltos", dealershipName: "Other Dealer" }),
      eligibleInventory({ stock: "MISS-MEDIA", vin: "VINMISSMEDIA", model: "Forte", mediaCount: undefined }),
      eligibleInventory({ stock: "MISS-FB", vin: "VINMISSFB", model: "Niro", facebookReadyForPosting: undefined }),
    ],
    facebook: [],
    extraArgs: ["--allowed-dealerships", "O'Regan's Kia Halifax"],
  });

  assert.equal(plan.summary.readyToPostCount, 1);
  assert.equal(plan.summary.manualReviewCount, 6);
  assert.deepEqual(plan.readyToPost.map((vehicle) => vehicle.stock), ["READY-1"]);

  const reasonsByStock = new Map(plan.manualReview.map((vehicle) => [vehicle.stock, vehicle.eligibilityReasons]));
  assert.ok(reasonsByStock.get("MISS-SOURCE").includes("source-active-uncertain"));
  assert.ok(reasonsByStock.get("MISS-TYPE").includes("inventory-type-uncertain"));
  assert.ok(reasonsByStock.get("MISS-DEALER").includes("dealership-uncertain"));
  assert.ok(reasonsByStock.get("BAD-DEALER").includes("dealership-disallowed"));
  assert.ok(reasonsByStock.get("MISS-MEDIA").includes("media-readiness-uncertain"));
  assert.ok(reasonsByStock.get("MISS-FB").includes("facebook-readiness-uncertain"));
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

function freshTempRoot(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `cpc2-${name}-`));
}

function eligibleInventory(overrides = {}) {
  return {
    stock: "STOCK-1",
    vin: "VINSTOCK1",
    year: 2025,
    make: "Kia",
    model: "Sorento",
    price: 30000,
    mediaCount: 6,
    dealershipName: "O'Regan's Kia Halifax",
    inventoryTypeId: "2",
    sourceActive: true,
    facebookReadyForPosting: true,
    ...overrides,
  };
}

function runFastBatchPlan(root, { inventory, facebook, published = [], extraArgs = [] }) {
  const runDir = path.join(root, "run");
  const inventoryFile = path.join(root, "inventory.json");
  const facebookFile = path.join(root, "facebook.json");
  const publishedFile = path.join(root, "published.json");
  writeJson(inventoryFile, inventory);
  writeJson(facebookFile, facebook);
  writeJson(publishedFile, published);

  const args = [
    "plan",
    "--run-dir", runDir,
    "--inventory-file", inventoryFile,
    "--facebook-file", facebookFile,
    "--published-results-file", publishedFile,
    ...extraArgs,
  ];
  execNode(FAST_BATCH_SCRIPT, args);
  return readJson(path.join(runDir, "fast-batch-plan.json"));
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

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeStoredZip(zipPath, entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const [entryName, body] of Object.entries(entries)) {
    const nameBuffer = Buffer.from(entryName);
    const bodyBuffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    const crc = crc32(bodyBuffer);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(bodyBuffer.length, 18);
    localHeader.writeUInt32LE(bodyBuffer.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuffer, bodyBuffer);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(bodyBuffer.length, 20);
    centralHeader.writeUInt32LE(bodyBuffer.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuffer);

    offset += localHeader.length + nameBuffer.length + bodyBuffer.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  fs.writeFileSync(zipPath, Buffer.concat([...localParts, centralDir, end]));
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC32_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  return value >>> 0;
});
