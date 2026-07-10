#!/usr/bin/env bash
set -euo pipefail

container="${CARPOSTCLUB_CONTAINER:-konner-upload}"
state_root="${CARPOSTCLUB_STATE_ROOT:-/var/lib/konner-upload}"
snapshot_retention_days="${CARPOSTCLUB_SNAPSHOT_RETENTION_DAYS:-14}"
backup_retention_count="${CARPOSTCLUB_BACKUP_RETENTION_COUNT:-14}"
lock_file="${CARPOSTCLUB_MAINTENANCE_LOCK:-/run/carpostclub-maintenance.lock}"

exec 9>"${lock_file}"
if ! flock -n 9; then
  printf 'carpostclub_maintenance=skipped reason=already_running\n'
  exit 0
fi

running="$(docker inspect --format '{{.State.Running}}' "${container}" 2>/dev/null || true)"
if [[ "${running}" != "true" ]]; then
  printf 'carpostclub_maintenance=failed reason=container_not_running container=%s\n' "${container}" >&2
  exit 1
fi

printf 'carpostclub_maintenance=started container=%s\n' "${container}"
docker exec "${container}" node /app/scripts/inventory_snapshot_retention.mjs \
  --db "${state_root}/oregans-inventory-snapshots.sqlite" \
  --retention-days "${snapshot_retention_days}" \
  --apply
docker exec "${container}" node /app/scripts/backup_state.mjs \
  --root "${state_root}" \
  --retain "${backup_retention_count}"
printf 'carpostclub_maintenance=complete snapshot_retention_days=%s backup_retention_count=%s\n' \
  "${snapshot_retention_days}" "${backup_retention_count}"
