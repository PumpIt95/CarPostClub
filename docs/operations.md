# CarPostClub Operations

## Production Smoke And Monitor

Run a health/restart-loop check from the production checkout:

```bash
npm run monitor:production -- \
  --base-url http://127.0.0.1:3911 \
  --env-file /etc/konner-upload.docker.env \
  --docker-container konner-upload \
  --max-restarts 0 \
  --run-smoke
```

Add `--require-release-id <release-id>` during deploys to prove the live container is serving the expected release.

## State Backup And Restore Check

Create a state archive and verify it can be listed:

```bash
npm run backup:state -- --root /var/lib/konner-upload
```

Validate an existing archive before relying on it:

```bash
npm run restore:check -- --archive /var/lib/konner-upload/backups/carpostclub-state-YYYYMMDDTHHMMSSZ.tar.gz
```

Use `--extract-check` to perform a non-destructive extraction into a temporary directory.

## Token Rotation

Rotate the Shortcut bearer token:

1. Generate a token on the server:

   ```bash
   openssl rand -base64 48 | tr -d '\n'
   ```

2. Set `CARPOSTCLUB_SHORTCUTS_BEARER_TOKEN=<new-token>` in `/etc/konner-upload.docker.env`.
3. Restart the app container.
4. Update each macOS/iOS Shortcut request to include `Authorization: Bearer <new-token>`.
5. Verify with:

   ```bash
   npm run smoke -- --base-url https://carpostclub.com --env-file /etc/konner-upload.docker.env
   ```

Rotate the session secret only during a planned maintenance window. Changing
`CARPOSTCLUB_AUTH_SESSION_SECRET` immediately invalidates existing browser sessions, so users will need to sign in
again. Keep the old `/etc/konner-upload.docker.env` in a root-only backup until the new deployment is verified.

## Shortcut Header Setup

The macOS `shortcuts` command can list and run Shortcuts, but it does not expose a stable non-interactive editor for
changing actions in an existing Shortcut. The required request header is:

```text
Authorization: Bearer <CARPOSTCLUB_SHORTCUTS_BEARER_TOKEN>
```

In the "Inventory Album v3" Shortcut, add that header to the "Get Contents of URL" action that calls
`https://carpostclub.com/api/shortcuts/inventory-albums`.

## Audit Log

The server writes bounded audit events to `audit-log.json` in the app data directory by default. Override the path
with `CARPOSTCLUB_AUDIT_LOG_PATH` and retention with `CARPOSTCLUB_AUDIT_LOG_LIMIT`. The admin-only API endpoint is:

```text
/api/admin/audit-log
```

Audited events currently include invite generation, user password changes, admin password resets, manual inventory
snapshot runs, single media deletion, and album-wide media deletion. Invite tokens, passwords, cookies, and auth
headers are intentionally not stored in audit details.

## Local Automation Artifacts

Codex and Facebook Marketplace automations should keep run evidence, browser state, SQLite memory, screenshots, and
ad-hoc comparison exports out of the tracked source tree. Use `automation-runs/`, `.automation-artifacts/`, `tmp/`,
`output/`, or `outputs/` for rebuildable local artifacts, and commit only the scripts, tests, docs, and app code that
make those artifacts reproducible.

Run the dry-run cleanup before deleting anything:

```bash
npm run cleanup:automation-artifacts
```

Apply it only after checking the JSON plan:

```bash
npm run cleanup:automation-artifacts -- --apply
```
