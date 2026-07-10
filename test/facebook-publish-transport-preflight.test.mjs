import assert from "node:assert/strict";
import { test } from "node:test";

import {
  decidePreflight,
  extractSection,
  parseKeyValueOutput,
  preflightExitCodeForStatus,
  safeStateFromGate,
  validatePublisherHandoff,
} from "../scripts/facebook_publish_transport_preflight.mjs";

const SAFE_GATE = {
  chrome_pressure: "ok",
  protected_state: "0",
  active_locks: "none",
  registry_active_claims: "0",
  registry_protected_claims: "0",
  registry_handoff_claims: "0",
  registry_protected_live_tabs: "0",
};

test("parses pressure gate key values and protected tab sections", () => {
  const output = [
    "chrome_pressure=ok",
    "active_locks=facebook-publish.lock",
    "protected_tabs_begin",
    "1:1:Facebook:https://www.facebook.com/marketplace/create/vehicle",
    "protected_tabs_end",
  ].join("\n");

  assert.equal(parseKeyValueOutput(output).active_locks, "facebook-publish.lock");
  assert.deepEqual(extractSection(output, "protected_tabs"), [
    "1:1:Facebook:https://www.facebook.com/marketplace/create/vehicle",
  ]);
});

test("safe state is false when a Facebook publish lock exists", () => {
  assert.equal(
    safeStateFromGate({
      ...SAFE_GATE,
      protected_state: "1",
      active_locks: "facebook-publish.lock",
    }),
    false,
  );
});

test("blocks new publishing when protected composer state already exists", () => {
  const decision = decidePreflight({
    finalGate: {
      ...SAFE_GATE,
      protected_state: "1",
      active_locks: "facebook-publish.lock",
      registry_protected_live_tabs: "1",
    },
    nodeProbe: { ok: true },
    computerUseProbe: { ok: true },
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.status, "blocked_protected_state");
  assert.equal(decision.resumeRequired, true);
});

test("allows only a verified publisher-owned protected composer to resume", () => {
  const finalGate = {
    ...SAFE_GATE,
    protected_state: "1",
    active_locks: "facebook-publish.lock",
    registry_protected_claims: "2",
  };
  const publisherHandoff = {
    owner: "facebook-ready-publisher",
    handoff: true,
    publishClicked: false,
    backendLiveStatusWritten: false,
    stock: "A10481A",
    albumId: "album-a10481a",
    protectedComposerUrl: "https://www.facebook.com/marketplace/create/vehicle?step=audience",
  };

  assert.deepEqual(validatePublisherHandoff({ handoff: publisherHandoff, gate: finalGate }), {
    ok: true,
    reason: "verified_publisher_handoff",
    handoff: {
      owner: "facebook-ready-publisher",
      stock: "A10481A",
      albumId: "album-a10481a",
      protectedComposerUrl: "https://www.facebook.com/marketplace/create/vehicle?step=audience",
    },
  });
  assert.equal(
    validatePublisherHandoff({
      handoff: { ...publisherHandoff, owner: "facebook-ready-publisher-saturday" },
      gate: finalGate,
    }).ok,
    true,
  );

  const decision = decidePreflight({
    finalGate,
    nodeProbe: { ok: true },
    computerUseProbe: { ok: true },
    resumeOwnPublisherHandoff: true,
    publisherHandoff,
  });

  assert.equal(decision.ok, true);
  assert.equal(decision.status, "ready_to_resume_protected_composer");
  assert.equal(preflightExitCodeForStatus(decision.status), 0);
  assert.equal(decision.resumeHandoff.stock, "A10481A");
});

test("does not let another action lock or an unintentional composer bypass protected state", () => {
  const finalGate = {
    ...SAFE_GATE,
    protected_state: "1",
    active_locks: "facebook-publish.lock,facebook-edit.lock",
  };
  const decision = decidePreflight({
    finalGate,
    nodeProbe: { ok: true },
    computerUseProbe: { ok: true },
    resumeOwnPublisherHandoff: true,
    publisherHandoff: {
      owner: "facebook-ready-publisher",
      handoff: false,
      publishClicked: false,
      backendLiveStatusWritten: false,
      stock: "A10481A",
      albumId: "album-a10481a",
      protectedComposerUrl: "https://www.facebook.com/marketplace/create/vehicle?step=audience",
    },
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.status, "blocked_protected_state");
  assert.match(decision.reason, /handoff_not_intentional/);
  assert.match(decision.reason, /other_workflow_lock_present/);
});

test("blocks when Chrome managed transport probe fails", () => {
  const decision = decidePreflight({
    finalGate: SAFE_GATE,
    nodeProbe: { ok: false, error: "Transport closed" },
    computerUseProbe: { ok: true },
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.status, "blocked_chrome_transport");
});

test("allows explicit DevTools fallback when managed transports fail from a safe state", () => {
  const decision = decidePreflight({
    finalGate: SAFE_GATE,
    nodeProbe: { ok: false, error: "Transport closed" },
    computerUseProbe: { ok: false, error: "Transport closed" },
    allowDevToolsFallback: true,
  });

  assert.equal(decision.ok, true);
  assert.equal(decision.status, "ready_devtools_fallback");
  assert.equal(decision.managedRouteUsable, false);
  assert.equal(decision.devToolsFallbackAllowed, true);
});

test("does not allow DevTools fallback over protected Facebook state", () => {
  const decision = decidePreflight({
    finalGate: {
      ...SAFE_GATE,
      protected_state: "1",
      active_locks: "facebook-publish.lock",
    },
    nodeProbe: { ok: false, error: "Transport closed" },
    computerUseProbe: { ok: false, error: "Transport closed" },
    allowDevToolsFallback: true,
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.status, "blocked_protected_state");
});

test("blocks Computer Use only when the publish path requires it", () => {
  const required = decidePreflight({
    finalGate: SAFE_GATE,
    nodeProbe: { ok: true },
    computerUseProbe: { ok: false, error: "Transport closed" },
    requireComputerUse: true,
  });

  const optional = decidePreflight({
    finalGate: SAFE_GATE,
    nodeProbe: { ok: true },
    computerUseProbe: { ok: false, error: "Transport closed" },
    requireComputerUse: false,
  });

  assert.equal(required.status, "blocked_computer_use_transport");
  assert.equal(optional.status, "ready");
});

test("passes when safe state and direct transport probes are healthy", () => {
  const decision = decidePreflight({
    finalGate: SAFE_GATE,
    nodeProbe: { ok: true },
    computerUseProbe: { ok: true },
  });

  assert.equal(decision.ok, true);
  assert.equal(decision.status, "ready");
});

test("treats a recovered ready state as a successful preflight", () => {
  const decision = decidePreflight({
    finalGate: SAFE_GATE,
    nodeProbe: { ok: true },
    computerUseProbe: { ok: true },
    recoverySummary: { recoveryStatus: "recovered" },
  });

  assert.equal(decision.ok, true);
  assert.equal(decision.status, "ready_after_recovery");
  assert.equal(preflightExitCodeForStatus(decision.status), 0);
});
