#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const args = parseArgs(process.argv.slice(2));
if (!args.archive) throw new Error("Missing required --archive <path>.");

const archive = path.resolve(args.archive);
await fs.access(archive);

const listing = await run("tar", ["-tzf", archive], { capture: true });
const entries = listing.stdout.split(/\r?\n/).filter(Boolean);
if (!entries.length) throw new Error(`Archive is empty: ${archive}`);

const unsafeEntry = entries.find((entry) => path.isAbsolute(entry) || entry.split("/").includes(".."));
if (unsafeEntry) throw new Error(`Archive contains an unsafe path: ${unsafeEntry}`);

const rootName = entries[0].split("/").filter(Boolean)[0] || "";
if (!rootName) throw new Error("Archive does not contain a state root directory.");

const requiredSignals = [
  { name: "uploads", found: entries.some((entry) => entry === `${rootName}/uploads/` || entry.startsWith(`${rootName}/uploads/`)) },
  { name: "auth or app state", found: entries.some((entry) => /\/(?:auth-users|manual-inventory|inventory-lifecycle|notification-log|audit-log)\.json$/.test(entry)) },
];
const missingSignals = requiredSignals.filter((signal) => !signal.found).map((signal) => signal.name);
if (missingSignals.length) {
  throw new Error(`Archive is missing expected state signal(s): ${missingSignals.join(", ")}`);
}

let extractDir = "";
let extractedEntries = 0;
if (args.extractCheck) {
  extractDir = args.extractDir
    ? path.resolve(args.extractDir)
    : await fs.mkdtemp(path.join(os.tmpdir(), "carpostclub-restore-check-"));
  await fs.mkdir(extractDir, { recursive: true });
  await run("tar", ["-xzf", archive, "-C", extractDir]);
  const extractedRoot = path.join(extractDir, rootName);
  const extracted = await walk(extractedRoot);
  extractedEntries = extracted.length;
  if (!extractedEntries) throw new Error(`Extracted archive contained no files under ${extractedRoot}`);
}

console.log(JSON.stringify({
  ok: true,
  archive,
  rootName,
  entries: entries.length,
  extractDir,
  extractedEntries,
}, null, 2));

async function walk(directory) {
  const results = [];
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      results.push(...await walk(absolutePath));
    } else if (entry.isFile()) {
      results.push(absolutePath);
    }
  }
  return results;
}

async function run(command, commandArgs, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
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

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--archive") options.archive = argv[++index];
    else if (arg === "--extract-check") options.extractCheck = true;
    else if (arg === "--extract-dir") options.extractDir = argv[++index];
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
  console.log(`Usage: node scripts/restore_state_check.mjs --archive <path> [options]

Options:
  --archive <path>       Backup archive to validate.
  --extract-check        Extract archive into a temporary directory after listing checks.
  --extract-dir <path>   Directory to use with --extract-check. Default: temp directory.
`);
}
