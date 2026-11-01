#!/usr/bin/env bash
# Hold a modest rate, pause SQL Server for a few seconds, then let the client
# resend. Duplicate vantr rows must stay at zero. Indicative, one cloud VM.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE="${1:-dotnet}"
MODE="${2:-batch}"
CONTAINER="${SQL_CONTAINER:-mssql-ingest-mssql-1}"

export RATE="${RATE:-200}"
export DURATION="${DURATION:-25s}"
export WARMUP="${WARMUP:-3s}"
export WARMUP_RATE="${WARMUP_RATE:-50}"
export RESEND_RATIO="${RESEND_RATIO:-0.08}"
export RETRY_ATTEMPTS="${RETRY_ATTEMPTS:-6}"
export HTTP_TIMEOUT="${HTTP_TIMEOUT:-3s}"
export PRE_ALLOCATED_VUS="${PRE_ALLOCATED_VUS:-80}"
export MAX_VUS="${MAX_VUS:-400}"
export STRICT=0

(
  sleep 10
  echo "pausing ${CONTAINER}"
  docker pause "$CONTAINER"
  sleep 4
  echo "unpausing ${CONTAINER}"
  docker unpause "$CONTAINER"
) &
PAUSE_PID=$!

set +e
bash "$ROOT/scripts/measure.sh" "$SERVICE" "$MODE" sustain
STATUS=$?
set -e
wait "$PAUSE_PID" || true
exit "$STATUS"
