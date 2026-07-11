# CarPostClub Jobs: Server vs This Mac

Last audited: 2026-07-11 (America/Halifax)

## The simple version

- The `konner` VPS runs the website and PWA 24/7. The website keeps working when this Mac is off.
- SSH is only the secure connection used to reach the VPS. Starting an SSH command from this Mac does not move a Mac/Chrome job onto the VPS.
- Facebook Marketplace work runs on this Mac because it needs Konner's logged-in Chrome profile. Those jobs need the Mac awake, online, and signed in.
- If the Mac is asleep, local jobs wait. After it wakes, the watchdog runs only the newest missed check; it does not replay every missed occurrence.

## What the VPS does

1. **CarPostClub app (`konner-upload`)** — serves the PWA, login, albums, vehicle package data, listing drafts, chat, push notifications, and APIs. Docker restarts it if the process exits.
2. **HTTPS router (`dokploy-traefik`)** — safely routes `carpostclub.com` traffic to the app and handles HTTPS.
3. **Photo/object storage** — new production media uses S3-compatible object storage. The VPS keeps application databases and a smaller amount of local/legacy media.
4. **O'Regan's inventory snapshots** — from 9:00 a.m. until 7:00 p.m. Halifax time, the app checks the configured O'Regan's inventory every 10 minutes; overnight checks are disabled. It tracks added, removed, reappearing, and price-changed vehicles and reconciles album lifecycle/price state. Raw per-vehicle observations are retained for 14 days while lifecycle summaries and current state are preserved.
5. **Live update heartbeats** — while a user has the PWA open, tiny 25-second pings keep album/chat live-update connections alive. They stop when the user disconnects.
6. **Host firewall** — the CarPostClub firewall service keeps app/admin ports private while allowing HTTPS and key-based SSH.

The VPS has one daily CarPostClub maintenance timer. It safely prunes raw inventory history to 14 days, creates a verified SQLite-consistent state backup, and retains the newest 14 matching archives. The local health monitor reports if the timer is inactive or the newest backup is more than 7 days old.

## What this Mac does

### Foundation jobs

- **Keep Awake** — `caffeinate` prevents sleep so scheduled browser jobs can run. This is the main reason the Mac must remain on (and usually plugged in) for Facebook automation.
- **Ensure Codex Is Running** — every 5 minutes, checks that the local Codex app is available.
- **Automation Watchdog** — every 5 minutes, checks Mac/Chrome pressure, missed schedules, locks, and coordination health. It also runs a no-AI CPC readiness check between 8:00 a.m. and 8:00 p.m. and wakes the existing publisher owner only when an in-scope used-car package is ready. Full configuration audits are cached for one hour instead of being repeated every five minutes.
- **Deterministic daily cleanup** — the watchdog clears expired local buyer-status flags and removes rebuildable automation photo/package payloads older than seven days. It does not open Facebook, contact anyone, or delete CPC/server photos.

### Active Codex jobs

| Job | Schedule (Halifax) | Simple purpose | Owner boundary |
| --- | --- | --- | --- |
| Automation Supervisor And Repair | Monday, Wednesday, and Friday at 6:20 p.m. | Audits schedules, policy, locks, and shared infrastructure | Repairs coordination only; no Facebook business actions |
| Inventory Health Monitor | Daily 7:00 a.m. | Checks CarPostClub/O'Regan's inventory and API health | Reports health; does not take another job's Facebook action |
| Facebook Ready Publisher | Event-driven daily from 8:00 a.m. to 8:00 p.m.; fallback weekdays 5:20 p.m. and Saturday 3:20 p.m. | Publishes a verified, ready used-vehicle package soon after CPC upload | Only owner allowed to publish CPC-ready used vehicles |
| Live Facebook Listing Sync | Weekdays 9:00 a.m. and 5:00 p.m.; Saturday 11:00 a.m. and 3:00 p.m. | Compares source inventory with live Marketplace listings | Only owner allowed to mark verified stale listings sold |
| Listing Price And Disclosure Audit And Fix | Weekdays 5:45 p.m.; Saturday 4:00 p.m. | Checks and fixes live listing prices/disclosures | Only owner allowed to edit those fields |
| Photo Package Readiness Monitor | Weekdays 4:45 p.m.; Saturday 2:30 p.m. | Reconciles inventory, CPC media, and report-only Photos evidence | Reports readiness; never uploads CPC media |
| New Kia Facebook Lifecycle | Weekdays 7:00 p.m.; Saturday 4:30 p.m. | Maintains the separate new-Kia listing flow | Owns verified new-Kia publish/sold actions |

Weekday and Saturday entries for the same purpose are companion schedules, not separate owners. Their short prompts inherit the base job's rules.

### Paused jobs

These remain paused until Konner explicitly reactivates the recurring schedules:

- FB Inbox Shallow Scanner
- FB Inbox Triage And Reply
- Morning Appointment Follow Up Digest
- Pending Telegram Response Watcher
- all Pre Close Appointment Digest schedules

Also paused:

- Chrome Pressure Recovery Guard — redundant because the five-minute watchdog already does the deterministic check.
- Message Memory Expiry Cleanup — its exact local cleanup now runs directly in the watchdog without starting Codex; this is not a customer-contact job.
- Retry Rogers Retention Chat — completed one-time reminder; it must not replay.

A manual one-time inbox request does not reactivate any paused schedule.

## How the jobs cooperate

- `/Users/konnerhaas/.codex/automation-policy.json` is the single coordination policy for owners, pauses, schedules, model tiers, prompt limits, and shared resources.
- Only one automation may control Facebook Chrome at a time through the shared `facebook-browser` lane.
- Each active owner has a singleton lease. Long jobs refresh singleton and lane heartbeats at least every 30 minutes.
- A stale-looking lease is reported for verification; cleanup does not force-release it and risk two jobs acting at once.
- Broad read-only evidence is reused for a short policy-defined time. Every real publish/edit/sold action still gets a fresh targeted check.
- Current package readiness comes from the normalized `/api/albums` lifecycle (`source active` + draft ready + `canPost`). Old readiness markers and hard-coded vehicle totals are not trusted.
- Catch-up is latest-state only, coalesces repeated misses, respects owner locks, and ignores every paused automation.
- The CPC readiness watcher is deterministic and uses no model while idle. A changed ready-car identity wakes the publisher promptly; an unchanged blocked candidate waits 90 minutes before retrying, and failed runs wait 30 minutes. Existing singletons, the shared browser lane, duplicate checks, and publish locks still apply.
- Effective 2026-07-09, Photos/Finder/iPhone sources are report-only. Konner uploads CPC/PWA photos; automations do not import or upload them.

## Current efficiency limits

- Active scheduled Codex runs: **46 per week**, down from **90** in the previous schedule and **383** before the larger consolidation. Real ready-car events add productive publisher runs rather than routine no-op runs.
- Automation prompt text: about **23.7k characters total**, down from about **109k**.
- Lightweight checks use the lower-cost tier; package reconciliation uses the middle tier; Facebook mutations use the strongest tier.
- Current customer-contact pause is enforced in both policy and automation status, so missed-run recovery cannot silently turn it back on.

## What happens if this Mac is off

The website, PWA, APIs, stored photos, chat service, inventory snapshot process, and HTTPS continue on the VPS. Local Codex/Chrome Facebook jobs do not run while the Mac is off. When the Mac returns, the watchdog may run one current-state catch-up, but it will not replay a backlog or bypass paused jobs.
