#!/usr/bin/env bash
# Start both services, prove a Python client can talk to both, then stop them.
# Usage: bench/interop_servers.sh <rust-binary> <dotnet-binary>
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUST_BIN="${1:?rust binary required}"
DOTNET_BIN="${2:?dotnet binary required}"
KEY="$(tr -d '[:space:]' < "$ROOT/bench/testdata/bench_key.hex")"
RUST_PORT="${RUST_PORT:-8081}"
DOTNET_PORT="${DOTNET_PORT:-8082}"
mkdir -p "$ROOT/bench/results"

if [[ -x "${HOME}/.dotnet/dotnet" ]]; then
  export DOTNET_ROOT="${DOTNET_ROOT:-$HOME/.dotnet}"
  export PATH="$DOTNET_ROOT:$PATH"
fi
export DOTNET_CLI_TELEMETRY_OPTOUT=1
export BENCH_AES_KEY="$KEY"
export ASPNETCORE_ENVIRONMENT=Production

pids=()
cleanup() {
  for pid in "${pids[@]:-}"; do
    kill "$pid" >/dev/null 2>&1 || true
  done
  wait >/dev/null 2>&1 || true
}
trap cleanup EXIT

wait_health() {
  local url="$1"
  local name="$2"
  for _ in $(seq 1 100); do
    if curl -fsS "$url/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.1
  done
  echo "$name did not become healthy at $url" >&2
  return 1
}

PORT="$RUST_PORT" BIND=127.0.0.1 \
  "$RUST_BIN" >"$ROOT/bench/results/interop-rust.log" 2>&1 &
pids+=("$!")

ASPNETCORE_URLS="http://127.0.0.1:${DOTNET_PORT}" \
  "$DOTNET_BIN" >"$ROOT/bench/results/interop-dotnet.log" 2>&1 &
pids+=("$!")

wait_health "http://127.0.0.1:${RUST_PORT}" "rust" || { cat "$ROOT/bench/results/interop-rust.log" >&2; exit 1; }
wait_health "http://127.0.0.1:${DOTNET_PORT}" "dotnet" || { cat "$ROOT/bench/results/interop-dotnet.log" >&2; exit 1; }

python3 "$ROOT/bench/interop.py" \
  --rust "http://127.0.0.1:${RUST_PORT}" \
  --dotnet "http://127.0.0.1:${DOTNET_PORT}"
