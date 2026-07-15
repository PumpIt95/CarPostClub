#!/usr/bin/env bash
set -euo pipefail

# State archives contain credentials, tokens, and private push keys; keep new
# deployment-created backups root-readable only even outside systemd's UMask.
umask 077

release_id="${1:?release id required}"
source_commit="${2:?source commit required}"
release_dir="${3:?release directory required}"
app_dir="${CARPOSTCLUB_APP_DIR:-/opt/konner-upload}"
compose_file="${CARPOSTCLUB_COMPOSE_FILE:-${app_dir}/dokploy/compose.yaml}"
container="${CARPOSTCLUB_CONTAINER:-konner-upload}"
state_root="${CARPOSTCLUB_STATE_ROOT:-/var/lib/konner-upload}"
image="konner-upload-app:${release_id}"
compose_backup="${compose_file}.before-${release_id}"
rollback_needed=0

wait_for_health() {
  local expected_release="$1"
  local expected_commit="$2"
  local deadline=$((SECONDS + 120))
  while (( SECONDS < deadline )); do
    health="$(curl -fsS --max-time 5 http://127.0.0.1:3911/healthz 2>/dev/null || true)"
    if [[ -n "${health}" ]] && node -e '
      const body = JSON.parse(process.argv[1]);
      if (!body.ok || body.shuttingDown || body.release?.releaseId !== process.argv[2]) process.exit(1);
      if (process.argv[3] && body.release?.sourceCommit !== process.argv[3]) process.exit(1);
    ' "${health}" "${expected_release}" "${expected_commit}"; then
      docker_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "${container}" 2>/dev/null || true)"
      if [[ "${docker_health}" == "healthy" ]]; then
        return 0
      fi
    fi
    sleep 2
  done
  return 1
}

rollback() {
  status=$?
  if (( status == 0 || rollback_needed == 0 )); then return; fi
  printf 'deploy_rollback=started release=%s\n' "${release_id}" >&2
  cp "${compose_backup}" "${compose_file}"
  docker compose -f "${compose_file}" up -d --no-deps --force-recreate "${container}" || true
  printf 'deploy_rollback=attempted release=%s\n' "${release_id}" >&2
}
trap rollback EXIT

[[ -d "${release_dir}" ]] || { printf 'missing release directory: %s\n' "${release_dir}" >&2; exit 2; }
[[ -f "${compose_file}" ]] || { printf 'missing compose file: %s\n' "${compose_file}" >&2; exit 2; }

node "${release_dir}/scripts/safe_restart.mjs" --wait \
  --base-url http://127.0.0.1:3911 \
  --tmp-root "${state_root}/tmp" \
  --timeout-seconds 300

printf 'deploy_backup=started\n'
node "${release_dir}/scripts/backup_state.mjs" --root "${state_root}" --retain 14

printf 'deploy_build=started image=%s\n' "${image}"
docker build \
  --build-arg "CARPOSTCLUB_RELEASE_ID=${release_id}" \
  --build-arg "CARPOSTCLUB_SOURCE_COMMIT=${source_commit}" \
  --tag "${image}" \
  "${release_dir}"
healthcheck="$(docker image inspect --format '{{json .Config.Healthcheck.Test}}' "${image}")"
[[ "${healthcheck}" != "null" && -n "${healthcheck}" ]] || { printf 'new image has no healthcheck\n' >&2; exit 3; }

cp "${compose_file}" "${compose_backup}"
sed -E "s#^([[:space:]]*image:)[[:space:]].*#\1 ${image}#" "${compose_file}" > "${compose_file}.new"
mv "${compose_file}.new" "${compose_file}"
rollback_needed=1

printf 'deploy_maintenance_window=started\n'
docker compose -f "${compose_file}" stop "${container}"
docker run --rm \
  --user 995:982 \
  --volume "${state_root}:${state_root}" \
  --env "UPLOAD_ROOT=${state_root}/uploads" \
  "${image}" \
  node /app/scripts/inventory_snapshot_retention.mjs \
    --db "${state_root}/oregans-inventory-snapshots.sqlite" \
    --retention-days 14 \
    --apply \
    --vacuum

docker compose -f "${compose_file}" up -d --no-deps --force-recreate "${container}"
if ! wait_for_health "${release_id}" "${source_commit}"; then
  printf 'new release failed health verification\n' >&2
  exit 4
fi

tar -C "${release_dir}" -cf - . | tar -C "${app_dir}" -xf -
"${release_dir}/ops/install-carpostclub-maintenance.sh" >/tmp/carpostclub-maintenance-install.log
printf '%s\n' "${release_id}" > "${app_dir}/CURRENT_RELEASE"
rollback_needed=0
trap - EXIT

printf 'deploy_complete=1 release=%s source_commit=%s image=%s\n' "${release_id}" "${source_commit}" "${image}"
