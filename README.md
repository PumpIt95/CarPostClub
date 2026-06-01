# CarPostClub

Password-gated vehicle media intake, team chat, upload history, and listing copy tool.

## What This App Does

- Pulls current O'Regan's inventory by dealership and inventory type.
- Saves uploaded car media into a per-car album named from the vehicle and inventory number.
- Provides per-asset and album-wide download/delete actions.
- Generates Facebook Marketplace description variants only after media is uploaded.
- Privately assigns one Marketplace description to each approved user.
- Supports account requests, admin approvals, user password changes, and admin password resets.
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

## Useful Commands

```bash
npm test
npm run smoke
docker compose up --build
```

## Photos Shortcut Upload

CarPostClub includes Shortcut-friendly endpoints so the Apple Shortcuts app can share selected iPhone Photos media or selected macOS Finder media directly into the correct inventory album.

- `GET /api/shortcut/vehicle?stockNumber=U6247A` verifies the target car.
- `GET /api/shortcut/dealerships?format=labels`, `POST /api/shortcut/inventory-types?format=labels`, and `POST /api/shortcut/inventory?format=labels` return the live dealership, new/used, and scoped inventory picklists.
- `POST /api/shortcut/stage` accepts media from the shipped Shortcut without credentials, stores it in a short-lived pending slot, then opens CarPostClub so the signed-in PWA user can finish dealership/new-used/vehicle selection.
- `POST /api/shortcut/upload` still accepts authenticated direct uploads with a car identifier plus one or more media files for manual/API use. Session cookies, Basic auth, bearer username/password, and revocable device tokens remain supported there.
- `GET /api/shortcut/tokens`, `POST /api/shortcut/tokens`, and `DELETE /api/shortcut/tokens/:tokenId` manage the current user's device tokens.
- `GET /shortcuts/upload-to-carpostclub-pick-vehicle.shortcut` downloads the signed Shortcut bundle. The bundle itself is public because it contains no secret; staged photos are not attached to a vehicle until an authenticated PWA session completes the job.
- Accepted car fields are `stockNumber`, `stock`, `vin`, `inventoryKey`, `manualInventoryId`, `query`, `q`, `vehicle`, or `inventory`. The completion picker posts the selected dealership as `dealership`, new/used choice as `inventoryType`, and selected inventory label as `inventory`.
- Optional scope fields are `dealership`, `dealershipId`, `inventoryType`, and `inventoryTypeId`. If omitted, the server searches used inventory first, starting with O'Regan's Kia Halifax, then the other configured lots.
- Files can be sent under any multipart field name; `photos` is recommended for the Shortcut form field.

Shortcut setup details live in [`shortcuts/ios-upload-photos.md`](shortcuts/ios-upload-photos.md).

## Repository Scope

This repository contains only the active frontend/backend app code, tests, Docker files, and build/smoke scripts needed for CarPostClub.
