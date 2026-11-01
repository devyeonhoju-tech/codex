#!/usr/bin/env bash
# Download a pinned k6 binary into mssql-ingest/.tools. No sudo required.
set -euo pipefail

VERSION="${K6_VERSION:-v2.3.0}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/.tools"
mkdir -p "$DEST"

if [[ -x "$DEST/k6" ]]; then
  exit 0
fi

arch="$(uname -m)"
case "$arch" in
  x86_64) karch=amd64 ;;
  aarch64|arm64) karch=arm64 ;;
  *) echo "unsupported architecture: $arch" >&2; exit 1 ;;
esac

url="https://github.com/grafana/k6/releases/download/${VERSION}/k6-${VERSION}-linux-${karch}.tar.gz"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
curl -fsSL "$url" -o "$tmpdir/k6.tgz"
tar -xzf "$tmpdir/k6.tgz" -C "$tmpdir"
install -m 0755 "$tmpdir"/k6-*/k6 "$DEST/k6"
"$DEST/k6" version
