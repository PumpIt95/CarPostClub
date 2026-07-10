#!/usr/bin/env bash
set -euo pipefail

host="${CARPOSTCLUB_SSH_HOST:-konner}"
root="$(git rev-parse --show-toplevel)"
cd "${root}"

if [[ -n "$(git status --porcelain)" ]]; then
  printf 'Refusing to deploy a dirty worktree. Commit the reviewed change set first.\n' >&2
  exit 2
fi

source_commit="$(git rev-parse HEAD)"
short_commit="$(git rev-parse --short=7 HEAD)"
release_id="${1:-$(date -u +%Y%m%dT%H%M%SZ)-automation-efficiency-${short_commit}}"
release_dir="/opt/carpostclub-releases/${release_id}"

ssh -o BatchMode=yes "${host}" "mkdir -p '${release_dir}'"
git archive --format=tar HEAD | ssh -o BatchMode=yes "${host}" "tar -xf - -C '${release_dir}'"
ssh -o BatchMode=yes "${host}" \
  "bash '${release_dir}/ops/deploy-production-remote.sh' '${release_id}' '${source_commit}' '${release_dir}'"

printf 'production_deploy_complete=1 release=%s source_commit=%s\n' "${release_id}" "${source_commit}"
