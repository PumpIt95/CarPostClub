#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export async function inspectRestartSafety({
  baseUrl = "http://127.0.0.1:3911",
  tmpRoot = "/var/lib/konner-upload/tmp",
  recentTempSeconds = 300,
} = {}) {
  const health = await fetchHealth(baseUrl);
  const recentTempFiles = await findRecentTempFiles(tmpRoot, recentTempSeconds);
  const reasons = [];
  if (!health.ok) reasons.push(`health_unavailable:${health.error || health.status}`);
  if (health.body?.shuttingDown === true) reasons.push("app_already_shutting_down");
  if (Number(health.body?.criticalOperationCount || 0) > 0) {
    reasons.push(`critical_operations:${health.body.criticalOperationCount}`);
  }
  if (recentTempFiles.length) reasons.push(`recent_temp_files:${recentTempFiles.length}`);
  return {
    safeToRestart: reasons.length === 0,
    checkedAt: new Date().toISOString(),
    baseUrl,
    tmpRoot,
    reasons,
    health: health.ok ? {
      status: health.status,
      release: health.body?.release || null,
      shuttingDown: health.body?.shuttingDown === true,
      criticalOperationCount: Number(health.body?.criticalOperationCount || 0),
      criticalOperations: health.body?.criticalOperations || [],
    } : health,
    recentTempFiles,
  };
}

async function fetchHealth(baseUrl) {
  try {
    const response = await fetch(`${String(baseUrl).replace(/\/$/, "")}/healthz`, {
      signal: AbortSignal.timeout(5000),
    });
    const body = await response.json().catch(() => null);
    return { ok: response.ok && body?.ok === true, status: response.status, body };
  } catch (error) {
    return { ok: false, status: 0, error: error?.message || String(error) };
  }
}

async function findRecentTempFiles(tmpRoot, recentTempSeconds) {
  const cutoff = Date.now() - recentTempSeconds * 1000;
  let entries;
  try {
    entries = await fs.readdir(tmpRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const recent = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const filePath = path.join(tmpRoot, entry.name);
    const stat = await fs.stat(filePath);
    if (stat.mtimeMs >= cutoff) recent.push({ path: filePath, bytes: stat.size, modifiedAt: stat.mtime.toISOString() });
  }
  return recent;
}

function parseArgs(argv) {
  const result = {
    checkOnly: false,
    baseUrl: "http://127.0.0.1:3911",
    tmpRoot: "/var/lib/konner-upload/tmp",
    timeoutSeconds: 300,
    pollSeconds: 2,
    recentTempSeconds: 300,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--check-only") result.checkOnly = true;
    else if (arg === "--wait") result.checkOnly = false;
    else if (arg === "--base-url") result.baseUrl = argv[++index];
    else if (arg === "--tmp-root") result.tmpRoot = argv[++index];
    else if (arg === "--timeout-seconds") result.timeoutSeconds = positiveNumber(argv[++index], arg);
    else if (arg === "--poll-seconds") result.pollSeconds = positiveNumber(argv[++index], arg);
    else if (arg === "--recent-temp-seconds") result.recentTempSeconds = positiveNumber(argv[++index], arg);
    else if (arg === "--help") result.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return result;
}

function positiveNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} requires a positive number`);
  return number;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function usage() {
  return `Usage: node scripts/safe_restart.mjs [--check-only|--wait] [options]

Options:
  --base-url <url>             Local app URL. Default: http://127.0.0.1:3911
  --tmp-root <path>            Upload temp directory. Default: /var/lib/konner-upload/tmp
  --timeout-seconds <n>        Maximum wait. Default: 300
  --poll-seconds <n>           Wait polling interval. Default: 2
  --recent-temp-seconds <n>    Temp-file safety window. Default: 300
`;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(usage());
    return 0;
  }
  const deadline = Date.now() + options.timeoutSeconds * 1000;
  let last;
  do {
    last = await inspectRestartSafety(options);
    if (last.safeToRestart || options.checkOnly) break;
    await delay(options.pollSeconds * 1000);
  } while (Date.now() < deadline);
  process.stdout.write(`${JSON.stringify(last, null, 2)}\n`);
  return last.safeToRestart ? 0 : 2;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}
