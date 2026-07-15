# CarPostClub

Password-gated vehicle media intake, team chat, upload history, and listing copy tool.

## What This App Does

- Pulls current O'Regan's inventory by dealership and inventory type.
- Saves uploaded car media into a per-car album named from the vehicle and inventory number.
- Treats O'Regan's removal as the source-of-truth signal that a package is no longer available after a configurable feed-removal grace window; the app greys that album and marks the Facebook sync action as `mark_sold` without sending a push alert.
- Provides per-asset and album-wide download/delete actions.
- Generates Facebook Marketplace description variants only after media is uploaded.
- Privately assigns one Marketplace description to each active user.
- Supports 24-hour invite-link signups, user password changes, and admin password resets/deactivation.
- Includes a small team chat panel.
- Installs as a PWA with offline fallback and opt-in push notifications for chat and upload activity.

## Local Setup

```bash
npm ci
cp .env.example .env
npm start
```

The app defaults to `http://127.0.0.1:3911`.

## Environment

Use `.env.example` as the starting point. Do not commit real secrets.

`OPENAI_API_KEY` is optional for local testing. Without it, Marketplace copy falls back to local template variants.
Set `FACEBOOK_MARKETPLACE_POSTAL_CODE=B3K4P9` for Konner's current Facebook Marketplace location field; generated
packages expose the postal code separately from the human-readable Halifax, Nova Scotia location.

Set `CARPOSTCLUB_PUBLIC_ORIGIN=https://carpostclub.com` in production so generated invite links do not depend on
the request `Host` header. Production also fails closed if no app password/hash is configured or if placeholder
auth/session values are still present. Set an explicit `CARPOSTCLUB_AUTH_SESSION_SECRET` in production; the app does
not derive one there. Prefer `CARPOSTCLUB_AUTH_PASSWORD_HASH` over a plaintext password, and only set
`CARPOSTCLUB_AUTH_DISABLED=true` for an intentionally unauthenticated deployment.

The macOS/iOS Shortcut inventory endpoint can be protected with `CARPOSTCLUB_SHORTCUTS_BEARER_TOKEN`. When set,
call `/api/shortcuts/inventory-albums` with `Authorization: Bearer <token>`.

Admin-sensitive actions are written to a bounded audit log in the app data directory. Override this with
`CARPOSTCLUB_AUDIT_LOG_PATH` and `CARPOSTCLUB_AUDIT_LOG_LIMIT`.

Push notifications work on HTTPS deployments and localhost. If `CARPOSTCLUB_PUSH_VAPID_PUBLIC_KEY` and
`CARPOSTCLUB_PUSH_VAPID_PRIVATE_KEY` are not set, the server generates stable keys in the app data directory.

The app periodically snapshots O'Regan's inventory for the four Halifax stores into
`oregans-inventory-snapshots.sqlite` in the app data directory. It tracks every snapshot run plus each vehicle's
first seen, current seen, last seen, and removed timestamps, so "added today" checks can come from local history.
After the first quiet baseline snapshot, newly seen vehicles send dealership-targeted push notifications. Vehicles that
briefly disappear and reappear inside the reappear cooldown do not send duplicate "new inventory" alerts. O'Regan's
price changes send all-user price-change push notifications.
Tune this with `CARPOSTCLUB_OREGANS_INVENTORY_SNAPSHOT_INTERVAL_MS`; set
`CARPOSTCLUB_OREGANS_INVENTORY_SNAPSHOT_ENABLED=false` to disable the scheduler.
For a time-aware schedule, use that interval for the daytime window and set
`CARPOSTCLUB_OREGANS_INVENTORY_SNAPSHOT_OFF_HOURS_INTERVAL_MS`,
`CARPOSTCLUB_OREGANS_INVENTORY_SNAPSHOT_DAY_START_HOUR`, and
`CARPOSTCLUB_OREGANS_INVENTORY_SNAPSHOT_DAY_END_HOUR`. Runs align to predictable wall-clock boundaries in
`CARPOSTCLUB_OREGANS_INVENTORY_SNAPSHOT_TIME_ZONE` (for example, a 10-minute interval runs at :00, :10, :20,
:30, :40, and :50). Set `CARPOSTCLUB_OREGANS_INVENTORY_SNAPSHOT_OFF_HOURS_ENABLED=false` to stop inventory
requests outside the daytime window entirely. Leaving it enabled with the off-hours interval equal to the daytime
interval preserves a fixed schedule.
Raw per-vehicle snapshot rows default to 14 days of retention while first-seen, last-seen, removal, and current
vehicle state are preserved. Tune the history window with
`CARPOSTCLUB_OREGANS_INVENTORY_SNAPSHOT_RETENTION_DAYS`; set it to `0` to disable automatic pruning.
Brief feed gaps are held for 48 hours by default before a vehicle becomes source-removed. Tune this with
`CARPOSTCLUB_OREGANS_INVENTORY_REMOVAL_GRACE_MS`; the active grace value is exposed by
`/api/inventory/snapshots/status`.

Failed login attempts are throttled per username/IP in the app process. Tune this with
`CARPOSTCLUB_LOGIN_RATE_LIMIT_MAX_ATTEMPTS` and `CARPOSTCLUB_LOGIN_RATE_LIMIT_WINDOW_MS`; keep an edge
rate limit in front of public deployments as a second layer.

Uploaded media defaults to the local filesystem under `UPLOAD_ROOT`. To store media in Hetzner Object Storage,
set `CARPOSTCLUB_MEDIA_STORAGE_DRIVER=s3` plus `CARPOSTCLUB_S3_BUCKET`, `CARPOSTCLUB_S3_ENDPOINT`,
`CARPOSTCLUB_S3_REGION`, `CARPOSTCLUB_S3_ACCESS_KEY_ID`, and `CARPOSTCLUB_S3_SECRET_ACCESS_KEY`.
Each inventory album stores files under its own object-key prefix, for example `car-.../photo.jpg`.

The repository Docker Compose file is a local/single-container reference. Production currently runs through the
Dokploy compose stack on `ssh konner` with `/etc/konner-upload.docker.env` mounted into the container. Do not add a
second writer
against the same `UPLOAD_ROOT`/app data directory unless shared JSON state and schedulers are moved behind a
cross-process lock or database-backed coordination.

## Useful Commands

```bash
npm test
npm run test:e2e
sudo npm run qa:gallery
npm run smoke
npm run backup:state -- --retain 14
npm run prune:inventory-snapshots
npm run restart:check
npm run restore:check -- --archive <backup.tar.gz>
npm run monitor:production
npm run backfill:marketplace-descriptions -- --dry-run
docker compose up --build
```

`npm run prune:inventory-snapshots` is a dry run unless `-- --apply` is supplied. Production deployment uses the
guarded `ops/deploy-production.sh` workflow, which backs up state, verifies restart safety, builds an immutable image,
checks its health, and installs the daily maintenance timer.

Container builds generate `release-manifest.json` inside the image. Pass
`--build-arg CARPOSTCLUB_SOURCE_COMMIT=$(git rev-parse HEAD)` so `/healthz` and `/api/version` identify the exact
source commit that was deployed.

`npm run test:e2e` uses Playwright. On this server, Chrome is available at `/usr/bin/google-chrome-stable`;
set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to use a different browser executable.
Set `CARPOSTCLUB_E2E_SCREENSHOT_DIR=/tmp/carpostclub-gallery-qa` to save gallery viewport screenshots
while running the responsive Playwright checks.

`sudo npm run qa:gallery` logs in as the dedicated `visual.qa` user, screenshots the production gallery
across desktop, laptop, tablet, and mobile sizes, checks for horizontal overflow, and writes the run to
`/var/lib/konner-upload/debug-screenshots/gallery-qa`. It reads the password from
`/var/lib/konner-upload/visual-qa-credentials.txt` and restores that user's unread/read state afterward.

`npm run smoke` also verifies the inventory snapshot endpoints, so production releases that predate the snapshot
API will fail the smoke check instead of appearing healthy.

`npm run backfill:marketplace-descriptions` calls the admin backfill endpoint to regenerate stale media-backed
Marketplace description stores with the current prompt version. Use `--dry-run` first; production can pass
`--env-file /etc/konner-upload.docker.env` so the script can mint the bootstrap admin cookie without printing secrets.

See `docs/operations.md` for production backup/restore checks, restart-loop monitoring, Shortcut bearer-token setup,
and token/session secret rotation.

## PWA Media Upload

CarPostClub uploads are handled inside the PWA. Users choose the dealership, inventory type, make/model, and vehicle first, then upload photos or videos with the file picker, camera button, video button, or drag-and-drop area.

- The upload controls stay disabled until an inventory vehicle is selected.
- Uploaded media is saved to that vehicle's album and attributed to the signed-in user.
- Marketplace description generation runs only after media is uploaded.
- A source-active package needs at least five uploaded photos and no upload in progress before its lifecycle can be
  labelled `facebook_ready`.

## Repository Scope

This repository contains only the active frontend/backend app code, tests, Docker files, and build/smoke scripts needed for CarPostClub.
