# CPC2 remediation pre-change audit

**Date:** 2026-07-22 (America/Halifax)
**Scope:** the isolated remediation worktree, GitHub readiness, `ssh konner` production readiness, SSH/credential posture, local launchd automations, backups, rollback controls, and security-sensitive release settings.
**Mode:** read-only. No push, commit, deploy, credential rotation, GitHub setting change, SSH change, production data change, or schedule change was performed.

## Decision

**NO-GO for external rollout at this time.**

The remediation branch itself is technically healthy, but the release process is not ready to promote it safely. The highest-risk blockers are source-of-truth drift in the local watchdog, a non-empty secret-like watchdog environment entry, a dirty/unpushed branch, an unverified restore path, and the fact that the production Dokploy Compose file is separate from the repository Compose file and would not receive the new runtime limits automatically.

## Branch validation — pass

The isolated worktree is `/Users/konnerhaas/Documents/CPC2-remediation-20260722` on `codex/cpc2-audit-remediation-20260722`, based on deployed commit `f22494464ea3a71e15ec3103e228259b075fa7a4`.

- `npm audit --omit=dev`: **0 vulnerabilities** after updating `sharp` to `^0.35.3` and refreshing the lockfile.
- `npm test`: **94/94 pass**.
- Deterministic browser gate: **19/19 pass** with `PLAYWRIGHT_WORKERS=1`.
- Recovery/router Python tests: **41/41 pass**.
- Syntax checks, YAML parsing, and `git diff --check`: pass.
- New O'Regan's source parser: **103/103 rows**, zero missing VINs or stock numbers, `sourceHealthy=true`.
- High-confidence source-secret scan: no confirmed keys, private keys, or provider-token patterns found.

The branch contains the dependency update, CI audit/CodeQL workflows, artifact ignore rules, portable automation helpers, resource/logging defaults, and release checklist. It is still uncommitted and unpushed.

## Blockers and findings

### PRE-01 — Dirty/unpushed source cannot be deployed (High)

**Location:** `ops/deploy-production.sh:8-21`; branch state; GitHub remote refs.

**Evidence:** the worktree has modified and untracked files, `HEAD` remains `f224944`, the remediation branch has no remote ref, and `origin/main` remains `998896a`. The deploy script explicitly exits when `git status --porcelain` is non-empty.

**Impact:** deploying now would either fail or encourage copying from an unreproducible local state. The new helpers would not be included in a `git archive` until they are committed.

**Required action:** review the final diff, commit the intended files, push the branch, and run CI before any merge or deploy.

### PRE-02 — Launchd still runs the original dirty CPC2 worktree (Critical)

**Location:** `/Users/konnerhaas/Library/LaunchAgents/com.konner.codex.watchdog.plist` and `com.konner.codex.ensure-running.plist`.

**Evidence:** both loaded services use `WorkingDirectory=/Users/konnerhaas/Documents/CPC2`, not the remediation worktree. The original worktree still has tracked modifications and untracked helpers/artifacts.

**Impact:** the live event router/dispatcher behavior can diverge from the branch under review. A GitHub merge or production deployment would not automatically change the local automation runner.

**Required action:** after review, point the runner at a clean, committed release checkout (or install versioned helper scripts into a managed runtime path), then perform a read-only burn-in and verify the worktree is clean.

### PRE-03 — Secret-like watchdog environment entry remains non-empty (Critical)

**Location:** loaded launchd watchdog environment; value intentionally not printed.

**Evidence:** a boolean-only inspection found one `ECOBEE`/`MCP`-like environment name and one non-empty matching value in `launchctl print`. The value was not read, copied, or logged.

**Impact:** a long-running watchdog process still has access to a credential-like value broader than its coordination role. If the token is valid, compromise of that process exposes the integration.

**Required action:** identify the variable owner without printing the value, revoke/rotate the old credential, remove it from watchdog-wide environment inheritance, and inject it only into the narrow process that requires it. Re-run a boolean-only check afterward.

### PRE-04 — GitHub governance is not ready (High)

**Evidence:** `main` returns “Branch not protected”; repository rulesets are empty; Dependabot alerts are disabled; secret scanning is disabled; code scanning has no analysis. The remediation branch is not present on GitHub. The repository is public.

**Impact:** a clean local branch can still be merged or deployed without required review, dependency scanning, or security analysis.

**Required action:** push a draft PR, enable branch protection and required CI, enable Dependabot/secret scanning/CodeQL in repository settings, and only then merge the exact reviewed commit.

### PRE-05 — Production Compose does not include the remediation runtime limits (High)

**Location:** repository `compose.yaml:18-32`; remote `/opt/konner-upload/dokploy/compose.yaml`.

**Evidence:** the branch adds `mem_limit`, CPU/PID limits, `no-new-privileges`, dropped capabilities, and Docker log rotation. The actual production Compose file currently has none of these settings. `docker inspect konner-upload` confirms `memory=0`, `cpus=0`, no PID limit, no capability drop, and no log rotation.

**Impact:** deploying the branch through the existing guarded deploy script will update the image but not apply the runtime hardening. The local Compose change is not a production change by itself.

**Required action:** review and apply the equivalent settings to the remote Dokploy Compose configuration in a separate host change, with a tested capacity profile and rollback copy, before claiming runtime hardening is complete.

### PRE-06 — Restore verification remains identity-inconsistent (High)

**Evidence:** the maintenance timer is enabled/active and its last run succeeded. The newest standard archive is root-owned/private (`0600`), and root-run restore verification succeeds with 1,520 entries. The normal app-user restore check still fails with `Permission denied`.

**Impact:** the documented recovery check does not run as the identity used by the application/container, so backup health cannot be validated through the ordinary operational path.

**Required action:** choose one supported restore-verification identity, document it, test it against a disposable target, and complete an offsite restore drill before deployment.

### PRE-07 — Production lifecycle evidence is still contradictory (High for automation mutations)

**Evidence:** current production health reports 88 albums (48 active, 40 inactive), `facebookLive=1`, `readyToPublish=0`, `staleFacebookVerification=47`, and `needsReview=40`. The app is healthy, but the live-listing evidence is stale/incomplete relative to stored package state.

**Impact:** publish/sold decisions cannot be safely inferred from one count. A rollout that changes automation routing before this is reconciled could cause duplicate publishing or an incorrect sold transition.

**Required action:** reconcile the canonical Facebook evidence contract and freshness before enabling any state-changing publisher or live-sync behavior.

### PRE-08 — Host network and patch posture need a separate change (Medium)

**Evidence:** `sshd` has password authentication disabled, root login restricted to keys, X11/gateway forwarding disabled, and `AllowTcpForwarding yes`. Host `INPUT` policy is default ACCEPT with targeted Docker/Swarm drops; eight host packages are upgradeable, including Docker/containerd and Chrome.

**Impact:** the SSH baseline is reasonable, but forwarding and broad host firewall defaults deserve an intentional policy decision; patching Docker requires a maintenance window.

**Required action:** decide whether TCP forwarding is needed, verify the cloud firewall separately, schedule host updates, then re-run health and rollback checks.

### PRE-09 — New CI/security workflows are not yet proven on GitHub (Medium)

**Location:** `.github/workflows/ci.yml:25-38`; `.github/workflows/codeql.yml:18-34`.

**Evidence:** local YAML parsing and local tests pass, but the workflows have not run from the remediation branch. Actions use mutable major tags (`@v4`, `@v3`) rather than reviewed commit SHAs.

**Impact:** CI may expose an action/runtime incompatibility only after push, and mutable action tags weaken supply-chain reproducibility.

**Required action:** push as a draft PR, inspect the actual run logs, pin third-party actions to reviewed SHAs where practical, and require the checks in branch protection.

## Current production positives

- `/healthz` is HTTP 200; public root redirects to `/login`; unauthenticated inventory returns 401.
- Both production SQLite databases return `quick_check=ok` and `integrity_check=ok`.
- Maintenance timer completed successfully.
- Standard backups are private and recent.
- SSH password authentication is disabled and local SSH private-key permissions are `0600`.
- Current public headers include CSP, `nosniff`, frame denial, same-origin referrer policy, and restrictive permissions policy.

## Safe rollout order

1. Rotate/remove the watchdog credential-like environment entry.
2. Resolve the lifecycle evidence mismatch without mutating Facebook.
3. Finalize the remediation diff; commit only intended files in the isolated branch.
4. Push a draft PR and wait for CI plus CodeQL results.
5. Enable branch protection/scanning and complete review.
6. Apply remote Compose/runtime hardening and fix/document restore identity; complete an offsite restore drill.
7. Deploy the exact merged SHA using `ops/deploy-production.sh` during a maintenance window.
8. Verify release SHA, Docker health/restarts/limits/logging, public headers, database integrity, operations summary, and automation runner provenance.

## Non-actions

This audit did not commit or stage the branch, push to GitHub, change GitHub settings, deploy production, rotate credentials, alter SSH/firewall rules, delete stale artifacts, change launchd schedules, or mutate Facebook/CarPostClub data.
