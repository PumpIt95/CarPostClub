#!/usr/bin/env node
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.root || process.cwd());
const output = path.resolve(root, args.output || "release-manifest.json");
const releaseId = args.releaseId || new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const createdAt = args.createdAt || new Date().toISOString();
const execFileAsync = promisify(execFile);

const files = await collectManifestFiles(root);
const manifest = {
  schemaVersion: 1,
  releaseId,
  createdAt,
  source: args.source || "manual",
  root: ".",
  node: process.version,
  files,
};

await fs.writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${path.relative(root, output) || output} with ${files.length} file(s) for release ${releaseId}.`);

async function collectManifestFiles(directory) {
  const gitFiles = await collectGitTrackedFiles(directory);
  if (gitFiles) return gitFiles;
  return collectFiles(directory);
}

async function collectGitTrackedFiles(directory) {
  try {
    const { stdout } = await execFileAsync("git", ["-C", directory, "ls-files", "-z"], {
      maxBuffer: 10 * 1024 * 1024,
    });
    const paths = stdout.split("\0")
      .filter(Boolean)
      .filter((relativePath) => !shouldSkipManifestPath(relativePath));
    const results = [];
    for (const relativePath of paths.sort((left, right) => left.localeCompare(right))) {
      const absolutePath = path.join(directory, relativePath);
      const buffer = await fs.readFile(absolutePath);
      results.push({
        path: toPosixPath(relativePath),
        bytes: buffer.length,
        sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
      });
    }
    return results;
  } catch {
    return null;
  }
}

async function collectFiles(directory, prefix = "") {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const results = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (shouldSkip(entry.name, entry.isDirectory())) continue;

    const absolutePath = path.join(directory, entry.name);
    const relativePath = toPosixPath(path.join(prefix, entry.name));
    if (path.resolve(absolutePath) === output) continue;

    if (entry.isDirectory()) {
      results.push(...await collectFiles(absolutePath, relativePath));
      continue;
    }

    if (!entry.isFile()) continue;
    const buffer = await fs.readFile(absolutePath);
    results.push({
      path: relativePath,
      bytes: buffer.length,
      sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
    });
  }

  return results;
}

function shouldSkipManifestPath(relativePath) {
  const normalized = toPosixPath(relativePath);
  const relativeOutput = toPosixPath(path.relative(root, output));
  return normalized === relativeOutput
    || normalized === "release-manifest.json"
    || normalized === "playwright.config.mjs"
    || normalized.startsWith("test/")
    || normalized.startsWith("test-results/")
    || normalized.startsWith("playwright-report/");
}

function shouldSkip(name, isDirectory) {
  if (
    name === ".DS_Store"
    || name.startsWith("._")
    || name === ".env"
    || name === ".listing-disclosure-current-run-dir"
    || name === "CHROME_TABS.md"
    || name === "chrome-tab-registry.sqlite"
    || name.startsWith("facebook-marketplace-messages") && name.endsWith(".sqlite")
    || name.startsWith("facebook-")
    || name.startsWith("listing-disclosure-audit-and-fix-") && name.endsWith(".json")
    || name === "playwright.config.mjs"
    || name === "production-inventory-current.json"
    || name === "release-manifest.json"
  ) return true;
  if (!isDirectory) return false;
  return name === ".git"
    || name === ".codex"
    || name === ".playwright-cli"
    || name === ".automation-artifacts"
    || name === "node_modules"
    || name === ".automation-locks"
    || name === "automation-runs"
    || name === "backups"
    || name === "facebook-post-packages-current"
    || name === "output"
    || name === "outputs"
    || name === "releases"
    || name === "test"
    || name === "test-results"
    || name === "tmp"
    || name === "playwright-report";
}

function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") options.root = argv[++index];
    else if (arg === "--output") options.output = argv[++index];
    else if (arg === "--release-id") options.releaseId = argv[++index];
    else if (arg === "--created-at") options.createdAt = argv[++index];
    else if (arg === "--source") options.source = argv[++index];
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
  console.log(`Usage: node scripts/build_release_manifest.mjs [options]

Options:
  --root <path>          App root to scan. Default: current directory.
  --output <path>        Manifest output path. Default: release-manifest.json.
  --release-id <id>      Release identifier. Default: current UTC timestamp.
  --created-at <iso>     Release creation timestamp. Default: now.
  --source <text>        Human-readable source label. Default: manual.
`);
}
