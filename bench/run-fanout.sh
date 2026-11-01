#!/usr/bin/env bash
# I/O fan-out benchmark. Does not replace bench/run.sh and is not used by CI.
# Rust, Server GC, Workstation GC, and Native AOT. No heap-cap variant.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
ulimit -n 65535 || true

if [[ -x "${HOME}/.dotnet/dotnet" ]]; then
  export DOTNET_ROOT="${DOTNET_ROOT:-$HOME/.dotnet}"
  export PATH="$DOTNET_ROOT:$PATH"
fi
export DOTNET_CLI_TELEMETRY_OPTOUT=1
export DOTNET_NOLOGO=1
export BENCH_AES_KEY
BENCH_AES_KEY="$(tr -d '[:space:]' < "$ROOT/bench/testdata/bench_key.hex")"
export ASPNETCORE_ENVIRONMENT=Production
export RUST_LOG=warn

CONCURRENCY_LIST="${CONCURRENCY_LIST:-32 256 1024}"
WARMUP_SECS="${WARMUP_SECS:-5}"
DURATION_SECS="${DURATION_SECS:-10}"
REPETITIONS="${REPETITIONS:-3}"
SERVER_CPUS="${SERVER_CPUS:-0,1}"
CLIENT_CPUS="${CLIENT_CPUS:-2,3}"
PAD_BYTES="${PAD_BYTES:-128}"
TIMEOUT_MS="${TIMEOUT_MS:-2000}"
URLS="http://127.0.0.1:8090/v1/a,http://127.0.0.1:8090/v1/b,http://127.0.0.1:8090/v1/c,http://127.0.0.1:8090/v1/d,http://127.0.0.1:8090/v1/e"

mkdir -p "$ROOT/bench/results"
echo "building"
cargo test -p rust-service
cargo build --release -p rust-service -p crypto-bench
dotnet test "$ROOT/dotnet-service/tests/CryptoBench.Tests.csproj" -c Release --nologo
dotnet publish "$ROOT/dotnet-service/CryptoBench.csproj" -c Release -o "$ROOT/dotnet-service/publish" --nologo
dotnet publish "$ROOT/dotnet-service/CryptoBench.csproj" -c Release -o "$ROOT/dotnet-service/publish-workstation" \
  -p:ServerGarbageCollection=false --nologo
dotnet publish "$ROOT/dotnet-service/CryptoBench.csproj" -c Release -o "$ROOT/dotnet-service/publish-aot" \
  -p:PublishAot=true -p:PublishReadyToRun=false --nologo
python3 "$ROOT/bench/check_vectors.py"
bash "$ROOT/bench/interop_servers.sh" "$ROOT/target/release/rust-service" "$ROOT/dotnet-service/publish/cryptobench"
bash "$ROOT/bench/interop_downstream.sh" "$ROOT/target/release/rust-service" "$ROOT/target/release/crypto-bench" "$ROOT/dotnet-service/publish/cryptobench"

{
  echo "date_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "git=$(git rev-parse HEAD 2>/dev/null || echo unknown)"
  echo "rustc=$(rustc --version)"
  echo "dotnet_sdk=$(dotnet --version)"
  echo "uname=$(uname -a)"
  echo "nproc=$(nproc)"
  echo "mem_total_kib=$(awk '/MemTotal/ {print $2}' /proc/meminfo)"
  echo "cpu_model=$(lscpu | awk -F: '/Model name/ {print $2}' | sed 's/^ *//')"
  echo "warmup_secs=$WARMUP_SECS"
  echo "duration_secs=$DURATION_SECS"
  echo "repetitions=$REPETITIONS"
  echo "server_cpus=$SERVER_CPUS"
  echo "client_cpus=$CLIENT_CPUS"
  echo "mock_cpus=$CLIENT_CPUS"
  echo "downstream_pad_bytes=$PAD_BYTES"
  echo "downstream_timeout_ms=$TIMEOUT_MS"
  echo "note=mock and load generator share CPUs $CLIENT_CPUS; the service is pinned to $SERVER_CPUS"
} >"$ROOT/bench/results/fanout-environment.txt"

: >"$ROOT/bench/results/fanout-runs.jsonl"

server_pid=""
mock_pid=""
cleanup() {
  if [[ -n "${server_pid}" ]]; then kill "$server_pid" >/dev/null 2>&1 || true; wait "$server_pid" >/dev/null 2>&1 || true; fi
  if [[ -n "${mock_pid}" ]]; then kill "$mock_pid" >/dev/null 2>&1 || true; wait "$mock_pid" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

wait_health() {
  local url="$1"
  for _ in $(seq 1 200); do
    if curl -fsS --max-time 1 "$url" >/dev/null 2>&1; then return 0; fi
    sleep 0.05
  done
  return 1
}

stop_server() {
  if [[ -n "${server_pid}" ]]; then
    kill "$server_pid" >/dev/null 2>&1 || true
    wait "$server_pid" >/dev/null 2>&1 || true
    server_pid=""
  fi
}

stop_mock() {
  if [[ -n "${mock_pid}" ]]; then
    kill "$mock_pid" >/dev/null 2>&1 || true
    wait "$mock_pid" >/dev/null 2>&1 || true
    mock_pid=""
  fi
}

start_mock() {
  local delay="$1"
  local jitter="$2"
  stop_mock
  taskset -c "$CLIENT_CPUS" "$ROOT/target/release/crypto-bench" mock \
    --bind 127.0.0.1:8090 --delay-ms "$delay" --jitter-ms "$jitter" --pad-bytes "$PAD_BYTES" \
    >"$ROOT/bench/results/mock.log" 2>&1 &
  mock_pid=$!
  wait_health_post() {
    for _ in $(seq 1 100); do
      if curl -fsS -X POST -H 'content-type: application/json' --data '{}' http://127.0.0.1:8090/v1/a >/dev/null 2>&1; then return 0; fi
      sleep 0.05
    done
    return 1
  }
  if ! wait_health_post; then
    echo "mock failed" >&2
    cat "$ROOT/bench/results/mock.log" >&2 || true
    exit 1
  fi
}

start_server() {
  local kind="$1"
  stop_server
  case "$kind" in
    rust)
      PORT=8081 BIND=127.0.0.1 TOKIO_WORKER_THREADS=2 \
        taskset -c "$SERVER_CPUS" "$ROOT/target/release/rust-service" \
        >"$ROOT/bench/results/fanout-rust.log" 2>&1 &
      server_pid=$!
      server_url="http://127.0.0.1:8081"
      ;;
    dotnet-server-gc)
      ASPNETCORE_URLS=http://127.0.0.1:8082 DOTNET_gcServer=1 DOTNET_gcConcurrent=1 \
        taskset -c "$SERVER_CPUS" "$ROOT/dotnet-service/publish/cryptobench" \
        >"$ROOT/bench/results/fanout-dotnet.log" 2>&1 &
      server_pid=$!
      server_url="http://127.0.0.1:8082"
      ;;
    dotnet-workstation)
      ASPNETCORE_URLS=http://127.0.0.1:8082 DOTNET_gcServer=0 DOTNET_gcConcurrent=1 \
        taskset -c "$SERVER_CPUS" "$ROOT/dotnet-service/publish-workstation/cryptobench" \
        >"$ROOT/bench/results/fanout-dotnet.log" 2>&1 &
      server_pid=$!
      server_url="http://127.0.0.1:8082"
      ;;
    dotnet-aot)
      ASPNETCORE_URLS=http://127.0.0.1:8082 DOTNET_gcServer=1 DOTNET_gcConcurrent=1 \
        taskset -c "$SERVER_CPUS" "$ROOT/dotnet-service/publish-aot/cryptobench" \
        >"$ROOT/bench/results/fanout-dotnet.log" 2>&1 &
      server_pid=$!
      server_url="http://127.0.0.1:8082"
      ;;
  esac
  if ! wait_health "$server_url/health"; then
    echo "$kind failed to start" >&2
    exit 1
  fi
}

run_cell() {
  local name="$1"
  local size="$2"
  local conc="$3"
  local pad="$4"
  local rep="$5"
  echo "  $name size=$size conc=$conc pad=$pad rep=$rep"
  taskset -c "$CLIENT_CPUS" "$ROOT/target/release/crypto-bench" load \
    --url "$server_url/v1/process" \
    --pid "$server_pid" \
    --service "$name" \
    --payload-bytes "$size" \
    --repetition "$rep" \
    --concurrency "$conc" \
    --warmup-secs "$WARMUP_SECS" \
    --duration-secs "$DURATION_SECS" \
    --downstream-pad-bytes "$pad" \
    --output "$ROOT/bench/results/fanout-runs.jsonl"
}

for kind in rust dotnet-server-gc dotnet-workstation dotnet-aot; do
  echo "baseline $kind"
  unset BENCH_DOWNSTREAM_URLS BENCH_DOWNSTREAM_MODE || true
  start_server "$kind"
  for size in 1024 65536; do
    for conc in $CONCURRENCY_LIST; do
      for rep in $(seq 1 "$REPETITIONS"); do
        run_cell "${kind}-base" "$size" "$conc" 0 "$rep"
      done
    done
  done
  stop_server
done

for delay in 20 100; do
  echo "concurrent delay=$delay"
  start_mock "$delay" 0
  export BENCH_DOWNSTREAM_URLS="$URLS"
  export BENCH_DOWNSTREAM_MODE=concurrent
  export BENCH_DOWNSTREAM_TIMEOUT_MS="$TIMEOUT_MS"
  for kind in rust dotnet-server-gc dotnet-workstation dotnet-aot; do
    start_server "$kind"
    for size in 1024 65536; do
      for conc in $CONCURRENCY_LIST; do
        for rep in $(seq 1 "$REPETITIONS"); do
          run_cell "${kind}-conc-${delay}" "$size" "$conc" "$PAD_BYTES" "$rep"
        done
      done
    done
    stop_server
  done
  stop_mock
done

for delay in 20 100; do
  echo "sequential delay=$delay (1 KiB, concurrency 32)"
  start_mock "$delay" 0
  export BENCH_DOWNSTREAM_URLS="$URLS"
  export BENCH_DOWNSTREAM_MODE=sequential
  export BENCH_DOWNSTREAM_TIMEOUT_MS="$TIMEOUT_MS"
  for kind in rust dotnet-server-gc dotnet-workstation dotnet-aot; do
    start_server "$kind"
    for rep in $(seq 1 "$REPETITIONS"); do
      run_cell "${kind}-seq-${delay}" 1024 32 "$PAD_BYTES" "$rep"
    done
    stop_server
  done
  stop_mock
done

echo "jitter 20ms + 0..30ms, 1 KiB, concurrency 32"
start_mock 20 30
export BENCH_DOWNSTREAM_URLS="$URLS"
export BENCH_DOWNSTREAM_MODE=concurrent
for kind in rust dotnet-server-gc dotnet-workstation dotnet-aot; do
  start_server "$kind"
  for rep in $(seq 1 "$REPETITIONS"); do
    run_cell "${kind}-jitter-20" 1024 32 "$PAD_BYTES" "$rep"
  done
  stop_server
done
stop_mock

"$ROOT/target/release/crypto-bench" report \
  --input "$ROOT/bench/results/fanout-runs.jsonl" \
  --markdown "$ROOT/bench/results/fanout-results.md" \
  --csv "$ROOT/bench/results/fanout-results.csv" \
  --env-file "$ROOT/bench/results/fanout-environment.txt"
echo "results: $ROOT/bench/results/fanout-results.md"
