#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
install -m 0755 "${root}/ops/carpostclub-maintenance.sh" /usr/local/sbin/carpostclub-maintenance
install -m 0644 "${root}/ops/carpostclub-maintenance.service" /etc/systemd/system/carpostclub-maintenance.service
install -m 0644 "${root}/ops/carpostclub-maintenance.timer" /etc/systemd/system/carpostclub-maintenance.timer
systemctl daemon-reload
systemctl enable --now carpostclub-maintenance.timer
systemctl status carpostclub-maintenance.timer --no-pager
