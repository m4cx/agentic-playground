#!/usr/bin/env bash
#
# Restrict outbound network access of the agent process (FR-026).
#
# The orchestrator keeps the repository credential and must reach the GitHub API, so the
# restriction is scoped to a dedicated unprivileged user that only the Pi process runs as.
# Rules use iptables' owner match:
#   * the runner user keeps its connectivity;
#   * the agent user may reach loopback, DNS, established flows, and the resolved
#     allowlisted hosts on TCP 443;
#   * everything else from that user is logged (rate limited) and dropped.
#
# Fail closed: an empty allowlist, an unresolved host, or an unapplied rule set exits
# non-zero and the job fails before the agent starts.
#
# Usage: agent-egress.sh
#        AGENT_ALLOW_HOSTS=ollama.com,registry.npmjs.org agent-egress.sh

set -euo pipefail

log() { printf '%s\n' "$*"; }
fail() {
  printf 'agent-egress: %s\n' "$*" >&2
  exit 1
}

hosts_raw="${AGENT_ALLOW_HOSTS:-}"
egress_uid="${AGENT_EGRESS_UID:-1500}"
egress_user="${AGENT_EGRESS_USER:-agent-egress}"

if [ -z "${hosts_raw//[[:space:]]/}" ]; then
  fail "AGENT_ALLOW_HOSTS is empty; refusing to start the agent"
fi

IFS=',' read -r -a hosts <<<"$hosts_raw"
for i in "${!hosts[@]}"; do
  hosts[$i]="$(printf '%s' "${hosts[$i]}" | tr -d '[:space:]')"
done

command -v iptables >/dev/null 2>&1 || fail "iptables is not available; cannot apply the egress restriction"
command -v getent >/dev/null 2>&1 || fail "getent is not available; cannot resolve the allowlist"

if ! id -u "$egress_user" >/dev/null 2>&1; then
  if [ "$(id -u)" -ne 0 ]; then
    fail "cannot create $egress_user without root"
  fi
  if getent group "$egress_user" >/dev/null 2>&1; then
    useradd --uid "$egress_uid" --gid "$egress_user" --shell /usr/sbin/nologin --no-create-home "$egress_user" \
      || fail "could not create $egress_user"
  else
    useradd --uid "$egress_uid" --user-group --shell /usr/sbin/nologin --no-create-home "$egress_user" \
      || fail "could not create $egress_user"
  fi
fi
resolved_uid="$(id -u "$egress_user")"

declare -a addresses=()
for host in "${hosts[@]}"; do
  [ -n "$host" ] || fail "allowlist contains an empty host"
  case "$host" in
    *[!A-Za-z0-9.-]* | .* | *..* | *-) fail "allowlist contains an invalid host: $host" ;;
  esac
  mapfile -t host_addresses < <(getent ahostsv4 "$host" | awk '{print $1}' | sort -u)
  if [ "${#host_addresses[@]}" -eq 0 ]; then
    fail "could not resolve allowlisted host: $host"
  fi
  for address in "${host_addresses[@]}"; do
    addresses+=("$address")
  done
  log "agent-egress: resolved $host -> ${host_addresses[*]}"
done

declare -a nameservers=()
if [ -r /etc/resolv.conf ]; then
  mapfile -t nameservers < <(awk '/^nameserver/{print $2}' /etc/resolv.conf | sort -u)
fi

while iptables -D OUTPUT -m owner --uid-owner "$resolved_uid" -j ACCEPT 2>/dev/null; do :; done
while iptables -D OUTPUT -m owner --uid-owner "$resolved_uid" -j LOG 2>/dev/null; do :; done
while iptables -D OUTPUT -m owner --uid-owner "$resolved_uid" -j DROP 2>/dev/null; do :; done

apply() {
  iptables -A OUTPUT -m owner --uid-owner "$resolved_uid" -o lo -j ACCEPT
  iptables -A OUTPUT -m owner --uid-owner "$resolved_uid" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  for nameserver in "${nameservers[@]}"; do
    iptables -A OUTPUT -m owner --uid-owner "$resolved_uid" -p udp -d "$nameserver" --dport 53 -j ACCEPT
    iptables -A OUTPUT -m owner --uid-owner "$resolved_uid" -p tcp -d "$nameserver" --dport 53 -j ACCEPT
  done
  for address in "${addresses[@]}"; do
    iptables -A OUTPUT -m owner --uid-owner "$resolved_uid" -p tcp -d "$address" --dport 443 -j ACCEPT
  done
  iptables -A OUTPUT -m owner --uid-owner "$resolved_uid" -m limit --limit 10/min --limit-burst 20 \
    -j LOG --log-prefix "agent-egress-blocked: "
  iptables -A OUTPUT -m owner --uid-owner "$resolved_uid" -j DROP
}

apply || fail "could not apply the egress restriction"

if command -v ip6tables >/dev/null 2>&1; then
  if ip6tables -L OUTPUT >/dev/null 2>&1; then
    while ip6tables -D OUTPUT -m owner --uid-owner "$resolved_uid" -j LOG 2>/dev/null; do :; done
    while ip6tables -D OUTPUT -m owner --uid-owner "$resolved_uid" -j DROP 2>/dev/null; do :; done
    ip6tables -A OUTPUT -m owner --uid-owner "$resolved_uid" -m limit --limit 10/min --limit-burst 20 \
      -j LOG --log-prefix "agent-egress-blocked: "
    ip6tables -A OUTPUT -m owner --uid-owner "$resolved_uid" -j DROP \
      || fail "could not apply the IPv6 egress restriction"
    log "agent-egress: IPv6 dropped for uid $resolved_uid"
  fi
fi

log "agent-egress: applied policy for uid $resolved_uid ($egress_user)"
log "agent-egress: allowed TCP 443 to: ${addresses[*]}"
log "agent-egress: allowed DNS to: ${nameservers[*]:-none}"
log "agent-egress: all other egress from uid $resolved_uid is logged and dropped"
iptables -S OUTPUT | grep -- "--uid-owner $resolved_uid" | sed 's/^/agent-egress: /'

if [ -n "${GITHUB_ENV:-}" ]; then
  {
    echo "AGENT_EGRESS_UID=$resolved_uid"
    echo "AGENT_EGRESS_USER=$egress_user"
  } >>"$GITHUB_ENV"
fi

log "agent-egress: restriction active"
