import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { pruneInventorySnapshotHistory } from "../scripts/inventory_snapshot_retention.mjs";

test("snapshot retention removes old raw history but preserves current state and referenced runs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cpc-snapshot-retention-"));
  const dbPath = path.join(root, "snapshots.sqlite");
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      CREATE TABLE oregans_inventory_snapshot_runs (
        id TEXT PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT NOT NULL
      );
      CREATE TABLE oregans_inventory_snapshot_items (
        run_id TEXT NOT NULL, vehicle_key TEXT NOT NULL, observed_at TEXT NOT NULL,
        PRIMARY KEY (run_id, vehicle_key)
      );
      CREATE TABLE oregans_inventory_vehicles (
        vehicle_key TEXT PRIMARY KEY, first_snapshot_run_id TEXT NOT NULL, last_snapshot_run_id TEXT NOT NULL
      );
      CREATE TABLE oregans_inventory_snapshot_scopes (
        dealership_id TEXT NOT NULL, inventory_type_id TEXT NOT NULL,
        first_snapshot_run_id TEXT NOT NULL, last_snapshot_run_id TEXT NOT NULL,
        PRIMARY KEY (dealership_id, inventory_type_id)
      );
    `);
    const old = "2026-01-01T00:00:00.000Z";
    const recent = "2026-02-19T00:00:00.000Z";
    for (const [id, at] of [["old-unreferenced", old], ["old-first", old], ["recent", recent]]) {
      db.prepare("INSERT INTO oregans_inventory_snapshot_runs VALUES (?, ?, ?)").run(id, at, at);
      db.prepare("INSERT INTO oregans_inventory_snapshot_items VALUES (?, ?, ?)").run(id, `vehicle-${id}`, at);
    }
    db.prepare("INSERT INTO oregans_inventory_vehicles VALUES (?, ?, ?)")
      .run("current-vehicle", "old-first", "recent");
    db.prepare("INSERT INTO oregans_inventory_snapshot_scopes VALUES (?, ?, ?, ?)")
      .run("15", "2", "old-first", "recent");

    const dryRun = pruneInventorySnapshotHistory(db, {
      retentionDays: 14,
      now: new Date("2026-02-20T00:00:00.000Z"),
    });
    assert.deepEqual(dryRun.candidates, { items: 2, runs: 1 });
    assert.deepEqual(dryRun.before, { items: 3, runs: 3, vehicles: 1, scopes: 1 });

    const applied = pruneInventorySnapshotHistory(db, {
      retentionDays: 14,
      now: new Date("2026-02-20T00:00:00.000Z"),
      apply: true,
    });
    assert.deepEqual(applied.deleted, { items: 2, runs: 1 });
    assert.deepEqual(applied.after, { items: 1, runs: 2, vehicles: 1, scopes: 1 });
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM oregans_inventory_vehicles").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM oregans_inventory_snapshot_runs WHERE id = 'old-first'").get().count, 1);
  } finally {
    db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
