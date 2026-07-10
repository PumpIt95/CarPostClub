#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";

const args = parseArgs(process.argv.slice(2));
await loadEnvFile(args.envFile);

const stateRoot = path.resolve(args.root
  || process.env.CARPOSTCLUB_STATE_ROOT
  || process.env.KONNER_STATE_ROOT
  || path.dirname(process.env.UPLOAD_ROOT || "/var/lib/carpostclub/uploads"));
const outputDir = path.resolve(args.outputDir || path.join(stateRoot, "backups"));
const archive = path.resolve(args.archive || path.join(outputDir, `carpostclub-state-${timestampForFilename()}.tar.gz`));
const excludedDirectoryNames = new Set(["backups", "tmp", "debug-screenshots"]);
const excludes = [...excludedDirectoryNames].map((name) => `${path.basename(stateRoot)}/${name}`);

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
    retain: args.retain,
  }, null, 2));
  process.exit(0);
}

await fs.mkdir(path.dirname(archive), { recursive: true });
if (path.dirname(archive) !== outputDir) await fs.mkdir(outputDir, { recursive: true });

const basename = path.basename(stateRoot);
const databasePaths = await currentSqliteDatabasePaths(stateRoot);
const stagingParent = await fs.mkdtemp(path.join(os.tmpdir(), "carpostclub-backup-"));
const stagedStateRoot = path.join(stagingParent, basename);
try {
  const excludedPaths = new Set(databasePaths.flatMap((databasePath) => [
    databasePath,
    `${databasePath}-wal`,
    `${databasePath}-shm`,
  ]));
  await fs.cp(stateRoot, stagedStateRoot, {
    recursive: true,
    preserveTimestamps: true,
    filter: (source) => shouldStagePath(source, stateRoot, excludedPaths),
  });
  for (const databasePath of databasePaths) {
    await snapshotSqliteDatabase(databasePath, path.join(stagedStateRoot, path.basename(databasePath)));
  }
  await run("tar", ["-C", stagingParent, "-czf", archive, basename]);
} finally {
  await fs.rm(stagingParent, { recursive: true, force: true });
}

let entriesChecked = 0;
if (args.verify !== false) {
  const listing = await run("tar", ["-tzf", archive], { capture: true });
  entriesChecked = listing.stdout.split(/\r?\n/).filter(Boolean).length;
  if (!entriesChecked) throw new Error(`Backup archive is empty: ${archive}`);
}

const archiveStat = await fs.stat(archive);
const removedArchives = await enforceArchiveRetention(outputDir, archive, args.retain);
console.log(JSON.stringify({
  ok: true,
  stateRoot,
  archive,
  bytes: archiveStat.size,
  entriesChecked,
  excludes,
  databaseSnapshots: databasePaths.map((databasePath) => path.basename(databasePath)),
  retain: args.retain,
  removedArchives,
}, null, 2));

async function currentSqliteDatabasePaths(root) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sqlite"))
    .map((entry) => path.join(root, entry.name))
    .sort();
}

function shouldStagePath(source, root, excludedPaths) {
  const resolved = path.resolve(source);
  if (resolved === root) return true;
  if (excludedPaths.has(resolved)) return false;
  const relative = path.relative(root, resolved);
  const first = relative.split(path.sep)[0];
  return !excludedDirectoryNames.has(first);
}

async function snapshotSqliteDatabase(source, destination) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.rm(destination, { force: true });
  const db = new DatabaseSync(source);
  try {
    db.exec("PRAGMA busy_timeout = 30000");
    const escaped = destination.replaceAll("'", "''");
    db.exec(`VACUUM INTO '${escaped}'`);
  } finally {
    db.close();
  }
}

async function enforceArchiveRetention(directory, currentArchive, retain) {
  if (!Number.isInteger(retain) || retain <= 0) return [];
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const archives = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^carpostclub-state-\d{8}T\d{6}Z\.tar\.gz$/.test(entry.name)) continue;
    const archivePath = path.join(directory, entry.name);
    const stat = await fs.stat(archivePath);
    archives.push({ path: archivePath, mtimeMs: stat.mtimeMs });
  }
  archives.sort((left, right) => right.mtimeMs - left.mtimeMs || right.path.localeCompare(left.path));
  const current = path.resolve(currentArchive);
  const keep = new Set(archives.slice(0, retain).map((entry) => path.resolve(entry.path)));
  keep.add(current);
  const removed = [];
  for (const entry of archives) {
    if (keep.has(path.resolve(entry.path))) continue;
    await fs.rm(entry.path, { force: true });
    removed.push(entry.path);
  }
  return removed;
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
  const options = { verify: true, retain: 0 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") options.root = argv[++index];
    else if (arg === "--output-dir") options.outputDir = argv[++index];
    else if (arg === "--archive") options.archive = argv[++index];
    else if (arg === "--env-file") options.envFile = argv[++index];
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--no-verify") options.verify = false;
    else if (arg === "--retain") {
      options.retain = Number(argv[++index]);
      if (!Number.isInteger(options.retain) || options.retain < 0) {
        throw new Error("--retain must be a non-negative integer");
      }
    }
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
  --retain <count>       Keep only the newest matching archives after success. Default: 0 (no pruning).
`);
}
