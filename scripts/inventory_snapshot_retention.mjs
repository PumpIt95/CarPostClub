#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const DAY_MS = 24 * 60 * 60 * 1000;

export function pruneInventorySnapshotHistory(db, {
  retentionDays = 14,
  now = new Date(),
  apply = false,
  vacuum = false,
} = {}) {
  if (!db || typeof db.prepare !== "function") throw new Error("A SQLite DatabaseSync connection is required.");
  const days = Number(retentionDays);
  if (!Number.isFinite(days) || days <= 0 || days > 3650) {
    throw new Error(`retentionDays must be between 0 and 3650; received ${retentionDays}`);
  }
  if (vacuum && !apply) throw new Error("--vacuum requires --apply");
  const nowDate = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(nowDate.getTime())) throw new Error(`Invalid retention clock: ${now}`);
  const cutoff = new Date(nowDate.getTime() - days * DAY_MS).toISOString();

  const itemCandidateCount = Number(db.prepare(`
    SELECT COUNT(*) AS count
    FROM oregans_inventory_snapshot_items
    WHERE observed_at < ?
  `).get(cutoff)?.count || 0);
  const runCandidateSql = `
    SELECT COUNT(*) AS count
    FROM oregans_inventory_snapshot_runs
    WHERE COALESCE(NULLIF(finished_at, ''), started_at) < ?
      AND id NOT IN (
        SELECT first_snapshot_run_id FROM oregans_inventory_vehicles WHERE first_snapshot_run_id <> ''
        UNION SELECT last_snapshot_run_id FROM oregans_inventory_vehicles WHERE last_snapshot_run_id <> ''
        UNION SELECT first_snapshot_run_id FROM oregans_inventory_snapshot_scopes WHERE first_snapshot_run_id <> ''
        UNION SELECT last_snapshot_run_id FROM oregans_inventory_snapshot_scopes WHERE last_snapshot_run_id <> ''
      )
  `;
  const runCandidateCount = Number(db.prepare(runCandidateSql).get(cutoff)?.count || 0);
  const before = snapshotHistoryCounts(db);
  let deletedItems = 0;
  let deletedRuns = 0;
  let checkpoint = null;

  if (apply) {
    db.exec("BEGIN IMMEDIATE");
    try {
      deletedItems = Number(db.prepare(`
        DELETE FROM oregans_inventory_snapshot_items
        WHERE observed_at < ?
      `).run(cutoff)?.changes || 0);
      deletedRuns = Number(db.prepare(`
        DELETE FROM oregans_inventory_snapshot_runs
        WHERE COALESCE(NULLIF(finished_at, ''), started_at) < ?
          AND id NOT IN (
            SELECT first_snapshot_run_id FROM oregans_inventory_vehicles WHERE first_snapshot_run_id <> ''
            UNION SELECT last_snapshot_run_id FROM oregans_inventory_vehicles WHERE last_snapshot_run_id <> ''
            UNION SELECT first_snapshot_run_id FROM oregans_inventory_snapshot_scopes WHERE first_snapshot_run_id <> ''
            UNION SELECT last_snapshot_run_id FROM oregans_inventory_snapshot_scopes WHERE last_snapshot_run_id <> ''
          )
      `).run(cutoff)?.changes || 0);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    db.exec("PRAGMA optimize");
    try {
      checkpoint = db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get() || null;
    } catch (error) {
      checkpoint = { error: error?.message || String(error) };
    }
    if (vacuum) db.exec("VACUUM");
  }

  return {
    ok: true,
    applied: apply,
    vacuumed: apply && vacuum,
    retentionDays: days,
    cutoff,
    candidates: { items: itemCandidateCount, runs: runCandidateCount },
    deleted: { items: deletedItems, runs: deletedRuns },
    before,
    after: apply ? snapshotHistoryCounts(db) : before,
    checkpoint,
  };
}

function snapshotHistoryCounts(db) {
  return {
    items: Number(db.prepare("SELECT COUNT(*) AS count FROM oregans_inventory_snapshot_items").get()?.count || 0),
    runs: Number(db.prepare("SELECT COUNT(*) AS count FROM oregans_inventory_snapshot_runs").get()?.count || 0),
    vehicles: Number(db.prepare("SELECT COUNT(*) AS count FROM oregans_inventory_vehicles").get()?.count || 0),
    scopes: Number(db.prepare("SELECT COUNT(*) AS count FROM oregans_inventory_snapshot_scopes").get()?.count || 0),
  };
}

function parseArgs(argv) {
  const options = { retentionDays: 14, apply: false, vacuum: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--db") options.dbPath = argv[++index];
    else if (arg === "--retention-days") options.retentionDays = Number(argv[++index]);
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--vacuum") options.vacuum = true;
    else if (arg === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  return `Usage: node scripts/inventory_snapshot_retention.mjs [options]

Options:
  --db <path>             Snapshot SQLite path. Defaults beside UPLOAD_ROOT.
  --retention-days <n>    Raw snapshot history to retain. Default: 14.
  --apply                 Delete eligible old raw snapshot rows.
  --vacuum                Reclaim file space after deletion; requires --apply.
  --help                  Show this help.
`;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(usage());
    return 0;
  }
  const uploadRoot = process.env.UPLOAD_ROOT || "/var/lib/carpostclub/uploads";
  const dbPath = path.resolve(options.dbPath
    || process.env.CARPOSTCLUB_OREGANS_INVENTORY_SNAPSHOTS_DB_PATH
    || process.env.OREGANS_INVENTORY_SNAPSHOTS_DB_PATH
    || path.join(path.dirname(uploadRoot), "oregans-inventory-snapshots.sqlite"));
  await fs.access(dbPath);
  const beforeBytes = (await fs.stat(dbPath)).size;
  const db = new DatabaseSync(dbPath);
  let result;
  try {
    db.exec("PRAGMA busy_timeout = 30000");
    result = pruneInventorySnapshotHistory(db, options);
  } finally {
    db.close();
  }
  const afterBytes = (await fs.stat(dbPath)).size;
  process.stdout.write(`${JSON.stringify({
    ...result,
    dbPath,
    bytes: { before: beforeBytes, after: afterBytes, reclaimed: Math.max(0, beforeBytes - afterBytes) },
  }, null, 2)}\n`);
  return 0;
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
