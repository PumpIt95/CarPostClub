import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

test("release manifest records the deployed source commit", async () => {
  const output = path.join(os.tmpdir(), `carpostclub-release-${process.pid}-${Date.now()}.json`);
  try {
    const result = spawnSync(process.execPath, [
      path.join(projectRoot, "scripts", "build_release_manifest.mjs"),
      "--root",
      projectRoot,
      "--output",
      output,
      "--release-id",
      "ci-test",
      "--source",
      "test",
      "--source-commit",
      "0123456789abcdef",
    ], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(await fs.readFile(output, "utf8"));
    assert.equal(manifest.releaseId, "ci-test");
    assert.equal(manifest.sourceCommit, "0123456789abcdef");
    assert.ok(manifest.files.some((file) => file.path === "server.js"));
  } finally {
    await fs.rm(output, { force: true });
  }
});
