#!/usr/bin/env bash
# One-shot check that both services aggregate the same five mock responses.
# Usage: bench/interop_downstream.sh <rust-binary> <bench-binary> <dotnet-binary>
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUST_BIN="${1:?rust binary}"
BENCH_BIN="${2:?crypto-bench binary}"
DOTNET_BIN="${3:?dotnet binary}"
KEY="$(tr -d '[:space:]' < "$ROOT/bench/testdata/bench_key.hex")"
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

"$BENCH_BIN" mock --bind 127.0.0.1:8090 --delay-ms 5 --jitter-ms 0 --pad-bytes 4 \
  >"$ROOT/bench/results/interop-mock.log" 2>&1 &
pids+=("$!")

URLS="http://127.0.0.1:8090/v1/a,http://127.0.0.1:8090/v1/b,http://127.0.0.1:8090/v1/c,http://127.0.0.1:8090/v1/d,http://127.0.0.1:8090/v1/e"
PORT=8081 BIND=127.0.0.1 BENCH_DOWNSTREAM_URLS="$URLS" BENCH_DOWNSTREAM_MODE=concurrent \
  "$RUST_BIN" >"$ROOT/bench/results/interop-rust-down.log" 2>&1 &
pids+=("$!")
ASPNETCORE_URLS=http://127.0.0.1:8082 BENCH_DOWNSTREAM_URLS="$URLS" BENCH_DOWNSTREAM_MODE=concurrent \
  "$DOTNET_BIN" >"$ROOT/bench/results/interop-dotnet-down.log" 2>&1 &
pids+=("$!")

for url in http://127.0.0.1:8090/v1/a http://127.0.0.1:8081/health http://127.0.0.1:8082/health; do
  ok=0
  for _ in $(seq 1 100); do
    if [[ "$url" == *"/v1/a" ]]; then
      if curl -fsS -X POST -H 'content-type: application/json' --data '{}' "$url" >/dev/null 2>&1; then ok=1; break; fi
    else
      if curl -fsS "$url" >/dev/null 2>&1; then ok=1; break; fi
    fi
    sleep 0.05
  done
  if [[ "$ok" != 1 ]]; then
    echo "not ready: $url" >&2
    cat "$ROOT/bench/results/interop-mock.log" "$ROOT/bench/results/interop-rust-down.log" "$ROOT/bench/results/interop-dotnet-down.log" >&2 || true
    exit 1
  fi
done

python3 "$ROOT/bench/interop_downstream.py" --rust http://127.0.0.1:8081 --dotnet http://127.0.0.1:8082 --pad-bytes 4
