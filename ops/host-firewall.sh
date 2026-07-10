#!/bin/sh
set -eu

mode="${1:-apply}"
if [ "$mode" != "apply" ] && [ "$mode" != "--check" ]; then
  echo "Usage: $0 [apply|--check]" >&2
  exit 2
fi

ensure_rule() {
  tool="$1"
  chain="$2"
  position="$3"
  shift 3
  if "$tool" -C "$chain" "$@" 2>/dev/null; then
    return 0
  fi
  if [ "$mode" = "--check" ]; then
    echo "missing: $tool $chain $*" >&2
    return 1
  fi
  "$tool" -I "$chain" "$position" "$@"
}

apply_family() {
  tool="$1"
  loopback_cidr="$2"

  ensure_rule "$tool" INPUT 1 -i lo -j ACCEPT
  ensure_rule "$tool" INPUT 2 ! -i lo -p tcp --dport 2377 -j DROP
  ensure_rule "$tool" INPUT 2 ! -i lo -p tcp --dport 7946 -j DROP
  ensure_rule "$tool" INPUT 2 ! -i lo -p udp --dport 7946 -j DROP
  ensure_rule "$tool" INPUT 2 ! -i lo -p udp --dport 4789 -j DROP

  if "$tool" -S DOCKER-USER >/dev/null 2>&1; then
    ensure_rule "$tool" DOCKER-USER 1 -s "$loopback_cidr" -p tcp --dport 3000 -j ACCEPT
    ensure_rule "$tool" DOCKER-USER 2 -p tcp --dport 3000 -j DROP
  elif [ "$mode" = "--check" ]; then
    echo "missing chain: $tool DOCKER-USER" >&2
    return 1
  fi
}

apply_family iptables 127.0.0.0/8
apply_family ip6tables ::1/128

echo "carpostclub host firewall: $mode complete"
