#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import process from "node:process";

const args = parseArgs(process.argv.slice(2));
loadEnvFile(args.envFile);

const baseUrl = new URL(args.baseUrl || "http://127.0.0.1:3911");
const body = {
  dryRun: Boolean(args.dryRun),
  force: Boolean(args.force),
  includeManual: Boolean(args.includeManual),
  includeSourceRemoved: Boolean(args.includeSourceRemoved),
  ...(args.limit ? { limit: args.limit } : {}),
};
const response = await fetch(new URL("/api/admin/marketplace-descriptions/backfill", baseUrl), {
  method: "POST",
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...buildAuthHeaders(),
  },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(args.timeoutMs || 120000),
});

const text = await response.text();
let result = null;
try {
  result = JSON.parse(text);
} catch {
  throw new Error(`Backfill endpoint returned non-JSON ${response.status}: ${text.slice(0, 300)}`);
}

if (!response.ok || result?.ok !== true) {
  throw new Error(`Backfill failed with ${response.status}: ${JSON.stringify(result, null, 2)}`);
}

console.log(`${JSON.stringify(result, null, 2)}\n`);

function buildAuthHeaders() {
  if (args.cookie) return { Cookie: args.cookie };

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
  if (process.env.NODE_ENV === "test") return "test-session-secret";
  throw new Error("Explicit auth session secret is required for the backfill helper.");
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

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--base-url") options.baseUrl = argv[++index];
    else if (arg === "--env-file") options.envFile = argv[++index];
    else if (arg === "--cookie") options.cookie = argv[++index];
    else if (arg === "--limit") options.limit = positiveInteger(argv[++index], 0);
    else if (arg === "--timeout-ms") options.timeoutMs = positiveInteger(argv[++index], 120000);
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--force") options.force = true;
    else if (arg === "--include-manual") options.includeManual = true;
    else if (arg === "--include-source-removed") options.includeSourceRemoved = true;
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
  console.log(`Usage: node scripts/backfill_marketplace_descriptions.mjs [options]

Options:
  --base-url <url>             App URL. Default: http://127.0.0.1:3911
  --env-file <path>            Load app env for bootstrap admin cookie signing.
  --cookie <cookie>            Explicit admin Cookie header value.
  --dry-run                    Report records that would be updated without writing.
  --force                      Regenerate even when the current prompt/input hash matches.
  --include-manual             Include manual inventory albums.
  --include-source-removed     Include source-removed albums.
  --limit <count>              Process at most this many albums.
  --timeout-ms <ms>            Request timeout. Default: 120000.
`);
}
