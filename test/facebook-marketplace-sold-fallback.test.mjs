import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  acquireActionLock,
  buildHelperCandidate,
  normalizePriceText,
  releaseActionLock,
  scoreVerification,
} from "../scripts/facebook_marketplace_sold_fallback.mjs";

test("normalizes Facebook and source prices to CA dollar text", () => {
  assert.equal(normalizePriceText("$43,490"), "CA$43,490");
  assert.equal(normalizePriceText("CA$28,990"), "CA$28,990");
});

test("builds stale-listing helper payload from live verification gates", () => {
  const payload = buildHelperCandidate(
    {
      stockNumber: "U6589",
      vin: "KNDPXDDH1R7125305",
      vehicleTitle: "2024 Kia Sportage Hybrid",
      sourceInventoryFetchOk: true,
      publicOregansInventoryCheckOk: true,
    },
    {
      accountVerified: true,
      listingVerified: true,
      ambiguous: false,
      target: { status: "Active" },
      priceText: "CA$43,490",
    },
    { dryRun: false, listingActionLockHeld: true },
  );

  assert.equal(payload.facebookAccountVerified, true);
  assert.equal(payload.listingVerified, true);
  assert.equal(payload.listingActionLockHeld, true);
  assert.equal(payload.matchConfidence, "high");
});

test("scores verified pages above unverified pages", () => {
  assert.ok(
    scoreVerification({
      accountVerified: true,
      listingVerified: true,
      target: {
        titlePresent: true,
        pricePresent: true,
        markSold: { found: true },
      },
    }) > scoreVerification({ accountVerified: false, target: {} }),
  );
});

test("only releases a Facebook action lock owned by this run", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cpc-fb-action-lock-"));
  const lockDir = path.join(tempRoot, "facebook-listing-action.lock");
  try {
    await fs.mkdir(lockDir);
    await fs.writeFile(
      path.join(lockDir, "owner.txt"),
      "owner=other-run\nrun_dir=/tmp/other\nstock=U0000\npid=1\n",
      "utf8",
    );

    assert.equal(
      await releaseActionLock({
        owner: "live-facebook-listing-sync-cdp-fallback",
        runDir: "/tmp/current",
        stockNumber: "U0000",
        pid: process.pid,
      }, lockDir),
      false,
    );
    assert.equal(await pathExists(lockDir), true);

    await fs.rm(lockDir, { recursive: true, force: true });
    const token = await acquireActionLock({
      owner: "live-facebook-listing-sync-cdp-fallback",
      runDir: "/tmp/current",
      stockNumber: "U0000",
      lockDir,
    });
    assert.equal(await releaseActionLock(token, lockDir), true);
    assert.equal(await pathExists(lockDir), false);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

async function pathExists(filePath) {
  try {
    await fs.stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}
