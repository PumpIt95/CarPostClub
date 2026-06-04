#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import process from "node:process";

const args = parseArgs(process.argv.slice(2));
loadEnvFile(args.envFile);
const baseUrl = new URL(args.baseUrl || "http://127.0.0.1:3911");
const authHeaders = buildAuthHeaders();
const checks = [];

await checkJson("/healthz", {}, (body) => {
  assert(body.ok === true, "healthz ok flag is false");
  assert(body.service === "carpostclub", "healthz service mismatch");
  assert(body.mode === "photo-albums", "healthz mode mismatch");
  if (args.requireReleaseId) {
    assert(body.release?.releaseId === args.requireReleaseId, `healthz release ${body.release?.releaseId || "missing"} did not match ${args.requireReleaseId}`);
  }
});

await checkJson("/api/version", {}, (body) => {
  assert(body.ok === true, "version ok flag is false");
  assert(body.mode === "photo-albums", "version mode mismatch");
  if (args.requireReleaseId) {
    assert(body.release?.releaseId === args.requireReleaseId, `version release ${body.release?.releaseId || "missing"} did not match ${args.requireReleaseId}`);
  }
});

await checkText("/", authHeaders, (body) => {
  assert(body.includes("CarPostClub"), "home page did not contain expected title");
  assert(body.includes("/app.js"), "home page did not reference app.js");
  assert(body.includes("dealershipSelect"), "home page did not include dealership selection");
  assert(body.includes("carSelect"), "home page did not include car selection");
  assert(body.includes("dropZone") && body.includes("disabled"), "upload control should start disabled");
});

await checkJson("/api/albums", authHeaders, (body) => {
  assert(body.ok === true, "albums ok flag is false");
  assert(Array.isArray(body.albums), "albums response did not include albums[]");
  assert(typeof body.uploadRoot === "string" && body.uploadRoot.length > 0, "albums response did not include uploadRoot");
});

await checkJson("/api/inventory/dealerships", authHeaders, (body) => {
  assert(body.ok === true, "dealerships ok flag is false");
  assert(Array.isArray(body.dealerships) && body.dealerships.length > 0, "dealerships response did not include dealerships[]");
  assert(JSON.stringify(body.dealerships.map((dealership) => dealership.id)) === JSON.stringify(["3", "15", "18", "31"]), "dealerships response did not match the upload picklist");
  assert(Array.isArray(body.inventoryTypes) && body.inventoryTypes.length > 0, "dealerships response did not include inventoryTypes[]");
});

await checkJson("/api/inventory/cars?dealershipId=15&inventoryTypeId=2", authHeaders, (body) => {
  assert(body.ok === true, "cars ok flag is false");
  assert(Array.isArray(body.cars), "cars response did not include cars[]");
});

console.log(JSON.stringify({
  ok: true,
  baseUrl: baseUrl.toString(),
  checks,
}, null, 2));

async function checkJson(pathname, headers, validate) {
  const response = await request(pathname, headers);
  const text = await response.text();
  assert(response.ok, `${pathname} returned ${response.status}: ${text.slice(0, 200)}`);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${pathname} did not return JSON: ${text.slice(0, 200)}`);
  }
  validate(body);
  checks.push({ path: pathname, status: response.status, type: "json" });
}

async function checkText(pathname, headers, validate) {
  const response = await request(pathname, headers);
  const text = await response.text();
  assert(response.ok, `${pathname} returned ${response.status}: ${text.slice(0, 200)}`);
  validate(text);
  checks.push({ path: pathname, status: response.status, type: "text" });
}

async function request(pathname, headers) {
  const url = new URL(pathname, baseUrl);
  return fetch(url, {
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(args.timeoutMs || 10000),
  });
}

function buildAuthHeaders() {
  const authEnabled = Boolean(process.env.CARPOSTCLUB_AUTH_PASSWORD_HASH
    || process.env.CARPOSTCLUB_AUTH_PASSWORD
    || process.env.KONNER_AUTH_PASSWORD_HASH
    || process.env.KONNER_AUTH_PASSWORD
    || process.env.AUTH_PASSWORD_HASH
    || process.env.AUTH_PASSWORD);
  if (!authEnabled) return {};

  const secret = process.env.CARPOSTCLUB_AUTH_SESSION_SECRET || process.env.KONNER_AUTH_SESSION_SECRET || process.env.AUTH_SESSION_SECRET || fallbackSessionSecret();
  const username = process.env.CARPOSTCLUB_AUTH_USERNAME || process.env.KONNER_AUTH_USERNAME || "admin";
  const cookieName = process.env.CARPOSTCLUB_AUTH_COOKIE_NAME || process.env.KONNER_AUTH_COOKIE_NAME || "carpostclub_session";
  const maxAgeDays = positiveInteger(process.env.CARPOSTCLUB_AUTH_SESSION_DAYS || process.env.KONNER_AUTH_SESSION_DAYS, 365);
  const payload = {
    v: 1,
    u: username,
    role: "admin",
    pv: bootstrapAdminPasswordVersion(secret),
    iat: Date.now(),
    exp: Date.now() + maxAgeDays * 24 * 60 * 60 * 1000,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(encodedPayload).digest("base64url");
  return {
    Cookie: `${cookieName}=${encodeURIComponent(`${encodedPayload}.${signature}`)}`,
  };
}

function fallbackSessionSecret() {
  return crypto.createHash("sha256")
    .update(process.env.CARPOSTCLUB_AUTH_PASSWORD_HASH
      || process.env.CARPOSTCLUB_AUTH_PASSWORD
      || process.env.KONNER_AUTH_PASSWORD_HASH
      || process.env.KONNER_AUTH_PASSWORD
      || process.env.AUTH_PASSWORD_HASH
      || process.env.AUTH_PASSWORD
      || "carpostclub")
    .digest("hex");
}

function bootstrapAdminPasswordVersion(secret) {
  const source = process.env.CARPOSTCLUB_AUTH_PASSWORD_HASH
    || process.env.CARPOSTCLUB_AUTH_PASSWORD
    || process.env.KONNER_AUTH_PASSWORD_HASH
    || process.env.KONNER_AUTH_PASSWORD
    || process.env.AUTH_PASSWORD_HASH
    || process.env.AUTH_PASSWORD
    || "";
  if (!source) return "";
  return crypto.createHmac("sha256", secret)
    .update(`bootstrap-password:${source}`)
    .digest("base64url");
}

function loadEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return;

  const text = fs.readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator <= 0) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--base-url") options.baseUrl = argv[++index];
    else if (arg === "--env-file") options.envFile = argv[++index];
    else if (arg === "--require-release-id") options.requireReleaseId = argv[++index];
    else if (arg === "--timeout-ms") options.timeoutMs = Number(argv[++index]);
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
  console.log(`Usage: node scripts/smoke_test.mjs [options]

Options:
  --base-url <url>             App base URL. Default: http://127.0.0.1:3911
  --env-file <path>            Load auth/session env values from a systemd-style env file.
  --require-release-id <id>    Require health/version to report this release id.
  --timeout-ms <n>             Per-request timeout. Default: 10000.
`);
}
