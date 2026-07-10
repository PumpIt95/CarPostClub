import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { inspectRestartSafety } from "../scripts/safe_restart.mjs";

test("safe restart blocks active operations and recent upload temp files", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cpc-safe-restart-"));
  let criticalOperationCount = 0;
  const server = http.createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, shuttingDown: false, criticalOperationCount }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const clean = await inspectRestartSafety({ baseUrl, tmpRoot, recentTempSeconds: 300 });
    assert.equal(clean.safeToRestart, true);

    criticalOperationCount = 1;
    const active = await inspectRestartSafety({ baseUrl, tmpRoot, recentTempSeconds: 300 });
    assert.equal(active.safeToRestart, false);
    assert.ok(active.reasons.includes("critical_operations:1"));

    criticalOperationCount = 0;
    await fs.writeFile(path.join(tmpRoot, "upload.part"), "pending");
    const tempBlocked = await inspectRestartSafety({ baseUrl, tmpRoot, recentTempSeconds: 300 });
    assert.equal(tempBlocked.safeToRestart, false);
    assert.ok(tempBlocked.reasons.includes("recent_temp_files:1"));
  } finally {
    server.close();
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});
