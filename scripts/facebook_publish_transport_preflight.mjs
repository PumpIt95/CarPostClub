#!/usr/bin/env node
import { spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WORKSPACE = "/Users/konnerhaas/Documents/CPC2";
const CHROME_LOAD_GUARD_SCRIPTS = "/Users/konnerhaas/.codex/skills/chrome-load-guard/scripts";
const PRESSURE_GATE = path.join(CHROME_LOAD_GUARD_SCRIPTS, "pressure_gate.sh");
const PRESSURE_RELIEF = path.join(CHROME_LOAD_GUARD_SCRIPTS, "pressure_relief.sh");
const TAB_REGISTRY = path.join(CHROME_LOAD_GUARD_SCRIPTS, "tab_registry.sh");
const TRANSPORT_RECOVERY = path.join(CHROME_LOAD_GUARD_SCRIPTS, "codex_browser_transport_recovery.sh");
const TRANSPORT_MARKER = path.join(WORKSPACE, ".browser_transport_recovery_last.json");

const OK_GATE_CODES = new Set([0, 10, 20]);
const EXIT_CODES = {
  ready: 0,
  ready_devtools_fallback: 0,
  blocked_protected_state: 20,
  blocked_pressure: 21,
  blocked_chrome_transport: 22,
  blocked_computer_use_transport: 23,
  preflight_error: 24,
};

export function parseKeyValueOutput(text) {
  const values = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_.-]+)=(.*)$/.exec(line);
    if (!match) continue;
    values[match[1]] = match[2];
  }
  return values;
}

export function extractSection(text, name) {
  const begin = `${name}_begin`;
  const end = `${name}_end`;
  const lines = String(text || "").split(/\r?\n/);
  const start = lines.indexOf(begin);
  if (start === -1) return [];
  const finish = lines.indexOf(end, start + 1);
  const section = lines.slice(start + 1, finish === -1 ? undefined : finish);
  return section.filter((line) => line && line !== "none");
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function safeStateFromGate(gate = {}) {
  const activeLocks = gate.active_locks || "none";
  return (
    gate.protected_state === "0" &&
    activeLocks === "none" &&
    numberValue(gate.registry_active_claims) === 0 &&
    numberValue(gate.registry_protected_claims) === 0 &&
    numberValue(gate.registry_handoff_claims) === 0 &&
    numberValue(gate.registry_protected_live_tabs) === 0
  );
}

export function hasProtectedWorkflowState(gate = {}) {
  return (
    gate.protected_state === "1" ||
    (gate.active_locks || "none") !== "none" ||
    numberValue(gate.registry_active_claims) > 0 ||
    numberValue(gate.registry_protected_claims) > 0 ||
    numberValue(gate.registry_handoff_claims) > 0 ||
    numberValue(gate.registry_protected_live_tabs) > 0
  );
}

function pressureRank(pressure) {
  if (pressure === "severe") return 2;
  if (pressure === "high") return 1;
  return 0;
}

function probeOk(probe) {
  if (!probe || probe.ok !== true) return false;
  const serialized = JSON.stringify(probe);
  return !/Transport closed/i.test(serialized);
}

export function decidePreflight({
  finalGate,
  gateExitCode = 0,
  nodeProbe,
  computerUseProbe,
  requireComputerUse = true,
  allowDevToolsFallback = false,
  recoverySummary,
} = {}) {
  const gate = finalGate || {};
  const chromeProbeOk = probeOk(nodeProbe);
  const computerProbeOk = probeOk(computerUseProbe);
  const protectedWorkflow = hasProtectedWorkflowState(gate);

  if (!OK_GATE_CODES.has(gateExitCode)) {
    return {
      ok: false,
      status: "preflight_error",
      reason: "pressure_gate_failed",
      nextAction: "Fix the local pressure gate before opening Facebook.",
      chromeProbeOk,
      computerProbeOk,
    };
  }

  if (protectedWorkflow) {
    return {
      ok: false,
      status: "blocked_protected_state",
      reason: "existing_facebook_publish_state",
      nextAction:
        "Resume or deliberately release the existing protected Marketplace composer before opening another composer.",
      resumeRequired: true,
      chromeProbeOk,
      computerProbeOk,
    };
  }

  if (pressureRank(gate.chrome_pressure) >= 2) {
    return {
      ok: false,
      status: "blocked_pressure",
      reason: "chrome_pressure_severe",
      nextAction:
        "Run Chrome pressure relief/recovery while no protected Facebook state is active, then retry the preflight.",
      chromeProbeOk,
      computerProbeOk,
    };
  }

  const managedRouteBlocked = !chromeProbeOk || (requireComputerUse && !computerProbeOk);
  if (allowDevToolsFallback && managedRouteBlocked) {
    return {
      ok: true,
      status: "ready_devtools_fallback",
      reason: "managed_transport_failed_devtools_fallback_allowed",
      nextAction:
        "Use the DevTools MCP fallback route only after a read-only Facebook burn-in; do not use the poisoned Chrome plugin/Computer Use route for composer work in this run.",
      chromeProbeOk,
      computerProbeOk,
      managedRouteUsable: false,
      devToolsFallbackAllowed: true,
    };
  }

  if (!chromeProbeOk) {
    return {
      ok: false,
      status: "blocked_chrome_transport",
      reason: "chrome_control_probe_failed",
      nextAction:
        "Run the transport recovery pack from a safe state; if direct probes pass but managed tools still fail, continue from a fresh Codex session.",
      chromeProbeOk,
      computerProbeOk,
    };
  }

  if (requireComputerUse && !computerProbeOk) {
    return {
      ok: false,
      status: "blocked_computer_use_transport",
      reason: "computer_use_probe_failed",
      nextAction:
        "Recover Computer Use before upload work that may need a native picker or visible UI fallback.",
      chromeProbeOk,
      computerProbeOk,
    };
  }

  return {
    ok: true,
    status:
      recoverySummary?.recoveryStatus && recoverySummary.recoveryStatus !== "diagnosed"
        ? "ready_after_recovery"
        : "ready",
    reason: "transport_preflight_passed",
    nextAction: "Safe to continue to the read-only Facebook burn-in before acquiring facebook-publish.lock.",
    chromeProbeOk,
    computerProbeOk,
  };
}

function timestampForPath(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function parseArgs(argv) {
  const options = {
    workspace: WORKSPACE,
    runDir: "",
    requireComputerUse: true,
    applyRecovery: true,
    allowDevToolsFallback: false,
    jsonOnly: false,
    timeoutMs: 150000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--workspace") {
      options.workspace = argv[++index];
    } else if (arg === "--run-dir") {
      options.runDir = argv[++index];
    } else if (arg === "--no-computer-use-required") {
      options.requireComputerUse = false;
    } else if (arg === "--no-apply-recovery") {
      options.applyRecovery = false;
    } else if (arg === "--allow-devtools-fallback") {
      options.allowDevToolsFallback = true;
    } else if (arg === "--json") {
      options.jsonOnly = true;
    } else if (arg === "--timeout-ms") {
      options.timeoutMs = Number(argv[++index]);
    } else if (arg === "-h" || arg === "--help") {
      options.help = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!options.runDir) {
    options.runDir = path.join(options.workspace, "automation-runs", `facebook-publish-transport-preflight-${timestampForPath()}`);
  }

  return options;
}

function usage() {
  return `Usage:
  node scripts/facebook_publish_transport_preflight.mjs [--run-dir DIR] [--json]
      [--no-computer-use-required] [--no-apply-recovery]
      [--allow-devtools-fallback]

Runs the non-destructive Chrome/Facebook publish preflight before acquiring
facebook-publish.lock or opening a Marketplace composer. It writes a summary
and exits non-zero when protected Facebook state, unsafe pressure, or transport
probe failures would make publishing unsafe. With --allow-devtools-fallback,
managed Chrome/Computer Use probe failures from an otherwise safe state return
ready_devtools_fallback so the caller can switch to an explicitly authorized
DevTools MCP route instead of retrying the poisoned managed route.`;
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists(filePath) {
  if (!(await pathExists(filePath))) return null;
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    return { ok: false, parseError: String(error) };
  }
}

function runCommand(command, args, { cwd, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env: process.env });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2000).unref();
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ command, args, exitCode: 127, stdout, stderr: `${stderr}${String(error)}`, timedOut });
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ command, args, exitCode: timedOut ? 124 : exitCode ?? 0, stdout, stderr, timedOut });
    });
  });
}

async function writeCommandArtifacts(runDir, name, result) {
  await writeFile(path.join(runDir, `${name}.stdout.txt`), result.stdout || "");
  await writeFile(path.join(runDir, `${name}.stderr.txt`), result.stderr || "");
  await writeFile(
    path.join(runDir, `${name}.command.json`),
    JSON.stringify(
      {
        command: result.command,
        args: result.args,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
      },
      null,
      2,
    ) + "\n",
  );
}

function needsPressureRelief(gate) {
  return (
    gate.chrome_pressure === "high" ||
    gate.chrome_pressure === "severe" ||
    gate.registry_cleanup_needed === "1" ||
    gate.chrome_resource_watch === "1"
  );
}

async function writeOkMarker({ runDir, finalGate, decision }) {
  const marker = {
    checkedAt: new Date().toISOString(),
    managedTransportStatus:
      decision.status === "ready_devtools_fallback" ? "devtools_fallback" : "ok",
    recoveryStatus: decision.status,
    runDir,
    chromePressure: finalGate.chrome_pressure || "unknown",
    protectedState: finalGate.protected_state || "unknown",
    activeLocks: finalGate.active_locks || "none",
    nextAction: decision.nextAction,
  };
  await writeFile(TRANSPORT_MARKER, JSON.stringify(marker, null, 2) + "\n");
}

async function writeBlocker(runDir, summary) {
  if (summary.decision.ok) return;
  const lines = [
    "# Facebook publish transport preflight blocked",
    "",
    `Status: ${summary.decision.status}`,
    `Reason: ${summary.decision.reason}`,
    `Next action: ${summary.decision.nextAction}`,
    "",
    `Chrome pressure: ${summary.finalGate.chrome_pressure || "unknown"}`,
    `Protected state: ${summary.finalGate.protected_state || "unknown"}`,
    `Active locks: ${summary.finalGate.active_locks || "none"}`,
    `Chrome probe OK: ${summary.decision.chromeProbeOk ? "yes" : "no"}`,
    `Computer Use probe OK: ${summary.decision.computerProbeOk ? "yes" : "no"}`,
  ];
  if (summary.protectedTabs.length > 0) {
    lines.push("", "Protected tabs:");
    for (const tab of summary.protectedTabs) lines.push(`- ${tab}`);
  }
  lines.push("");
  await writeFile(path.join(runDir, "facebook-publish-transport-blocker.md"), `${lines.join("\n")}\n`);
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return 0;
  }

  await mkdir(options.runDir, { recursive: true });

  const beforeGateResult = await runCommand(PRESSURE_GATE, ["--safe-renice"], {
    cwd: options.workspace,
    timeoutMs: 45000,
  });
  await writeCommandArtifacts(options.runDir, "pressure-gate-before", beforeGateResult);
  let finalGateResult = beforeGateResult;
  let pressureReliefResult = null;

  const beforeGate = parseKeyValueOutput(beforeGateResult.stdout);
  const protectedTabs = extractSection(beforeGateResult.stdout, "protected_tabs");

  const snapshotResult = await runCommand(TAB_REGISTRY, ["snapshot", "--json"], {
    cwd: options.workspace,
    timeoutMs: 45000,
  });
  await writeCommandArtifacts(options.runDir, "tab-registry-snapshot", snapshotResult);

  if (OK_GATE_CODES.has(beforeGateResult.exitCode) && safeStateFromGate(beforeGate) && needsPressureRelief(beforeGate)) {
    pressureReliefResult = await runCommand(PRESSURE_RELIEF, ["--apply"], {
      cwd: options.workspace,
      timeoutMs: 90000,
    });
    await writeCommandArtifacts(options.runDir, "pressure-relief", pressureReliefResult);
    finalGateResult = await runCommand(PRESSURE_GATE, ["--safe-renice"], {
      cwd: options.workspace,
      timeoutMs: 45000,
    });
    await writeCommandArtifacts(options.runDir, "pressure-gate-after-relief", finalGateResult);
  }

  const finalGate = parseKeyValueOutput(finalGateResult.stdout);
  const finalProtectedTabs = extractSection(finalGateResult.stdout, "protected_tabs");
  const recoveryRunDir = path.join(options.runDir, "transport-recovery");
  const recoveryArgs = ["--run-dir", recoveryRunDir];
  if (options.applyRecovery) recoveryArgs.push("--apply");
  const recoveryResult = await runCommand(TRANSPORT_RECOVERY, recoveryArgs, {
    cwd: options.workspace,
    timeoutMs: options.timeoutMs,
  });
  await writeCommandArtifacts(options.runDir, "transport-recovery", recoveryResult);

  const recoverySummary = await readJsonIfExists(path.join(recoveryRunDir, "summary.json"));
  const nodeProbe = await readJsonIfExists(path.join(recoveryRunDir, "direct-node-repl-probe.json"));
  const computerUseProbe = await readJsonIfExists(path.join(recoveryRunDir, "direct-computer-use-probe.json"));
  const previousMarker = await readJsonIfExists(TRANSPORT_MARKER);

  const decision = decidePreflight({
    finalGate,
    gateExitCode: finalGateResult.exitCode,
    nodeProbe,
    computerUseProbe,
    requireComputerUse: options.requireComputerUse,
    allowDevToolsFallback: options.allowDevToolsFallback,
    recoverySummary,
  });

  const summary = {
    checkedAt: new Date().toISOString(),
    runDir: options.runDir,
    recoveryRunDir,
    options: {
      requireComputerUse: options.requireComputerUse,
      applyRecovery: options.applyRecovery,
      allowDevToolsFallback: options.allowDevToolsFallback,
    },
    decision,
    beforeGate,
    finalGate,
    protectedTabs: finalProtectedTabs.length > 0 ? finalProtectedTabs : protectedTabs,
    pressureRelief: pressureReliefResult
      ? {
          exitCode: pressureReliefResult.exitCode,
          timedOut: pressureReliefResult.timedOut,
        }
      : null,
    recovery: {
      exitCode: recoveryResult.exitCode,
      timedOut: recoveryResult.timedOut,
      summary: recoverySummary,
    },
    probes: {
      chromeNodeRepl: nodeProbe,
      computerUse: computerUseProbe,
    },
    previousTransportMarker: previousMarker,
  };

  await writeFile(path.join(options.runDir, "facebook-publish-transport-preflight.json"), JSON.stringify(summary, null, 2) + "\n");
  await writeBlocker(options.runDir, summary);

  if (decision.ok) {
    await writeOkMarker({ runDir: options.runDir, finalGate, decision });
  }

  if (options.jsonOnly) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`status=${decision.status}`);
    console.log(`ok=${decision.ok ? 1 : 0}`);
    console.log(`reason=${decision.reason}`);
    console.log(`run_dir=${options.runDir}`);
    console.log(`summary=${path.join(options.runDir, "facebook-publish-transport-preflight.json")}`);
    console.log(`chrome_pressure=${finalGate.chrome_pressure || "unknown"}`);
    console.log(`protected_state=${finalGate.protected_state || "unknown"}`);
    console.log(`active_locks=${finalGate.active_locks || "none"}`);
    console.log(`chrome_probe_ok=${decision.chromeProbeOk ? 1 : 0}`);
    console.log(`computer_use_probe_ok=${decision.computerProbeOk ? 1 : 0}`);
    console.log(`next_action=${decision.nextAction}`);
  }

  return EXIT_CODES[decision.status] ?? 1;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error instanceof Error ? error.stack : String(error));
      process.exitCode = 1;
    },
  );
}
