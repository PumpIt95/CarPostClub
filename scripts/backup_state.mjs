#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const args = parseArgs(process.argv.slice(2));
await loadEnvFile(args.envFile);

const stateRoot = path.resolve(args.root
  || process.env.CARPOSTCLUB_STATE_ROOT
  || process.env.KONNER_STATE_ROOT
  || path.dirname(process.env.UPLOAD_ROOT || "/var/lib/carpostclub/uploads"));
const outputDir = path.resolve(args.outputDir || path.join(stateRoot, "backups"));
const archive = path.resolve(args.archive || path.join(outputDir, `carpostclub-state-${timestampForFilename()}.tar.gz`));
const excludes = [
  `${path.basename(stateRoot)}/backups`,
  `${path.basename(stateRoot)}/tmp`,
  `${path.basename(stateRoot)}/debug-screenshots`,
];

const stat = await fs.stat(stateRoot).catch((error) => {
  if (error?.code === "ENOENT") throw new Error(`State root does not exist: ${stateRoot}`);
  throw error;
});
if (!stat.isDirectory()) throw new Error(`State root is not a directory: ${stateRoot}`);

if (args.dryRun) {
  console.log(JSON.stringify({
    ok: true,
    dryRun: true,
    stateRoot,
    archive,
    excludes,
  }, null, 2));
  process.exit(0);
}

await fs.mkdir(path.dirname(archive), { recursive: true });
if (path.dirname(archive) !== outputDir) await fs.mkdir(outputDir, { recursive: true });

const parent = path.dirname(stateRoot);
const basename = path.basename(stateRoot);
await run("tar", [
  "-C",
  parent,
  ...excludes.map((exclude) => `--exclude=${exclude}`),
  "-czf",
  archive,
  basename,
]);

let entriesChecked = 0;
if (args.verify !== false) {
  const listing = await run("tar", ["-tzf", archive], { capture: true });
  entriesChecked = listing.stdout.split(/\r?\n/).filter(Boolean).length;
  if (!entriesChecked) throw new Error(`Backup archive is empty: ${archive}`);
}

const archiveStat = await fs.stat(archive);
console.log(JSON.stringify({
  ok: true,
  stateRoot,
  archive,
  bytes: archiveStat.size,
  entriesChecked,
  excludes,
}, null, 2));

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

function loadEnvFile(filePath) {
  if (!filePath) return;
  return fs.readFile(filePath, "utf8").then((text) => {
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
  }).catch((error) => {
    if (error?.code === "ENOENT") throw new Error(`Env file does not exist: ${filePath}`);
    throw error;
  });
}

function timestampForFilename() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function parseArgs(argv) {
  const options = { verify: true };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") options.root = argv[++index];
    else if (arg === "--output-dir") options.outputDir = argv[++index];
    else if (arg === "--archive") options.archive = argv[++index];
    else if (arg === "--env-file") options.envFile = argv[++index];
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--no-verify") options.verify = false;
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
  console.log(`Usage: node scripts/backup_state.mjs [options]

Options:
  --root <path>          State root to back up. Default: dirname(UPLOAD_ROOT).
  --output-dir <path>    Directory for generated archives. Default: <root>/backups.
  --archive <path>       Exact archive path. Default: timestamped .tar.gz in output dir.
  --env-file <path>      Load a systemd/docker env file before resolving UPLOAD_ROOT.
  --dry-run              Print resolved paths without creating an archive.
  --no-verify            Skip tar listing verification after creation.
`);
}
