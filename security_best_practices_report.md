# CarPostClub End-to-End Audit

Audit date: 2026-07-14 America/Halifax (production checks completed around 2026-07-15 01:00 UTC)

This is a read-only production audit plus two local, reviewable fixes. No Facebook fields were changed, no composer was opened, no Facebook lock was cleared, no database rows were deleted, and no production deployment or restart was performed.

## 1. Executive summary

The website is live, healthy, authenticated, and running the intended inventory schedule: 9:00 a.m. to 7:00 p.m. Halifax time, every 10 minutes, with overnight checks disabled. The production container has zero restarts, healthy Docker status, working HTTPS, S3-backed media storage, and about 14 GB of free disk.

The main issue is operational rather than a current website outage: the daily maintenance service has failed on four consecutive runs because it cannot read one root-owned automation state file while building the backup. Therefore the timer is enabled, but the latest successful backup is currently from the deployment rather than daily maintenance. I fixed the scripts locally on this audit branch; the fix is not deployed.

The other important risks are: the deployed commit is one commit ahead of GitHub `main`, existing backup archives are world-readable and contain sensitive state, GitHub `main` has no branch protection, static PWA assets are uncompressed and always `no-cache`, the production container has no explicit CPU/memory/PID limits, and there is no evidence of an off-server backup. The production databases pass integrity checks. The local workspace also holds about 4 GB of automation/package artifacts, but the safe cleanup dry-run found no deletable items because current/proof directories are protected.

## 2. Systems inspected

- Local repository: `/Users/konnerhaas/Documents/CPC2`.
- GitHub repository: `PumpIt95/CarPostClub`.
- Local branch and working tree, Git history, ignored files, Docker context rules, package lock, tests, and deployment scripts.
- GitHub Actions, open pull requests, branch protection/rulesets, and recent CI runs.
- Production through `ssh konner`: Dokploy, Traefik, CarPostClub container, ports, firewall, SSH settings, Docker health, logs, disk, memory, state files, SQLite databases, backups, and systemd maintenance timer/service.
- Production authenticated APIs: inventory, albums, normalized album lifecycle, operations summary, push configuration, chat, and public health/domain behavior.
- All 21 local automation definitions, policy, loaded launch agents, shared Facebook lane, evidence registry, all 23 CPC skills, and protected/archived coordination artifacts.
- Node test suite, Playwright suite, syntax checks, `npm audit`, backup restore validation, inventory retention dry-run, restart safety check, production SQLite integrity/index/schema checks, Docker runtime/resource metadata, OS update state, TLS certificate dates, and local artifact-retention dry-run.

## 3. Safety boundary and actions taken

The audit stayed read-only against application data and Facebook. The only server-side write was cleanup of the temporary directory created by this audit's non-destructive restore extraction. No production state, media, account, Facebook listing, or automation lock was changed.

Local changes were made only on `codex/cpc-audit-20260714` and committed separately. The local Docker CLI is unavailable, so I did not build a local image. Production's already-running image and health/release metadata were inspected instead.

## 4. Findings by severity

### High

**AUDIT-001 — Daily maintenance is failing.** `carpostclub-maintenance.timer` is enabled and active, but `carpostclub-maintenance.service` failed on July 11, 12, 13, and 14 with `EACCES` while reading `/var/lib/konner-upload/telegram-konner-receive-state.json` (`0600 root:root`). The service is intended to prune snapshot history and create a verified state backup. The latest production backup is therefore not being refreshed by the daily job.

**AUDIT-002 — Existing backup archives are too permissive.** The latest archive is `0644 root:root`, while its contents include `auth-users.json`, `push-vapid-keys.json`, `shortcut-tokens.json`, and other private state. The archive is not public through HTTPS, but an app/container compromise or another local account with state-root access could read it. Future deployment-created archives are now protected by `umask 077` locally; existing production archives were intentionally not changed during this audit.

### Medium

**AUDIT-003 — Production is ahead of GitHub `main`.** Production serves commit `8e05fca`, local `main` also contains it, but `origin/main` is still `5a6499c`. If the laptop checkout were lost, the exact deployed commit would not be recoverable from GitHub `main`.

**AUDIT-004 — GitHub `main` is not protected.** GitHub reports no branch protection and no repository rulesets. CI exists and the latest remote `main` run passed, but GitHub is not requiring CI, pull requests, or review before a direct push to `main`.

**AUDIT-005 — Backups are local-only from the evidence available.** Backups are stored on the same VPS as the application. The archive listing and extraction checks pass, but I found no verified off-server or encrypted backup destination.

**AUDIT-006 — Static PWA delivery is slower than necessary.** Production serves `app.js` at 191,407 bytes and `styles.css` at 72,168 bytes with no `Content-Encoding` and `Cache-Control: no-cache`. The service worker improves repeat visits after installation, but first loads and revalidation are larger/slower than needed. Draft PR #12 already proposes asset compression/versioning, but it is open and based on a non-main branch.

**AUDIT-007 — Docker log rotation is not configured.** The production container uses Docker's `json-file` driver with no `max-size` or `max-file` setting. The current log is only 413 bytes, so this is not an immediate disk problem, but an unexpected error loop could eventually consume disk.

**AUDIT-008 — JSON state coordination is process-local.** The server serializes JSON writes with in-process promises, and the documentation correctly warns not to run a second writer against the same state root (`server.js:361-377`, `server.js:5841-5855`, `server.js:7623-7635`, `server.js:9647-9651`, `README.md:82-86`). This is safe for the current single app container, but it is a scaling/recovery constraint.

**AUDIT-012 — Production container resource guardrails are not explicit.** Docker reports the app running as non-root UID 995:982, but with unlimited memory, CPU, and PID settings (`0`, `0`, and `<no value>`), a writable root filesystem, no dropped capabilities, and no `no-new-privileges` security option. This is not a current outage—the app is using about 132 MiB—but a runaway request, image-processing job, or logging loop could compete with Dokploy/Postgres/Redis or consume host resources. Add conservative limits and hardening only after load testing and a rollback plan.

### Low / defense-in-depth

**AUDIT-009 — CSP still permits `unsafe-inline`.** The custom security headers are strong overall, but `script-src` and `style-src` allow inline code (`server.js:1970-1988`). This is currently needed by the existing UI/server-rendered pages, but nonce/hash-based CSP would provide stronger XSS protection after a deliberate frontend refactor.

**AUDIT-010 — Requests without Origin and Referer are allowed.** The cross-origin defense rejects explicit foreign origins/referers, but treats a request with neither header as same-origin (`server.js:2004-2017`). SameSite cookies, authentication, and the other checks reduce practical browser CSRF risk; rejecting or separately authenticating headerless unsafe requests would be stronger defense in depth.

**AUDIT-011 — Test fixture passwords are committed.** The test suite contains obvious test-only passwords in `test/upload-app.test.mjs`. No real production secret pattern was found in tracked files or history, and the test directory is excluded from production images. This is a hygiene item, not a production credential exposure.

**AUDIT-013 — Local automation/package artifacts need an explicit retention policy.** The workspace currently uses about 3.4 GB in `automation-runs`, 463 MB in `facebook-post-packages-current`, 98 MB in `tmp`, and smaller report/artifact directories. The safe cleanup tool reports zero eligible deletions because current-run markers and proof artifacts are protected. No files were deleted; this is a local storage/maintenance issue, not production data loss.

**AUDIT-014 — A small number of active VINs appear in more than one dealership scope.** The production database has two VINs present under two active dealership records, with different stock numbers/prices; other repeated VIN rows are historical removals. This can be legitimate dealership transfer/source behavior, and there is no SQLite corruption or duplicate primary key. It remains a matching/publishing risk unless the downstream policy consistently prefers the current dealership/source record.

**AUDIT-015 — Three host packages are awaiting upgrade.** `unattended-upgrades` is enabled and active, and the host certificate is valid through August 28, 2026, but `containerd.io`, `python3-software-properties`, and `software-properties-common` have newer available versions. This is a low-priority maintenance item; it should be scheduled with a container-health check and rollback awareness.

## 5. User-visible functionality

The public domain redirects unauthenticated visitors to `/login`; `/healthz` responds successfully; authenticated API endpoints respond; PWA, gallery, upload, chat, push, and mobile-share behavior are covered by passing tests. Full-resolution share/download behavior was not changed.

Production currently reports 74 album packages: 43 source-active and 31 source-removed/inactive. All 74 have media, 43 have marketplace drafts, and 2 gallery notifications are unread in the current read-only capture. Source-removed packages remain visible/inactive as designed.

The price-change path is covered end to end: an inventory price change updates album metadata, records the previous price, regenerates an upload-pool marketplace description or marks a protected/manual copy stale, and queues dealership-targeted push notifications. The regression test also confirms duplicate price-change runs do not send a second notification.

## 6. API, inventory, and Facebook lifecycle

The O'Regan's snapshot schedule is confirmed in production as:

- `CARPOSTCLUB_OREGANS_INVENTORY_SNAPSHOT_INTERVAL_MS=600000` — every 10 minutes.
- Day window: 09:00 through 19:00, `America/Halifax`.
- Off-hours disabled.
- Snapshot inventory type: used vehicles (`2`).

The default helper query intentionally fetches dealership 15 only, so its 36-car result must not be compared directly with all four dealerships. The snapshot database shows current type-2 counts of 36, 36, 66, and 27 across the four configured dealership scopes.

The operations summary reports `readyToPublish=0`, `staleFacebookVerification=43`, `facebookLive=0`, and `needsReview=31`. The normalized albums endpoint reports 60 stored Facebook-live records, but all 74 Facebook evidence records are stale. Those numbers are not contradictory: 60 is historical stored evidence; the operations summary correctly refuses to treat it as fresh verification.

The database audit found two VINs represented by two currently-present dealership records, with different dealership/stock/price values. This is consistent with a transfer or cross-dealership feed condition rather than a duplicate SQLite key; VIN-first matching must continue to keep dealership scope and current presence in the decision.

The customer-contact automations remain paused. No Chrome/Facebook live-listing audit was performed because fresh Facebook verification would require taking control of the logged-in browser and the current policy intentionally pauses customer-contact work. This is recorded as an unverified item, not treated as a website failure.

## 7. Security review

Positive controls found:

- Production fails closed when auth/session configuration is absent or placeholder-like.
- Passwords use bcrypt for account records; sessions are HMAC-signed, HttpOnly, SameSite=Lax, and Secure in production.
- Unsafe methods have same-origin checks; admin routes require admin role.
- Uploads have file-count/size limits and image/video byte validation through Sharp/header checks (`server.js:6963-7048`).
- Album and filename path traversal is constrained by cleaned IDs and resolved paths.
- `X-Content-Type-Options`, `X-Frame-Options`, permissions policy, referrer policy, and a restrictive baseline CSP are present.
- The production process runs as non-root UID 995:982; SSH password login is disabled and root password login is disabled.
- `npm audit --omit=dev --audit-level=moderate` found 0 vulnerabilities.

The highest security action is to repair backup permissions and ensure all new archives are private. The next security improvement should be an explicit off-server encrypted backup policy, followed by tightening CSP and adding an edge login rate limit in front of the existing per-process limiter (`README.md:73-75`).

## 8. Docker, Dokploy, and deployment

Production is running a healthy `konner-upload` image with release ID `20260714T1635Z-inventory-removal-grace-8e05fca`, source commit `8e05fca`, and zero restarts. The image has a Docker health check and production media storage is S3-backed.

Dokploy and Traefik are healthy. The app port is bound to loopback; HTTPS is exposed through Traefik. Dokploy's management port is externally listening at the socket layer but the installed `DOCKER-USER` rules drop non-loopback access. The host firewall service is enabled/active, and effective SSH settings show key-only authentication, no password login, and no X11 forwarding.

The deployment script is appropriately guarded: it refuses a dirty tree, creates a verified backup, builds from an exact Git commit, checks image health and release provenance, performs maintenance, recreates the service, and has an automatic previous-compose rollback path (`ops/deploy-production.sh`, `ops/deploy-production-remote.sh`). Rollback should still be followed by a manual health/release check because the rollback trap attempts recovery but does not independently prove the old service is healthy.

The application image is listed at about 460 MB; Dokploy, Postgres, Redis, and Traefik images account for most of the remaining image storage. The app container is non-root and not privileged, but Docker reports no explicit memory/CPU/PID limits, a writable root filesystem, no dropped capabilities, and `json-file` logging with an empty rotation config. These settings are acceptable for the current low-load state but should be hardened deliberately, not changed during this audit.

## 9. Production/server health

At audit time:

- App: healthy, no restart loop, no critical operations, low host load.
- Host disk: 63% used, about 14.2 GB available.
- App container memory: about 132 MiB of 3.7 GiB.
- State root: about 1.2 GB; local upload media about 25 MB because S3 is enabled.
- Recent app logs: 3 lines, no error-like lines; current low volume does not remove the need for rotation.
- Public domain: login redirect and health endpoint work; unauthenticated inventory access correctly returns 401.
- OS patching: `unattended-upgrades` is enabled/active; three non-security package updates are available for the next maintenance window.
- HTTPS: the public certificate chains to Let's Encrypt and is valid until August 28, 2026.

## 10. Database, storage, backup, restore, and retention

The inventory snapshot SQLite database is about 198.8 MB with 125,677 raw items, 847 runs, and 1,045 current vehicle records. It uses WAL mode and busy timeouts. There are 846 completed runs and 1 failed run; the newest completed snapshot was July 14 at 21:50 UTC.

Both production SQLite databases passed read-only `PRAGMA integrity_check` and `PRAGMA quick_check`. The inventory database has primary-key indexes plus indexes for observed time, scope, current-seen, and last-seen queries; the marketplace description database has its album primary key and input-hash index. The marketplace store contains 91 non-empty, valid JSON records with distinct input hashes. The inventory vehicle table has 846 present and 199 removed records, with no blank VIN or stock values. The two active cross-dealership VIN repeats described above should be reviewed as source/business data, not repaired by deleting rows.

The 14-day retention dry-run found 3,279 item rows and 16 run rows eligible at the audit clock. No rows were deleted because the command was explicitly run without `--apply`. Daily maintenance is supposed to prune those rows and preserve lifecycle/current references.

There are 15 matching backup archives, consistent with a retain-14 policy plus the newly-created current archive. The latest archive passed both safe tar listing validation and a temporary extraction check: 1,299 archive entries and 1,112 extracted files. The temporary extraction directory was removed after validation.

Local retention evidence is separate from production: the audit workspace contains roughly 3.4 GB of `automation-runs`, 463 MB of current Facebook post packages, 98 MB of temporary files, and smaller artifact/report folders. `python3 scripts/cleanup_automation_artifacts.py` returned a safe dry-run of zero deletions because protected current/proof markers prevent automatic cleanup. No local artifact was deleted; a future cleanup pass needs an explicit retention decision.

## 11. Automation, skills, locks, and ownership

| Area | Result |
|---|---|
| Automation definitions | 21 found; structural audit passed with 0 failures |
| Active scheduled workload | 46 runs/week: 3 coordination, 30 state-changing, 7 read-only, 6 readiness |
| Customer contact | Inbox scanner, inbox replies, morning digest, Telegram watcher, and all pre-close digests paused |
| Redundant pressure guard | Paused; launchd watchdog is the owner |
| Skills | 23 found; 3,468 lines; audit passed with 0 failures |
| Facebook lane | No live `facebook-browser` lane lock at audit time |
| Protected artifacts | Only archived/stale lock evidence was found; it was not cleared or modified |

The current run-directory marker files point to historical completed runs, not live leases. They should be treated as stale evidence pointers and reviewed during routine artifact cleanup, but I did not delete them because they are part of the protected automation evidence trail.

## 12. Performance and reliability

The largest easy performance opportunity is the app shell: 191 KB JavaScript and 72 KB CSS are served uncompressed and with no-cache headers (`server.js:450-456`; `package.json` has no compression middleware). The service worker uses stale-while-revalidate for static assets, so repeat PWA visits benefit after install. The safest next improvement is to finish/review the existing asset compression/versioning PR rather than redesigning the photo download path.

Reliability is good inside the single-container design: SQLite writes use transactions/WAL, uploads have per-vehicle serialization, deployment health is release-aware, and the restart check blocks active operations. The main reliability gaps are the failed maintenance service, the documented single-writer JSON-state constraint, and the absence of explicit container resource ceilings.

Local storage is the bigger efficiency concern on this computer than on the VPS: approximately 4 GB is in automation/package working directories, while the cleanup tool deliberately finds no safe automatic deletions. This protects Facebook evidence and current work, but it means storage will not reclaim itself without a reviewed retention policy.

## 13. Repository, GitHub, Dokploy, and production drift

- Local audit branch: `codex/cpc-audit-20260714`.
- Local branch before audit: `main`, one commit ahead of `origin/main`.
- Production source: local commit `8e05fca`.
- GitHub `main`: `5a6499c`; the production commit is not on remote `main`.
- GitHub: 5 open pull requests, several drafts; PR #12 is the PWA performance/snapshot-retention draft and is not based on `main`.
- GitHub CI: latest remote `main` run passed for `5a6499c`.
- Deployment path: GitHub has CI but no automatic production-deploy workflow; production is updated by the guarded local `ops/deploy-production.sh`/SSH release process, which packages the exact `git archive HEAD` and mounts production `.env` separately.
- Local Docker CLI: unavailable, so a local image build was not independently reproduced.
- Dokploy production image/release: healthy and matches local deployed commit.

## 14. Tests, fixes, commits, and deployment/rollback

Verification completed:

- 92 Node tests passed, including regression coverage for generated export exclusions and protected maintenance/backup execution.
- 19 Playwright browser tests passed.
- JavaScript syntax checks passed.
- Shell syntax and `git diff --check` passed.
- `npm audit` reported 0 vulnerabilities.
- Production health/API probes passed.
- Production restart-safety check passed.
- Backup listing and extraction restore checks passed.
- Inventory retention dry-run passed without applying deletions.
- Production SQLite integrity/quick checks and schema/index inspection passed; marketplace description JSON validation passed.

Local fixes committed separately:

1. `fd9941b` — `Harden generated album export exclusions`: ignores `current-albums-normalized-*.json` in Git and Docker. This protects the existing generated 85 KB export from accidental tracking or image inclusion.
2. `a7630b3` — `Repair maintenance backup permissions`: runs maintenance reads/backups as container root and sets `umask 077` for deployment-created archives.
3. `b93ddfb` — `Add audit regression coverage`: verifies the two safe local fixes remain present.

Nothing from this branch has been pushed or deployed. A safe deployment sequence is: review/merge or intentionally push this branch, run the full tests, confirm a fresh backup is readable and private, run `ops/deploy-production.sh` from a clean reviewed worktree, then verify `/healthz`, `/api/version`, Docker health, timer/service status, and authenticated inventory/albums. If health or release provenance fails, the deployment script restores the prior compose image; then independently verify the rollback release and backup age.

## 15. Remaining blockers, next actions, and unverified items

Before treating the system as fully finished:

1. Deploy or manually apply the maintenance permission fix, then confirm one successful `carpostclub-maintenance.service` run and a new private archive.
2. Tighten permissions on existing production backup archives after confirming the backup/restore procedure.
3. Push/reconcile `8e05fca` to the intended GitHub branch and protect `main` with required CI.
4. Choose an encrypted off-server backup destination and perform a real restore drill.
5. Add Docker log rotation and consider `no-new-privileges`/capability reduction after testing.
6. Review PR #12's compression/versioning work against current `main`; do not merge it blindly because its base is stale.
7. When customer-contact/Facebook work is explicitly reactivated, perform fresh seller-listing verification before any Facebook mutation.
8. Decide how long local automation runs and Facebook post packages should be retained; review protected markers before any cleanup apply run.
9. Schedule the three available host package updates and recheck the app/container health afterward.
10. Review the two active cross-dealership VIN matches with the dealership/source owner before changing any deduplication or publishing rule.

Not verified in this audit: a fresh logged-in Facebook seller-listing comparison, a fresh Chrome UI run, live O'Regan's website HTML parsing independent of the production API, offsite backup restore, local Docker image reproducibility, and a real production deployment of the two local fixes. These are intentionally left as follow-up items rather than guessed or changed.
