# CarPostClub

Password-gated vehicle media intake, team chat, upload history, and listing copy tool.

## What This App Does

- Pulls current O'Regan's inventory by dealership and inventory type.
- Saves uploaded car media into a per-car album named from the vehicle and inventory number.
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

Push notifications work on HTTPS deployments and localhost. If `CARPOSTCLUB_PUSH_VAPID_PUBLIC_KEY` and
`CARPOSTCLUB_PUSH_VAPID_PRIVATE_KEY` are not set, the server generates stable keys in the app data directory.

Uploaded media defaults to the local filesystem under `UPLOAD_ROOT`. To store media in Hetzner Object Storage,
set `CARPOSTCLUB_MEDIA_STORAGE_DRIVER=s3` plus `CARPOSTCLUB_S3_BUCKET`, `CARPOSTCLUB_S3_ENDPOINT`,
`CARPOSTCLUB_S3_REGION`, `CARPOSTCLUB_S3_ACCESS_KEY_ID`, and `CARPOSTCLUB_S3_SECRET_ACCESS_KEY`.
Each inventory album stores files under its own object-key prefix, for example `car-.../photo.jpg`.

Sold/offline upload cleanup is a server-side scheduler, not a gallery button. It reuses the same media deletion
path as the admin per-album delete action, and only removes uploaded O'Regan's inventory albums when the inventory
status check says the vehicle is missing/inactive. Manual uploads, unknown statuses, inventory API errors, active
vehicles, and albums with no media are skipped. Configure it with:

- `CARPOSTCLUB_SOLD_UPLOAD_CLEANUP_ENABLED=true`
- `CARPOSTCLUB_SOLD_UPLOAD_CLEANUP_INTERVAL_MS=21600000`
- `CARPOSTCLUB_SOLD_UPLOAD_CLEANUP_STARTUP_DELAY_MS=600000`
- `CARPOSTCLUB_SOLD_UPLOAD_CLEANUP_MAX_DELETIONS_PER_RUN=25`
- `CARPOSTCLUB_SOLD_UPLOAD_CLEANUP_DRY_RUN=false`

The production Dokploy/container env file is outside this repository, so the production server must set these
values there. If more than one app instance shares the same uploads, enable the scheduler on only one instance.
Admins can inspect recent runs at `GET /api/gallery/sold-cleanup/status` and can still run
`POST /api/gallery/remove-sold-uploads` for manual dry-runs or emergency maintenance.

## Useful Commands

```bash
npm test
npm run test:e2e
sudo npm run qa:gallery
npm run smoke
docker compose up --build
```

`npm run test:e2e` uses Playwright. On this server, Chrome is available at `/usr/bin/google-chrome-stable`;
set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to use a different browser executable.
Set `CARPOSTCLUB_E2E_SCREENSHOT_DIR=/tmp/carpostclub-gallery-qa` to save gallery viewport screenshots
while running the responsive Playwright checks.

`sudo npm run qa:gallery` logs in as the dedicated `visual.qa` user, screenshots the production gallery
across desktop, laptop, tablet, and mobile sizes, checks for horizontal overflow, and writes the run to
`/var/lib/konner-upload/debug-screenshots/gallery-qa`. It reads the password from
`/var/lib/konner-upload/visual-qa-credentials.txt` and restores that user's unread/read state afterward.

## PWA Media Upload

CarPostClub uploads are handled inside the PWA. Users choose the dealership, inventory type, make/model, and vehicle first, then upload photos or videos with the file picker, camera button, video button, or drag-and-drop area.

- The upload controls stay disabled until an inventory vehicle is selected.
- Uploaded media is saved to that vehicle's album and attributed to the signed-in user.
- Marketplace description generation runs only after media is uploaded.

## Repository Scope

This repository contains only the active frontend/backend app code, tests, Docker files, and build/smoke scripts needed for CarPostClub.
