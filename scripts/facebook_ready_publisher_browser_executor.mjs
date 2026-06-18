const DEFAULT_SELLER_NAME = "Konner John";
const DEFAULT_PHOTO_LIMIT = 20;
const KNOWN_MAKE_NAMES = [
  "Buick",
  "Chevrolet",
  "GMC",
  "Hyundai",
  "Infiniti",
  "Kia",
  "Lexus",
  "Mercedes-Benz",
  "MINI",
  "Mitsubishi",
  "Nissan",
  "Toyota",
  "Volkswagen",
  "Volvo",
];

export const FAST_BROWSER_METHOD = Object.freeze({
  schema: "facebook-ready-publisher-browser-executor-patterns-v1",
  patterns: [
    "seller wait for Konner John before any upload or publish action",
    "Chrome/Playwright direct filechooser.setFiles(photoPaths)",
    "cover-first facebook-upload-photos folders only",
    "exact Photos N / 20 counter wait after upload",
    "stable role locators for buttons, forms, comboboxes, and listboxes",
    "scoped combobox/listbox option selection from Select an option popovers",
    "strict body-style readback from the Facebook Body style combobox",
    "duplicate make/model preview check before Next",
    "pre-Next DOM snapshot verification",
    "post-publish edit-form readback blocks numeric Facebook Make/Model IDs",
    "post-publish live selling-page verification",
    "final selling-page sweep before marker/status repair",
  ],
});

export function createPublishGate(options = {}) {
  const publishEnabled = Boolean(options.publish);
  const dryRun = Boolean(options.dryRun);
  const stopBeforeNext = Boolean(options.stopBeforeNext);
  const stopBeforePublish = Boolean(options.stopBeforePublish || stopBeforeNext);
  const canOpenBrowser = publishEnabled && !dryRun;
  const canClickNext = canOpenBrowser && !stopBeforeNext;
  const canClickPublish = canClickNext && !stopBeforePublish;
  const reason = publishEnabled
    ? (dryRun && "dry-run")
      || (stopBeforeNext && "stop-before-next")
      || (stopBeforePublish && "stop-before-publish")
      || "publish-enabled"
    : "missing --publish";

  return {
    schema: "facebook-ready-publisher-publish-gate-v1",
    publishEnabled,
    dryRun,
    stopBeforeNext,
    stopBeforePublish,
    canOpenBrowser,
    canClickNext,
    canClickPublish,
    willClickPublish: canClickPublish,
    publishImpossibleWithoutFlag: !publishEnabled,
    reason,
  };
}

export function assertPublishClickAllowed(gate, verification = {}) {
  if (!gate?.canClickPublish) {
    throw new Error(`Publish click blocked by gate: ${gate?.reason || "unknown"}`);
  }
  if (!verification.preNextSnapshotVerified) {
    throw new Error("Publish click blocked: pre-Next DOM snapshot was not verified.");
  }
  if (!verification.photoCounterVerified) {
    throw new Error("Publish click blocked: exact Facebook photo counter was not verified.");
  }
  if (!verification.bodyStyleVerified) {
    throw new Error("Publish click blocked: body style readback was not verified.");
  }
  if (verification.duplicatePreviewBlocked) {
    throw new Error("Publish click blocked: duplicate make/model preview check failed.");
  }
}

export function assertPostPublishEditVerificationAllowed(verification = {}) {
  if (verification.ok) return;
  const issueSummary = (verification.issues || [])
    .map((issue) => `${issue.field || issue.name}: ${issue.reason}`)
    .join("; ");
  throw new Error(`Post-publish verification blocked marker repair: ${issueSummary || "edit form was not verified"}`);
}

export function buildDryRunPostingPlan(vehicles, uploadSummary, gate) {
  const uploadByStock = new Map((uploadSummary?.prepared || []).map((item) => [item.stock, item]));
  return {
    schema: "facebook-ready-publisher-posting-loop-plan-v1",
    generatedAt: new Date().toISOString(),
    publishGate: gate,
    executorPatterns: FAST_BROWSER_METHOD.patterns,
    vehicles: vehicles.map((vehicle) => {
      const upload = uploadByStock.get(vehicle.stock);
      return {
        stock: vehicle.stock,
        vin: vehicle.vin || "",
        title: vehicle.title,
        price: vehicle.price,
        photoCount: upload?.photoCount ?? vehicle.mediaCount ?? null,
        uploadPackageRoot: upload?.uploadPackageRoot || "",
        blockedBeforeBrowser: !gate.canOpenBrowser,
        browserAction: gate.canOpenBrowser ? "ready-for-browser-loop" : "skipped-publish-disabled",
        steps: [
          { name: "sellerWait", method: `wait for ${DEFAULT_SELLER_NAME}` },
          { name: "photoUpload", method: "filechooser.setFiles(photoPaths)" },
          { name: "photoCounter", method: "wait for exact Photos N / 20 counter" },
          { name: "formFill", method: "role locators and scoped combobox/listbox selections" },
          { name: "preNextVerification", method: "DOM snapshot readback before Next" },
          {
            name: "publish",
            method: "click Publish only when publish gate and pre-publish checks pass",
            willClick: gate.canClickPublish,
          },
          {
            name: "postPublishEditVerification",
            method: "open the real edit listing id and read back Year, Make, Model, Mileage, Price, and Body style",
            blocksMarkerRepair: true,
          },
          {
            name: "modelIdLeakGuard",
            method: "block completion if Facebook shows an all-digit Make or Model value in the edit form",
            blocksMarkerRepair: true,
          },
        ],
      };
    }),
  };
}

export function buildPerVehicleDryRunTimings(vehicles, gate) {
  const timings = {};
  for (const vehicle of vehicles) {
    timings[vehicle.stock || vehicle.albumId || vehicle.title] = {
      photoUpload: skippedVehicleTiming(gate),
      formFill: skippedVehicleTiming(gate),
      preNextVerification: skippedVehicleTiming(gate),
      publish: skippedVehicleTiming(gate),
      postPublishEditVerification: skippedVehicleTiming(gate),
    };
  }
  return timings;
}

export function expectedPhotoCounter(photoCount, limit = DEFAULT_PHOTO_LIMIT) {
  return `${photoCount} / ${limit}`;
}

export function validatePreNextSnapshotText(snapshotText, expected = {}) {
  const text = String(snapshotText || "");
  const missing = [];
  const checks = [];

  addTextCheck(checks, missing, "seller", text, expected.sellerName || DEFAULT_SELLER_NAME);
  addTextCheck(checks, missing, "title", text, expected.title);
  addTextCheck(checks, missing, "price", text, expected.price);
  addTextCheck(checks, missing, "bodyStyle", text, expected.bodyStyle);
  if (expected.photoCount) {
    addTextCheck(checks, missing, "photoCounter", text, expectedPhotoCounter(expected.photoCount));
  }

  const duplicatePreview = detectDuplicateMakeModelPreview(text, expected.title);
  return {
    ok: missing.length === 0 && !duplicatePreview.blocked,
    missing,
    checks,
    duplicatePreview,
    photoCounterVerified: !expected.photoCount || !missing.includes("photoCounter"),
    bodyStyleVerified: !expected.bodyStyle || !missing.includes("bodyStyle"),
    preNextSnapshotVerified: missing.length === 0 && !duplicatePreview.blocked,
  };
}

const FACEBOOK_VEHICLE_FORM_FIELD_LABELS = [
  "Location",
  "Year",
  "Make",
  "Model",
  "Mileage",
  "Price",
  "Body style",
  "Exterior color",
  "Interior color",
  "Vehicle condition",
  "Fuel type",
  "Transmission",
];
const FACEBOOK_VEHICLE_FORM_LABEL_SET = new Set(FACEBOOK_VEHICLE_FORM_FIELD_LABELS);

export function extractFacebookVehicleFormFields(snapshotText = "") {
  const lines = String(snapshotText || "").split("\n");
  const fields = {};
  for (const label of FACEBOOK_VEHICLE_FORM_FIELD_LABELS) {
    fields[fieldKey(label)] = extractSnapshotField(lines, label);
  }
  return fields;
}

export function validatePostPublishEditSnapshotText(snapshotText, expected = {}) {
  const fields = extractFacebookVehicleFormFields(snapshotText);
  const checks = [];
  const issues = [];

  addExpectedFieldCheck(checks, issues, fields, expected, "year", digitsOnly);
  addExpectedFieldCheck(checks, issues, fields, expected, "make", normalizeText);
  addExpectedFieldCheck(checks, issues, fields, expected, "model", normalizeText);
  addExpectedFieldCheck(checks, issues, fields, expected, "mileage", digitsOnly);
  addExpectedFieldCheck(checks, issues, fields, expected, "price", digitsOnly);
  addExpectedFieldCheck(checks, issues, fields, expected, "bodyStyle", normalizeText);
  addExpectedFieldCheck(checks, issues, fields, expected, "fuelType", normalizeText);
  addExpectedFieldCheck(checks, issues, fields, expected, "transmission", normalizeText);

  addNumericIdLeakIssue(issues, fields, "make");
  addNumericIdLeakIssue(issues, fields, "model");

  return {
    schema: "facebook-ready-publisher-post-publish-edit-verification-v1",
    ok: issues.length === 0,
    fields,
    checks,
    issues,
    numericIdLeaks: {
      make: isLongNumericId(fields.make),
      model: isLongNumericId(fields.model),
    },
    postPublishEditVerified: issues.length === 0,
    requiresRepairBeforeMarker: issues.length > 0,
  };
}

export async function waitForSellerIdentity(page, sellerName = DEFAULT_SELLER_NAME, timeout = 30000) {
  if (!page?.getByText) throw new Error("waitForSellerIdentity requires a Playwright-like page.");
  await page.getByText(sellerName, { exact: true }).waitFor({ timeout });
}

export async function uploadPhotosWithDirectFileChooser({
  page,
  addPhotoLocator,
  photoPaths,
  expectedCount = photoPaths?.length,
  timeout = 90000,
}) {
  if (!page?.waitForEvent) throw new Error("uploadPhotosWithDirectFileChooser requires a Playwright-like page.");
  if (!addPhotoLocator?.click) throw new Error("uploadPhotosWithDirectFileChooser requires an Add photo locator.");
  if (!Array.isArray(photoPaths) || !photoPaths.length) throw new Error("No photo paths supplied for direct upload.");

  const chooserPromise = page.waitForEvent("filechooser", { timeout });
  await addPhotoLocator.click();
  const fileChooser = await chooserPromise;
  await fileChooser.setFiles(photoPaths);
  await waitForExactPhotoCounter(page, expectedCount, timeout);
}

export async function waitForExactPhotoCounter(page, expectedCount, timeout = 90000) {
  if (!page?.getByText) throw new Error("waitForExactPhotoCounter requires a Playwright-like page.");
  await page.getByText(expectedPhotoCounter(expectedCount), { exact: true }).waitFor({ timeout });
}

export async function selectScopedComboboxOption(page, { label, optionText, timeout = 30000 }) {
  if (!page?.getByRole) throw new Error("selectScopedComboboxOption requires a Playwright-like page.");
  const combo = page.getByRole("combobox", { name: label });
  await combo.click();
  const option = page.getByRole("option", { name: optionText, exact: true });
  await option.waitFor({ timeout });
  await option.click();
  await combo.filter({ hasText: optionText }).waitFor({ timeout });
}

export function detectDuplicateMakeModelPreview(snapshotText, intendedTitle = "") {
  const normalizedSnapshot = normalizeText(snapshotText);
  const normalizedTitle = normalizeText(intendedTitle);
  const make = KNOWN_MAKE_NAMES.find((candidate) => normalizedTitle.includes(normalizeText(candidate)));
  if (!make) return { blocked: false, reason: "no-known-make-in-title" };

  const normalizedMake = normalizeText(make);
  const repeatedMake = new RegExp(`\\b${escapeRegExp(normalizedMake)}\\s+${escapeRegExp(normalizedMake)}\\b`, "i");
  const blocked = repeatedMake.test(normalizedSnapshot);
  return {
    blocked,
    make,
    reason: blocked ? "duplicate-make-in-preview" : "ok",
  };
}

function addTextCheck(checks, missing, name, haystack, needle) {
  if (!needle) return;
  const ok = normalizeText(haystack).includes(normalizeText(needle));
  checks.push({ name, expected: needle, ok });
  if (!ok) missing.push(name);
}

function addExpectedFieldCheck(checks, issues, fields, expected, name, normalize) {
  const expectedValue = expected[name];
  if (expectedValue === null || expectedValue === undefined || expectedValue === "") return;

  const actualValue = fields[name];
  const normalizedActual = normalize(actualValue);
  const normalizedExpected = normalize(expectedValue);
  const ok = Boolean(normalizedActual) && normalizedActual === normalizedExpected;
  checks.push({
    field: name,
    expected: String(expectedValue),
    actual: actualValue || "",
    ok,
  });

  if (!ok) {
    issues.push({
      field: name,
      reason: actualValue ? "field-mismatch" : "field-missing",
      expected: String(expectedValue),
      actual: actualValue || "",
    });
  }
}

function addNumericIdLeakIssue(issues, fields, name) {
  if (!isLongNumericId(fields[name])) return;
  issues.push({
    field: name,
    reason: `numeric-facebook-${name}-id`,
    actual: fields[name],
  });
}

function extractSnapshotField(lines, label) {
  const re = new RegExp(`^\\s*- (?:combobox|textbox) "${escapeRegExp(label)}"(?::\\s*(.*))?$`);
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(re);
    if (!match) continue;

    const inlineValue = cleanSnapshotValue(match[1]);
    if (inlineValue) return inlineValue;

    for (let lookahead = index + 1; lookahead < Math.min(lines.length, index + 8); lookahead += 1) {
      const candidate = snapshotGenericValue(lines[lookahead]);
      if (!candidate) continue;
      if (candidate === label) continue;
      if (FACEBOOK_VEHICLE_FORM_LABEL_SET.has(candidate)) break;
      return candidate;
    }
    return "";
  }
  return "";
}

function snapshotGenericValue(line) {
  const match = String(line || "").match(/^\s*- (?:generic|text):\s*(.*)$/);
  if (!match) return "";
  return cleanSnapshotValue(match[1]);
}

function cleanSnapshotValue(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const quoted = text.match(/^"([\s\S]*)"$/);
  return (quoted ? quoted[1] : text).trim();
}

function fieldKey(label) {
  const key = label.replace(/\s+([a-z])/g, (_, char) => char.toUpperCase()).replace(/\s+/g, "");
  return key ? key[0].toLowerCase() + key.slice(1) : "";
}

function skippedVehicleTiming(gate) {
  return {
    elapsedMs: 0,
    ok: true,
    skipped: true,
    reason: gate.canOpenBrowser ? "not-run-in-this-phase" : gate.reason,
  };
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function digitsOnly(value) {
  return String(value || "").replace(/\D+/g, "");
}

function isLongNumericId(value) {
  return /^\d{6,}$/.test(String(value || "").trim());
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
