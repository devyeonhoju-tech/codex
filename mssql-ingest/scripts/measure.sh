#!/usr/bin/env bash
# Repeatable ingest load test.
#   ./scripts/measure.sh dotnet batch sustain
#   ./scripts/measure.sh dotnet single sustain
#   ./scripts/measure.sh rust batch sustain
#   ./scripts/measure.sh dotnet batch step
#   ./scripts/measure.sh dotnet batch smoke
#
# smoke is the CI profile: about 10s at a low rate. sustain is the 60s / 1000 rps run.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE="${1:-dotnet}"
MODE="${2:-batch}"
PROFILE="${3:-sustain}"

case "$SERVICE" in
  dotnet|rust) ;;
  *) echo "service must be dotnet or rust" >&2; exit 2 ;;
esac
case "$MODE" in
  batch|single) ;;
  *) echo "mode must be batch or single" >&2; exit 2 ;;
esac
case "$PROFILE" in
  sustain|step|smoke) ;;
  *) echo "profile must be sustain, step, or smoke" >&2; exit 2 ;;
esac

export MSSQL_PASSWORD="${MSSQL_PASSWORD:-Ingest_Local_Dev1!}"
export MSSQL_HOST="${MSSQL_HOST:-127.0.0.1}"
export MSSQL_PORT="${MSSQL_PORT:-1433}"
export MSSQL_USER="${MSSQL_USER:-sa}"
export MSSQL_DATABASE="${MSSQL_DATABASE:-ingest}"
export INGEST_WRITE_MODE="$MODE"
export PAYLOAD_BYTES="${PAYLOAD_BYTES:-512}"
export DOTNET_CLI_TELEMETRY_OPTOUT=1
export DOTNET_NOLOGO=1
if [[ -d "${HOME}/.dotnet" ]]; then
  export PATH="${HOME}/.dotnet:${PATH}"
  export DOTNET_ROOT="${DOTNET_ROOT:-${HOME}/.dotnet}"
fi

if [[ "$PROFILE" == "smoke" ]]; then
  export RATE="${RATE:-50}"
  export DURATION="${DURATION:-10s}"
  export WARMUP="${WARMUP:-2s}"
  export WARMUP_RATE="${WARMUP_RATE:-20}"
  export PRE_ALLOCATED_VUS="${PRE_ALLOCATED_VUS:-40}"
  export MAX_VUS="${MAX_VUS:-120}"
  export RESEND_RATIO="${RESEND_RATIO:-0.1}"
  STRICT="${STRICT:-1}"
elif [[ "$PROFILE" == "step" ]]; then
  export RATE="${RATE:-0}"
  export DURATION="${DURATION:-110s}"
  export RESEND_RATIO="${RESEND_RATIO:-0}"
  STRICT="${STRICT:-0}"
else
  export RESEND_RATIO="${RESEND_RATIO:-0}"
  export RATE="${RATE:-1000}"
  export DURATION="${DURATION:-60s}"
  export WARMUP="${WARMUP:-15s}"
  export WARMUP_RATE="${WARMUP_RATE:-200}"
  export PRE_ALLOCATED_VUS="${PRE_ALLOCATED_VUS:-500}"
  export MAX_VUS="${MAX_VUS:-2500}"
  STRICT="${STRICT:-0}"
fi

if [[ "$SERVICE" == "dotnet" ]]; then
  export PORT="${PORT:-8081}"
else
  export PORT="${PORT:-8082}"
fi
export BIND="${BIND:-127.0.0.1}"
export BASE_URL="http://${BIND}:${PORT}"
export STRICT_FLAG="$STRICT"

bash "$ROOT/scripts/install-k6.sh"
K6="$ROOT/.tools/k6"

wait_for_sql() {
  python3 - "$MSSQL_HOST" "$MSSQL_PORT" << 'PY'
import socket, sys, time
host, port = sys.argv[1], int(sys.argv[2])
for _ in range(90):
    try:
        with socket.create_connection((host, port), 2):
            raise SystemExit(0)
    except OSError:
        time.sleep(1)
print("SQL Server did not accept connections on %s:%s" % (host, port), file=sys.stderr)
raise SystemExit(1)
PY
}

if ! python3 - "$MSSQL_HOST" "$MSSQL_PORT" << 'PY'
import socket, sys
host, port = sys.argv[1], int(sys.argv[2])
try:
    with socket.create_connection((host, port), 2):
        raise SystemExit(0)
except OSError:
    raise SystemExit(1)
PY
then
  if command -v docker >/dev/null 2>&1 && [[ -f "$ROOT/docker-compose.yml" ]]; then
    docker compose -f "$ROOT/docker-compose.yml" up -d
  fi
fi
wait_for_sql

SQL_CONTAINER="${SQL_CONTAINER:-}"
if [[ -z "$SQL_CONTAINER" ]] && command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  SQL_CONTAINER="$(docker ps --format '{{.Names}} {{.Image}}' | awk '/mssql\/server/ {print $1; exit}')"
fi

RESULTS="$ROOT/results"
mkdir -p "$RESULTS"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TAG="${SERVICE}-${MODE}-${PROFILE}-${STAMP}"
LOG="$RESULTS/${TAG}.log"
SAMPLE="$RESULTS/${TAG}.csv"
SUMMARY="$RESULTS/${TAG}.summary.json"
K6_CSV="$RESULTS/${TAG}.k6.csv"
META="$RESULTS/${TAG}.meta.json"
OUT="$RESULTS/${TAG}.json"
export SUMMARY_PATH="$SUMMARY"

if [[ "$SERVICE" == "dotnet" ]]; then
  dotnet publish "$ROOT/dotnet/MssqlIngest.csproj" -c Release -o "$ROOT/dotnet/publish" --nologo >/dev/null
  bin=(dotnet "$ROOT/dotnet/publish/mssql-ingest.dll")
else
  cargo build --release --manifest-path "$ROOT/rust/Cargo.toml" >/dev/null
  bin=("$ROOT/rust/target/release/mssql-ingest")
fi

"${bin[@]}" truncate >/dev/null

if [[ "$SERVICE" == "rust" ]]; then
  setsid "${bin[@]}" serve >"$LOG" 2>&1 &
else
  setsid "${bin[@]}" >"$LOG" 2>&1 &
fi
SERVER_PID=$!
SAMPLER_PID=""

cleanup() {
  local status=$?
  trap - EXIT
  if [[ -n "${SAMPLER_PID}" ]] && kill -0 "$SAMPLER_PID" 2>/dev/null; then
    kill "$SAMPLER_PID" 2>/dev/null || true
    wait "$SAMPLER_PID" 2>/dev/null || true
  fi
  if [[ -n "${SERVER_PID}" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  exit "$status"
}
trap cleanup EXIT

ready=0
for _ in $(seq 1 60); do
  if curl -sf "$BASE_URL/ready" >/dev/null; then
    ready=1
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "server exited before /ready" >&2
    cat "$LOG" >&2 || true
    exit 1
  fi
  sleep 0.5
done
if [[ "$ready" != "1" ]]; then
  echo "timed out waiting for $BASE_URL/ready" >&2
  cat "$LOG" >&2 || true
  exit 1
fi

if [[ "$PROFILE" == "smoke" ]]; then
  python3 "$ROOT/scripts/idempotency_probe.py" "$BASE_URL"
  "${bin[@]}" truncate >/dev/null
fi

python3 "$ROOT/scripts/sample_resources.py" --pid "$SERVER_PID" --sql-container "$SQL_CONTAINER" --out "$SAMPLE" &
SAMPLER_PID=$!

if [[ "$PROFILE" == "step" ]]; then
  SCRIPT="$ROOT/load/step.js"
  PHASE="step"
else
  SCRIPT="$ROOT/load/sustain.js"
  PHASE="sustain"
fi

set +e
"$K6" run --out "csv=${K6_CSV}" "$SCRIPT"
K6_EXIT=$?
set -e
if [[ "$K6_EXIT" -ne 0 ]]; then
  echo "k6 exited ${K6_EXIT}" >&2
fi

sleep 1
STATS_AFTER="$(curl -sf "$BASE_URL/stats" || echo '{}')"
COUNT="$("${bin[@]}" count)"
INFO="$("${bin[@]}" info || true)"
printf '%s\n' "$STATS_AFTER" > "$RESULTS/${TAG}.stats.json"
printf '%s\n' "$COUNT" > "$RESULTS/${TAG}.count.txt"
printf '%s\n' "$INFO" > "$RESULTS/${TAG}.info.txt"

kill "$SERVER_PID" 2>/dev/null || true
wait "$SERVER_PID" 2>/dev/null || true
SERVER_PID=""
if [[ -n "$SAMPLER_PID" ]]; then
  wait "$SAMPLER_PID" 2>/dev/null || true
  SAMPLER_PID=""
fi

export RESULT_TAG="$TAG"
export RESULT_PHASE="$PHASE"
export RESULT_SERVICE="$SERVICE"
export RESULT_MODE="$MODE"
export RESULT_PROFILE="$PROFILE"
export RESULT_STATS="$STATS_AFTER"
export RESULT_COUNT="$COUNT"
export RESULT_INFO="$INFO"
export RESULT_META="$META"
python3 - << 'PY'
import json, os, platform
stats = json.loads(os.environ["RESULT_STATS"] or "{}")
count = {}
for line in os.environ["RESULT_COUNT"].splitlines():
    if "=" in line:
        key, value = line.split("=", 1)
        count[key] = value
info = {}
for line in os.environ["RESULT_INFO"].splitlines():
    if "=" in line:
        key, value = line.split("=", 1)
        info[key] = value
duration = os.environ["DURATION"]
number = int("".join(ch for ch in duration if ch.isdigit()) or "0")
if duration.endswith("ms"):
    seconds = number / 1000
elif duration.endswith("m") and not duration.endswith("ms"):
    seconds = number * 60
else:
    seconds = number
meta = {
    "service": os.environ["RESULT_SERVICE"],
    "mode": os.environ["RESULT_MODE"],
    "profile": os.environ["RESULT_PROFILE"],
    "phase": os.environ["RESULT_PHASE"],
    "target_rps": float(os.environ.get("RATE") or 0),
    "duration_seconds": seconds,
    "rows": int(count.get("rows", "0")),
    "distinct_ids": int(count.get("distinct_ids", "0")),
    "batch_size": stats.get("batchSize"),
    "flush_interval_ms": stats.get("flushIntervalMs"),
    "writers": stats.get("writers"),
    "batches": stats.get("batches"),
    "payload_bytes": int(os.environ.get("PAYLOAD_BYTES", "512")),
    "resend_ratio": float(os.environ.get("RESEND_RATIO", "0") or 0),
    "recovery_model": info.get("recovery_model", ""),
    "delayed_durability": info.get("delayed_durability", ""),
    "host": platform.node(),
    "cpus": os.cpu_count(),
    "strict": os.environ.get("STRICT_FLAG", "0") == "1",
}
with open(os.environ["RESULT_META"], "w", encoding="utf-8") as handle:
    json.dump(meta, handle)
PY

python3 "$ROOT/scripts/summarize.py" \
  --summary "$SUMMARY" \
  --samples "$SAMPLE" \
  --csv "$K6_CSV" \
  --meta "$META" \
  --out "$OUT"

if [[ "$PROFILE" == "step" ]]; then
  python3 "$ROOT/scripts/step_rates.py" --csv "$K6_CSV" --out "$RESULTS/${TAG}.steps.json" || true
fi

echo "result: $OUT"
if [[ "$K6_EXIT" -ne 0 ]]; then
  exit "$K6_EXIT"
fi
