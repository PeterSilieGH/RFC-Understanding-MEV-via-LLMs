#!/usr/bin/env bash
#
# mev-tunnel — SSH tunnel manager for Ethereum RPC endpoints
#
# Usage:
#   ./tunnel.sh start ethereum     # start tunnel to dsn-rfc (from ~/.ssh/config)
#   ./tunnel.sh start <host>       # use any host from ~/.ssh/config
#   ./tunnel.sh start <host> -p <port>  # custom remote port
#   ./tunnel.sh status             # check if tunnels are active
#   ./tunnel.sh stop ethereum      # stop a specific tunnel
#   ./tunnel.sh stop --all         # stop all tunnels
#   ./tunnel.sh list               # show all defined tunnels
#
# The tunnel forwards remote:PORT → localhost:LOCAL_PORT so the framework
# can use http://localhost:LOCAL_PORT as if it were local.
#
# Local ports default to 8545 + offset (ethereum=8545, optimism=8546, …).
# Override with REMOTE_PORT env or -p flag.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${XDG_RUNTIME_DIR:-/tmp}/mev-tunnel-$$"
PIDFILE="$STATE_DIR/pids"
LOGFILE="$STATE_DIR/tunnel.log"

mkdir -p "$STATE_DIR"

# ─── Default hosts ──────────────────────────────────────────────────────────
#
# Maps friendly names to SSH config hosts and their default RPC ports.
# Override with SSH_TUNNELS env var: "name=host:port,name=host:port,..."
#
declare -A DEFAULT_TUNNELS=(
  [ethereum]="dsn-rfc:8504"          # mainnet
  [optimism]="dsn-rfc:8506"         # optimism — if they have it
  [base]="dsn-rfc:8508"              # base — same or different port
)

# ─── Helpers ────────────────────────────────────────────────────────────────

usage() {
  cat <<EOF
Usage: tunnel.sh <command> [args]

Commands:
  start <name> [-p <remote_port>]  Start SSH tunnel for named host
  stop  <name>                    Stop tunnel for named host
  status                           Show active tunnels
  list                             List configured tunnels
  stop --all                       Stop all tunnels

Examples:
  tunnel.sh start ethereum                    # dsn-rfc, port 8545
  tunnel.sh start ethereum -p 8551            # custom remote port
  tunnel.sh start custom-host -p 8545         # any SSH host
  tunnel.sh stop ethereum
  tunnel.sh status
EOF
}

log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOGFILE"; }

# Get local port for a given tunnel name
local_port() {
  # Base ports: ethereum=8545, optimism=8546, arbitrum=8547, base=8548
  case "$1" in
    ethereum)  echo 8545 ;;
    optimism)  echo 8546 ;;
    arbitrum)  echo 8547 ;;
    base)      echo 8548 ;;
    *)         echo $(( 8500 + $(printf '%d' "'${1:0:1}" | head -c1 | od -An -td1 | tr -d ' ') )) ;;
  esac
}

# Resolve host from SSH config or treat as-is
resolve_ssh_host() {
  local name="$1"
  # Check if it's a known host in SSH config
  if ssh -G "$name" 2>/dev/null | grep -q "^hostname .*"; then
    ssh -G "$name" 2>/dev/null | grep "^hostname " | awk '{print $2}' | head -1
  else
    echo "$name"
  fi
}

# ─── Commands ────────────────────────────────────────────────────────────────

cmd_start() {
  local name="$1"; shift
  local remote_port=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      -p) remote_port="$2"; shift 2 ;;
      *)  remote_port="$1"; shift ;;
    esac
  done

  # Resolve tunnel config
  local config="${SSH_TUNNELS:-}${SSH_TUNNELS:+,}${DEFAULT_TUNNELS[$name]:-}"
  local host_port
  if [[ -n "$config" ]]; then
    # Find this name in SSH_TUNNELS or DEFAULT_TUNNELS
    host_port="${DEFAULT_TUNNELS[$name]:-}"
    for entry in $config; do
      if [[ "${entry%%=*}" == "$name" ]]; then
        host_port="${entry#*=}"
        break
      fi
    done
  else
    host_port="${DEFAULT_TUNNELS[$name]:-}"
  fi

  if [[ -z "$host_port" ]]; then
    echo "Error: No tunnel config for '$name'. Define it in SSH_TUNNELS env or DEFAULT_TUNNELS in this script."
    echo "  Example: SSH_TUNNELS='ethereum=dsn-rfc:8545' ./tunnel.sh start ethereum"
    exit 1
  fi

  local ssh_host="${host_port%%:*}"
  local rport="${host_port##*:}"
  local lport="${remote_port:-$(local_port "$name")}"

  # Check if already running
  if ss -tlnp 2>/dev/null | grep -q ":$lport "; then
    log "Tunnel on localhost:$lport already active for '$name'."
    return 0
  fi

  # Pick up SSH config host if it exists
  local actual_host
  actual_host="$(resolve_ssh_host "$ssh_host")"

  log "Starting tunnel: $name → $actual_host:$rport → localhost:$lport"
  log "  Framework RPC URL: http://localhost:$lport"

  # Background SSH tunnel:
  #   -N: no command execution (just port forward)
  #   -T: disable pseudo-terminal
  #   -o ServerAliveInterval=30: keepalive so the tunnel doesn't go stale
  #   -o ExitOnForwardFailure=yes: fail if port is already in use
  ssh -NT \
    -o "ServerAliveInterval=30" \
    -o "ServerAliveCountMax=3" \
    -o "ExitOnForwardFailure=yes" \
    -o "StrictHostKeyChecking=accept-new" \
    -L "$lport:localhost:$rport" \
    "$ssh_host" \
    >> "$LOGFILE" 2>&1 &

  local pid=$!
  echo "$pid $name $lport $ssh_host:$rport" >> "$PIDFILE"
  log "Tunnel started (PID $pid)"

  # Wait briefly to confirm it came up
  sleep 1
  if kill -0 "$pid" 2>/dev/null; then
    log "✓ Tunnel active: http://localhost:$lport → $actual_host:$rport"
  else
    log "✗ Tunnel failed to start. Check $LOGFILE"
    rm -f "$PIDFILE.$$"
    exit 1
  fi
}

cmd_stop() {
  local name="$1"
  if [[ "$name" == "--all" ]]; then
    log "Stopping all tunnels..."
    while IFS=' ' read -r pid n lport _; do
      kill "$pid" 2>/dev/null && log "Stopped $n (PID $pid)"
    done < "$PIDFILE" 2>/dev/null
    : > "$PIDFILE"
    return 0
  fi

  local pid
  pid=$(grep " $name " "$PIDFILE" | awk '{print $1}' | head -1)
  if [[ -z "$pid" ]]; then
    log "No tunnel found for '$name'."
    return 1
  fi

  kill "$pid" 2>/dev/null && log "Stopped tunnel '$name' (PID $pid)"
  grep -v " $name " "$PIDFILE" > "$PIDFILE.tmp" && mv "$PIDFILE.tmp" "$PIDFILE"
}

cmd_status() {
  if [[ ! -f "$PIDFILE" ]] || [[ ! -s "$PIDFILE" ]]; then
    echo "No active tunnels."
    return 0
  fi

  echo "Active tunnels:"
  printf "%-12s %-10s %-30s %s\n" "NAME" "LOCAL_PORT" "REMOTE" "STATUS"
  echo "------------------------------------------------------"
  while IFS=' ' read -r pid name lport remote; do
    if kill -0 "$pid" 2>/dev/null; then
      echo "$name         localhost:$lport    $remote  ✓ alive"
    else
      echo "$name         localhost:$lport    $remote  ✗ dead (stale pidfile)"
      grep -v "^$pid " "$PIDFILE" > "$PIDFILE.tmp" && mv "$PIDFILE.tmp" "$PIDFILE"
    fi
  done < "$PIDFILE"
}

cmd_list() {
  echo "Configured tunnels:"
  echo ""
  for entry in "${!DEFAULT_TUNNELS[@]}"; do
    echo "  $entry  →  ${DEFAULT_TUNNELS[$entry]}"
  done
  echo ""
  echo "SSH config hosts (usable as <name>):"
  awk '/^Host /{h=$2} /Hostname/{print "  "h"  →  "$2}' ~/.ssh/config 2>/dev/null | grep -v "^*"
  echo ""
  echo "Env override: SSH_TUNNELS='name=host:port,name=host:port'"
}

# ─── Main ────────────────────────────────────────────────────────────────────

CMD="${1:-}"; shift || true

case "$CMD" in
  start)  cmd_start "$@" ;;
  stop)   cmd_stop "$@" ;;
  status) cmd_status ;;
  list)   cmd_list ;;
  -h|--help|help) usage; exit 0 ;;
  "")     usage; exit 1 ;;
  *)      echo "Unknown command: $CMD"; usage; exit 1 ;;
esac