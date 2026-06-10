#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const appRoot = fileURLToPath(new URL("../", import.meta.url));
const args = parseArgs(process.argv.slice(2));
await loadEnvFile(args.envFile);

const baseUrl = new URL(args.baseUrl || process.env.CARPOSTCLUB_MONITOR_BASE_URL || "http://127.0.0.1:3911");
const timeoutMs = positiveInteger(args.timeoutMs, 10000);
const checks = [];

const health = await checkJson("/healthz", (body, response) => {
  assert(body.ok === true, "healthz ok flag is false");
  assert(body.service === "carpostclub", "healthz service mismatch");
  assert(body.mode === "photo-albums", "healthz mode mismatch");
  assertSecurityHeaders(response, "/healthz");
  if (args.requireReleaseId) {
    assert(body.release?.releaseId === args.requireReleaseId, `release ${body.release?.releaseId || "missing"} did not match ${args.requireReleaseId}`);
  }
  return body;
});

await checkJson("/api/version", (body, response) => {
  assert(body.ok === true, "version ok flag is false");
  assert(body.mode === "photo-albums", "version mode mismatch");
  assertSecurityHeaders(response, "/api/version");
  if (args.requireReleaseId) {
    assert(body.release?.releaseId === args.requireReleaseId, `version release ${body.release?.releaseId || "missing"} did not match ${args.requireReleaseId}`);
  }
});

let docker = null;
if (args.dockerContainer) {
  docker = await inspectDockerContainer(args.dockerContainer);
}

let smoke = null;
if (args.runSmoke) {
  smoke = await runSmokeTest();
}

console.log(JSON.stringify({
  ok: true,
  baseUrl: baseUrl.toString(),
  release: health.release || null,
  docker,
  smoke,
  checks,
}, null, 2));

async function checkJson(pathname, validate) {
  const response = await fetch(new URL(pathname, baseUrl), {
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  assert(response.ok, `${pathname} returned ${response.status}: ${text.slice(0, 200)}`);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${pathname} did not return JSON: ${text.slice(0, 200)}`);
  }
  const result = validate(body, response) || body;
  checks.push({ path: pathname, status: response.status, type: "json" });
  return result;
}

async function inspectDockerContainer(containerName) {
  const result = await run("docker", ["inspect", containerName], { capture: true });
  const inspect = JSON.parse(result.stdout)[0];
  if (!inspect) throw new Error(`Docker container not found: ${containerName}`);

  const restartCount = Number(inspect.RestartCount || 0);
  const maxRestarts = positiveInteger(args.maxRestarts, 0);
  assert(restartCount <= maxRestarts, `${containerName} restart count ${restartCount} is greater than ${maxRestarts}`);
  assert(inspect.State?.Running === true, `${containerName} is not running`);
  if (inspect.State?.Health?.Status) {
    assert(inspect.State.Health.Status !== "unhealthy", `${containerName} health is ${inspect.State.Health.Status}`);
  }

  checks.push({ dockerContainer: containerName, restartCount, status: inspect.State?.Status || "" });
  return {
    name: containerName,
    status: inspect.State?.Status || "",
    running: inspect.State?.Running === true,
    health: inspect.State?.Health?.Status || "",
    restartCount,
    startedAt: inspect.State?.StartedAt || "",
  };
}

async function runSmokeTest() {
  const smokeArgs = [
    path.join(appRoot, "scripts/smoke_test.mjs"),
    "--base-url",
    baseUrl.toString(),
  ];
  if (args.envFile) smokeArgs.push("--env-file", args.envFile);
  if (args.requireReleaseId) smokeArgs.push("--require-release-id", args.requireReleaseId);
  const result = await run(process.execPath, smokeArgs, { capture: true });
  checks.push({ script: "smoke_test.mjs", status: "passed" });
  return JSON.parse(result.stdout);
}

async function run(command, commandArgs, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: appRoot,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    if (capture) {
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
    }
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} exited with ${code}${stderr ? `: ${stderr.trim()}` : ""}`));
    });
  });
}

function assertSecurityHeaders(response, pathname) {
  assert(response.headers.get("x-content-type-options") === "nosniff", `${pathname} missing X-Content-Type-Options`);
  assert(response.headers.get("x-frame-options") === "DENY", `${pathname} missing X-Frame-Options`);
  assert(response.headers.get("referrer-policy") === "same-origin", `${pathname} missing Referrer-Policy`);
  assert(/frame-ancestors 'none'/.test(response.headers.get("content-security-policy") || ""), `${pathname} missing CSP frame-ancestors`);
}

async function loadEnvFile(filePath) {
  if (!filePath) return;
  const text = await fs.readFile(filePath, "utf8").catch((error) => {
    if (error?.code === "ENOENT") throw new Error(`Env file does not exist: ${filePath}`);
    throw error;
  });
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
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
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
    else if (arg === "--docker-container") options.dockerContainer = argv[++index];
    else if (arg === "--max-restarts") options.maxRestarts = Number(argv[++index]);
    else if (arg === "--run-smoke") options.runSmoke = true;
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
  console.log(`Usage: node scripts/production_monitor.mjs [options]

Options:
  --base-url <url>             App base URL. Default: http://127.0.0.1:3911
  --env-file <path>            Load auth/session env values for smoke checks.
  --require-release-id <id>    Require health/version to report this release id.
  --timeout-ms <n>             Per-request timeout. Default: 10000.
  --docker-container <name>    Inspect a Docker container for running/restart-loop status.
  --max-restarts <n>           Maximum allowed Docker restart count. Default: 0.
  --run-smoke                  Run scripts/smoke_test.mjs after monitor checks.
`);
}
