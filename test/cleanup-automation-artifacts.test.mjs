import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const cleanupScript = path.join(projectRoot, "scripts", "cleanup_automation_artifacts.py");

test("artifact cleanup removes old rebuildable payloads but preserves proofs and current runs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cpc-artifact-cleanup-"));
  const runsDir = path.join(root, "automation-runs");
  const oldRun = path.join(runsDir, "facebook-ready-publisher-old");
  const oldPackage = path.join(oldRun, "U123-package");
  const currentRun = path.join(runsDir, "facebook-ready-publisher-current");
  const currentPackage = path.join(currentRun, "U999-package");
  const oldDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);

  try {
    await fs.mkdir(oldPackage, { recursive: true });
    await fs.mkdir(currentPackage, { recursive: true });
    await fs.writeFile(path.join(oldPackage, "front.jpeg"), Buffer.alloc(1024));
    await fs.writeFile(path.join(oldRun, "U123-package.zip"), Buffer.alloc(2048));
    await fs.writeFile(path.join(oldRun, "run-summary.json"), "{}\n");
    await fs.writeFile(path.join(oldRun, "facebook-selling-after-publish-proof.png"), Buffer.alloc(128));
    await fs.writeFile(path.join(currentPackage, "front.jpeg"), Buffer.alloc(1024));
    await fs.writeFile(path.join(root, ".current-facebook-ready-run-dir"), `${currentRun}\n`);

    for (const target of [oldPackage, path.join(oldRun, "U123-package.zip"), oldRun, currentPackage, currentRun]) {
      await fs.utimes(target, oldDate, oldDate);
    }

    const dryRun = runCleanup(root);
    assert.equal(dryRun.status, 0, dryRun.stderr);
    const plan = JSON.parse(dryRun.stdout);
    assert.ok(plan.items.some((item) => item.path.endsWith("U123-package")));
    assert.ok(plan.items.some((item) => item.path.endsWith("U123-package.zip")));
    assert.ok(!plan.items.some((item) => item.path.includes("facebook-ready-publisher-current")));

    const applied = runCleanup(root, ["--apply", "--no-manifest"]);
    assert.equal(applied.status, 0, applied.stderr);
    await assert.rejects(fs.access(oldPackage), { code: "ENOENT" });
    await assert.rejects(fs.access(path.join(oldRun, "U123-package.zip")), { code: "ENOENT" });
    await fs.access(path.join(oldRun, "run-summary.json"));
    await fs.access(path.join(oldRun, "facebook-selling-after-publish-proof.png"));
    await fs.access(currentPackage);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

function runCleanup(root, extraArgs = []) {
  return spawnSync("python3", [
    cleanupScript,
    "--root",
    root,
    "--payload-retention-days",
    "14",
    ...extraArgs,
  ], { encoding: "utf8" });
}
