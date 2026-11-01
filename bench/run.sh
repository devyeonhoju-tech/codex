#!/usr/bin/env bash
# Build both services, prove they interoperate, then load-test them.
# Linux only. Windows: bench/run.ps1.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

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

CONCURRENCY="${CONCURRENCY:-32}"
WARMUP_SECS="${WARMUP_SECS:-5}"
DURATION_SECS="${DURATION_SECS:-10}"
REPETITIONS="${REPETITIONS:-3}"
SERVER_CPUS="${SERVER_CPUS:-0,1}"
CLIENT_CPUS="${CLIENT_CPUS:-2,3}"
# Hex bytes, no 0x. 0x8000000 = 128 MiB. A 64 MiB cap (0x4000000) returned HTTP 500
# on the 1 MiB payload at concurrency 32. 128 MiB completed that payload.
HEAP_LIMIT="${HEAP_LIMIT:-8000000}"

mkdir -p "$ROOT/bench/results"
command -v curl >/dev/null
command -v python3 >/dev/null
command -v taskset >/dev/null
python3 -c "import cryptography" || {
  echo "Python package 'cryptography' is required (bench/testdata/requirements.txt)." >&2
  exit 1
}

echo "unit tests and release builds"
# Dev-profile tests. The interop step below uses the release binaries that are measured.
cargo test -p rust-service
cargo build --release -p rust-service -p crypto-bench
dotnet test "$ROOT/dotnet-service/tests/CryptoBench.Tests.csproj" -c Release --nologo
dotnet publish "$ROOT/dotnet-service/CryptoBench.csproj" -c Release -o "$ROOT/dotnet-service/publish" --nologo
# DOTNET_gcConcurrent does not override System.GC.Concurrent when the property is
# already in runtimeconfig.json (verified on this runtime). Blocking workstation
# GC is a second publish with the two MSBuild GC properties turned off.
dotnet publish "$ROOT/dotnet-service/CryptoBench.csproj" -c Release -o "$ROOT/dotnet-service/publish-ws-blocking" \
  -p:ServerGarbageCollection=false -p:ConcurrentGarbageCollection=false --nologo
python3 "$ROOT/bench/check_vectors.py"

# Native AOT is a separate publish of the same project. ILC warnings are
# errors in this repo, so a reflection JSON call fails the publish. That
# failure is recorded and the GC variants still run.
echo "native AOT publish"
set +e
dotnet publish "$ROOT/dotnet-service/CryptoBench.csproj" -c Release -o "$ROOT/dotnet-service/publish-aot" \
  -p:PublishAot=true --nologo >"$ROOT/bench/results/aot-publish.txt" 2>&1
aot_status=$?
set -e
if [[ "$aot_status" -eq 0 && -x "$ROOT/dotnet-service/publish-aot/cryptobench" ]]; then
  echo "aot publish ok"
  AOT_BIN="$ROOT/dotnet-service/publish-aot/cryptobench"
else
  echo "aot publish failed (see bench/results/aot-publish.txt)"
  AOT_BIN=""
fi

echo "interop against the release binaries"
bash "$ROOT/bench/interop_servers.sh" \
  "$ROOT/target/release/rust-service" \
  "$ROOT/dotnet-service/publish/cryptobench"

{
  echo "date_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "git=$(git rev-parse HEAD 2>/dev/null || echo unknown)"
  echo "rustc=$(rustc --version)"
  echo "cargo=$(cargo --version)"
  echo "dotnet_sdk=$(dotnet --version)"
  echo "uname=$(uname -a)"
  echo "nproc=$(nproc)"
  echo "mem_total_kib=$(awk '/MemTotal/ {print $2}' /proc/meminfo)"
  echo "cpu_model=$(lscpu | awk -F: '/Model name/ {print $2}' | sed 's/^ *//')"
  echo "cpu_family=$(lscpu | awk -F: '/CPU family/ {print $2}' | sed 's/^ *//')"
  echo "cpu_model_id=$(lscpu | awk -F: '/^Model:/ {print $2}' | sed 's/^ *//')"
  echo "hypervisor=$(lscpu | awk -F: '/Hypervisor vendor/ {print $2}' | sed 's/^ *//')"
  echo "aes_flag=$(grep -m1 -o ' aes ' /proc/cpuinfo >/dev/null && echo present || echo absent)"
  echo "clk_tck=$(getconf CLK_TCK)"
  echo "concurrency=$CONCURRENCY"
  echo "warmup_secs=$WARMUP_SECS"
  echo "duration_secs=$DURATION_SECS"
  echo "repetitions=$REPETITIONS"
  echo "server_cpus=$SERVER_CPUS"
  echo "client_cpus=$CLIENT_CPUS"
  echo "openssl=$(openssl version)"
  echo "python=$(python3 --version)"
  echo "gc_heap_hard_limit_hex=${HEAP_LIMIT}"
  echo "gc_heap_hard_limit_bytes=$((16#$HEAP_LIMIT))"
  echo "aot_publish=$([[ -n "${AOT_BIN}" ]] && echo ok || echo failed)"
} >"$ROOT/bench/results/environment.txt"
dotnet --info >"$ROOT/bench/results/dotnet-info.txt"
rustc -vV >"$ROOT/bench/results/rustc-vv.txt"

: >"$ROOT/bench/results/runs.jsonl"

server_pid=""
server_url=""
cleanup() {
  if [[ -n "${server_pid}" ]]; then
    kill "$server_pid" >/dev/null 2>&1 || true
    wait "$server_pid" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

wait_health() {
  local url="$1"
  for _ in $(seq 1 100); do
    if curl -fsS "$url/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.1
  done
  return 1
}

start_server() {
  local name="$1"
  local bin="$2"
  shift 2
  if [[ "$name" == "rust" ]]; then
    env -u DOTNET_gcServer -u DOTNET_gcConcurrent -u DOTNET_GCHeapHardLimit \
      PORT=8081 BIND=127.0.0.1 TOKIO_WORKER_THREADS=2 \
      taskset -c "$SERVER_CPUS" "$bin" \
      >"$ROOT/bench/results/rust-bench.log" 2>&1 &
    server_pid=$!
    server_url="http://127.0.0.1:8081"
  else
    env -u DOTNET_gcServer -u DOTNET_gcConcurrent -u DOTNET_GCHeapHardLimit -u DOTNET_GCConserveMemory \
      "$@" \
      ASPNETCORE_URLS="http://127.0.0.1:8082" \
      taskset -c "$SERVER_CPUS" "$bin" \
      >"$ROOT/bench/results/${name}-bench.log" 2>&1 &
    server_pid=$!
    server_url="http://127.0.0.1:8082"
  fi
}

run_variant() {
  local name="$1"
  local bin="$2"
  shift 2
  echo "benchmark $name"
  start_server "$name" "$bin" "$@"
  if ! wait_health "$server_url"; then
    echo "$name failed to start" >&2
    cat "$ROOT/bench/results/${name}-bench.log" >&2 || true
    exit 1
  fi
  for size in 1024 65536 1048576; do
    for rep in $(seq 1 "$REPETITIONS"); do
      echo "  payload=$size rep=$rep"
      taskset -c "$CLIENT_CPUS" "$ROOT/target/release/crypto-bench" load \
        --url "$server_url/v1/process" \
        --pid "$server_pid" \
        --service "$name" \
        --payload-bytes "$size" \
        --repetition "$rep" \
        --concurrency "$CONCURRENCY" \
        --warmup-secs "$WARMUP_SECS" \
        --duration-secs "$DURATION_SECS" \
        --output "$ROOT/bench/results/runs.jsonl"
    done
  done
  kill "$server_pid" >/dev/null 2>&1 || true
  wait "$server_pid" >/dev/null 2>&1 || true
  server_pid=""
  sleep 1
}

DOTNET_BIN="$ROOT/dotnet-service/publish/cryptobench"
BLOCKING_BIN="$ROOT/dotnet-service/publish-ws-blocking/cryptobench"
run_variant rust "$ROOT/target/release/rust-service"
run_variant dotnet-server-gc "$DOTNET_BIN" DOTNET_gcServer=1 DOTNET_gcConcurrent=1
run_variant dotnet-workstation "$DOTNET_BIN" DOTNET_gcServer=0 DOTNET_gcConcurrent=1
run_variant dotnet-workstation-blocking "$BLOCKING_BIN"
run_variant dotnet-heap-limit "$DOTNET_BIN" DOTNET_gcServer=1 DOTNET_gcConcurrent=1 DOTNET_GCHeapHardLimit="$HEAP_LIMIT"
if [[ -n "${AOT_BIN}" ]]; then
  # Same Server GC settings as the baseline. Only the publish mode differs.
  echo "benchmark dotnet-aot"
  ASPNETCORE_URLS="http://127.0.0.1:8082" DOTNET_gcServer=1 DOTNET_gcConcurrent=1 \
    taskset -c "$SERVER_CPUS" "$AOT_BIN" \
    >"$ROOT/bench/results/dotnet-aot-bench.log" 2>&1 &
  server_pid=$!
  server_url="http://127.0.0.1:8082"
  if ! wait_health "$server_url"; then
    echo "dotnet-aot failed to start" >&2
    cat "$ROOT/bench/results/dotnet-aot-bench.log" >&2 || true
    exit 1
  fi
  for size in 1024 65536 1048576; do
    for rep in $(seq 1 "$REPETITIONS"); do
      echo "  payload=$size rep=$rep"
      taskset -c "$CLIENT_CPUS" "$ROOT/target/release/crypto-bench" load \
        --url "$server_url/v1/process" \
        --pid "$server_pid" \
        --service "dotnet-aot" \
        --payload-bytes "$size" \
        --repetition "$rep" \
        --concurrency "$CONCURRENCY" \
        --warmup-secs "$WARMUP_SECS" \
        --duration-secs "$DURATION_SECS" \
        --output "$ROOT/bench/results/runs.jsonl"
    done
  done
  kill "$server_pid" >/dev/null 2>&1 || true
  wait "$server_pid" >/dev/null 2>&1 || true
  server_pid=""
fi

taskset -c "$CLIENT_CPUS" "$ROOT/target/release/crypto-bench" report \
  --input "$ROOT/bench/results/runs.jsonl" \
  --markdown "$ROOT/bench/results/results.md" \
  --csv "$ROOT/bench/results/results.csv" \
  --env-file "$ROOT/bench/results/environment.txt"

echo "results: $ROOT/bench/results/results.md"
