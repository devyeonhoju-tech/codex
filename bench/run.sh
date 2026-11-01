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
python3 "$ROOT/bench/check_vectors.py"

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
  if [[ "$name" == "rust" ]]; then
    PORT=8081 BIND=127.0.0.1 TOKIO_WORKER_THREADS=2 \
      taskset -c "$SERVER_CPUS" "$ROOT/target/release/rust-service" \
      >"$ROOT/bench/results/rust-bench.log" 2>&1 &
    server_pid=$!
    server_url="http://127.0.0.1:8081"
  else
    ASPNETCORE_URLS=http://127.0.0.1:8082 \
      taskset -c "$SERVER_CPUS" "$ROOT/dotnet-service/publish/cryptobench" \
      >"$ROOT/bench/results/dotnet-bench.log" 2>&1 &
    server_pid=$!
    server_url="http://127.0.0.1:8082"
  fi
}

for service in rust dotnet; do
  echo "benchmark $service"
  start_server "$service"
  if ! wait_health "$server_url"; then
    echo "$service failed to start" >&2
    cat "$ROOT/bench/results/${service}-bench.log" >&2 || true
    exit 1
  fi
  for size in 1024 65536 1048576; do
    for rep in $(seq 1 "$REPETITIONS"); do
      echo "  payload=$size rep=$rep"
      taskset -c "$CLIENT_CPUS" "$ROOT/target/release/crypto-bench" load \
        --url "$server_url/v1/process" \
        --pid "$server_pid" \
        --service "$service" \
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
done

taskset -c "$CLIENT_CPUS" "$ROOT/target/release/crypto-bench" report \
  --input "$ROOT/bench/results/runs.jsonl" \
  --markdown "$ROOT/bench/results/results.md" \
  --csv "$ROOT/bench/results/results.csv" \
  --env-file "$ROOT/bench/results/environment.txt"

echo "results: $ROOT/bench/results/results.md"
