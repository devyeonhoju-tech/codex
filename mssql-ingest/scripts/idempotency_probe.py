#!/usr/bin/env python3
"""Post one vantr twice. Both responses are 202 and only one row is implied by the second 202."""

import json
import sys
import urllib.error
import urllib.request


def post(url: str, vantr: str) -> int:
    body = json.dumps(
        {
            "vantr": vantr,
            "sourceId": "van-terminal-1",
            "timestamp": "2026-11-01T18:00:00Z",
            "payload": "probe",
        }
    ).encode()
    request = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            payload = response.read()
            if payload != b'{"status":"committed"}':
                raise SystemExit(f"unexpected body {payload!r}")
            return response.status
    except urllib.error.HTTPError as error:
        raise SystemExit(f"probe {vantr} failed status={error.code} body={error.read()!r}") from error


def main() -> None:
    base = sys.argv[1].rstrip("/")
    url = f"{base}/v1/ingest"
    vantr = "PROBE-VANTR-1"
    first = post(url, vantr)
    second = post(url, vantr)
    if first != 202 or second != 202:
        raise SystemExit(f"expected two 202 responses, got {first} and {second}")
    print(f"idempotent resend ok vantr={vantr}")


if __name__ == "__main__":
    main()
