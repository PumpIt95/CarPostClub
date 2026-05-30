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

## Repository Scope

This repository contains only the active frontend/backend app code, tests, Docker files, and build/smoke scripts needed for CarPostClub.
