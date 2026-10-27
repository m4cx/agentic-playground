#!/usr/bin/env bash
#
# Restrict outbound network access of the agent process (FR-034).
#
# The orchestrator keeps the repository credential and must be able to reach the
# GitHub API, so the restriction is scoped to a dedicated unprivileged user that
# only the Pi process runs as. Rules are applied with iptables' owner match, which
# means:
#
#   * root (the orchestrator) keeps its connectivity;
#   * the egress user may only reach loopback, DNS, established flows, and the
#     resolved addresses of the configured allowlist;
#   * everything else from that user is dropped.
#
# Fail closed: if the allowlist is empty, if a host cannot be resolved, or if the
# rules cannot be applied, the script exits non-zero and the job fails with the
# failure reason `environment` without ever starting the agent.
#
# Usage: agent-egress.sh [comma-separated-hosts]
#        AGENT_ALLOW_HOSTS=api.anthropic.com agent-egress.sh
#        AGENT_EGRESS_UID=1500 agent-egress.sh   # uid to create and scope to

set -euo pipefail

log() { printf '%s\n' "$*"; }
fail() {
  printf 'agent-egress: %s\n' "$*" >&2
  exit 1
}

hosts_raw="${1:-${AGENT_ALLOW_HOSTS:-}}"
egress_uid="${AGENT_EGRESS_UID:-1500}"
egress_user="agent-egress"

if [ -z "${hosts_raw//[[:space:]]/}" ]; then
  fail "network.allowHosts is empty; refusing to start the agent"
fi

# Normalise "a, b,c" into a bash array.
IFS=',' read -r -a hosts <<<"$hosts_raw"
for i in "${!hosts[@]}"; do
  hosts[$i]="$(printf '%s' "${hosts[$i]}" | tr -d '[:space:]')"
done

command -v iptables >/dev/null 2>&1 || fail "iptables is not available; cannot apply the egress restriction"
command -v getent >/dev/null 2>&1 || fail "getent is not available; cannot resolve the allowlist"

# Create the unprivileged user if it does not exist yet.
if ! id -u "$egress_user" >/dev/null 2>&1; then
  if [ "$(id -u)" -ne 0 ]; then
    fail "cannot create $egress_user without root"
  fi
  useradd --system --uid "$egress_uid" --shell /usr/sbin/nologin --no-create-home "$egress_user" \
    || fail "could not create $egress_user"
fi
resolved_uid="$(id -u "$egress_user")"

# Resolve every allowlisted host to IPv4 addresses. Any resolution failure aborts.
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

# Nameservers must stay reachable for DNS, otherwise nothing resolves.
declare -a nameservers=()
if [ -r /etc/resolv.conf ]; then
  mapfile -t nameservers < <(awk '/^nameserver/{print $2}' /etc/resolv.conf | sort -u)
fi

# Start from a clean, per-user rule set so repeated runs are idempotent.
while iptables -D OUTPUT -m owner --uid-owner "$resolved_uid" -j ACCEPT 2>/dev/null; do :; done
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
  iptables -A OUTPUT -m owner --uid-owner "$resolved_uid" -j DROP
}

apply || fail "could not apply the egress restriction"

# IPv6 is disabled for the egress user: fail closed instead of leaking around the v4 rules.
if command -v ip6tables >/dev/null 2>&1; then
  if ip6tables -L OUTPUT >/dev/null 2>&1; then
    while ip6tables -D OUTPUT -m owner --uid-owner "$resolved_uid" -j DROP 2>/dev/null; do :; done
    ip6tables -A OUTPUT -m owner --uid-owner "$resolved_uid" -j DROP \
      || fail "could not apply the IPv6 egress restriction"
    log "agent-egress: IPv6 dropped for uid $resolved_uid"
  fi
fi

# Publish the applied policy for the job log, as required for auditability.
log "agent-egress: applied policy for uid $resolved_uid ($egress_user)"
log "agent-egress: allowed TCP 443 to: ${addresses[*]}"
log "agent-egress: allowed DNS to: ${nameservers[*]:-none}"
log "agent-egress: all other egress from uid $resolved_uid is dropped"
iptables -S OUTPUT | grep -- "--uid-owner $resolved_uid" | sed 's/^/agent-egress: /'

# Expose the uid to the orchestrator so it can start Pi under it.
if [ -n "${GITHUB_ENV:-}" ]; then
  {
    echo "AGENT_EGRESS_UID=$resolved_uid"
    echo "AGENT_EGRESS_USER=$egress_user"
  } >>"$GITHUB_ENV"
fi

log "agent-egress: restriction active"
