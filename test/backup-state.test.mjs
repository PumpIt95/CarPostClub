import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const backupScript = path.join(projectRoot, "scripts", "backup_state.mjs");

test("state backup snapshots SQLite consistently and prunes only old matching archives", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cpc-backup-test-"));
  const stateRoot = path.join(root, "state");
  const backupRoot = path.join(stateRoot, "backups");
  const extractRoot = path.join(root, "extract");
  await fs.mkdir(backupRoot, { recursive: true });
  await fs.writeFile(path.join(stateRoot, "settings.json"), "{\"ok\":true}\n");
  await fs.writeFile(path.join(backupRoot, "must-not-nest.txt"), "excluded\n");

  const sourceDb = path.join(stateRoot, "inventory.sqlite");
  const db = new DatabaseSync(sourceDb);
  db.exec("PRAGMA journal_mode = WAL; CREATE TABLE cars (id TEXT PRIMARY KEY); INSERT INTO cars VALUES ('A1');");
  db.close();

  try {
    const archives = [
      "carpostclub-state-20260101T000000Z.tar.gz",
      "carpostclub-state-20260102T000000Z.tar.gz",
      "carpostclub-state-20260103T000000Z.tar.gz",
    ];
    let lastResult;
    for (let index = 0; index < archives.length; index += 1) {
      const archive = path.join(backupRoot, archives[index]);
      const run = spawnSync(process.execPath, [
        backupScript,
        "--root", stateRoot,
        "--archive", archive,
        "--retain", "2",
      ], { encoding: "utf8" });
      assert.equal(run.status, 0, run.stderr);
      lastResult = JSON.parse(run.stdout);
      const stamp = new Date(Date.UTC(2026, 0, index + 1));
      await fs.utimes(archive, stamp, stamp);
    }

    const remaining = (await fs.readdir(backupRoot)).filter((name) => name.endsWith(".tar.gz")).sort();
    assert.deepEqual(remaining, archives.slice(1));
    assert.deepEqual(lastResult.databaseSnapshots, ["inventory.sqlite"]);
    assert.equal(lastResult.removedArchives.length, 1);

    await fs.mkdir(extractRoot, { recursive: true });
    const extract = spawnSync("tar", ["-xzf", path.join(backupRoot, archives[2]), "-C", extractRoot], { encoding: "utf8" });
    assert.equal(extract.status, 0, extract.stderr);
    await assert.rejects(fs.access(path.join(extractRoot, "state", "backups", "must-not-nest.txt")), { code: "ENOENT" });
    const restored = new DatabaseSync(path.join(extractRoot, "state", "inventory.sqlite"), { readOnly: true });
    assert.equal(restored.prepare("SELECT COUNT(*) AS count FROM cars").get().count, 1);
    restored.close();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
