#!/usr/bin/env python3
"""Check both services aggregate the same five mock bodies."""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = os.path.dirname(os.path.abspath(__file__))


def fnv1a32(data: bytes) -> int:
    value = 2166136261
    for byte in data:
        value ^= byte
        value = (value * 16777619) & 0xFFFFFFFF
    return value


def encrypt(aes: AESGCM, plaintext: bytes) -> bytes:
    nonce = os.urandom(12)
    return nonce + aes.encrypt(nonce, plaintext, None)


def decrypt(aes: AESGCM, wire: bytes) -> bytes:
    return aes.decrypt(wire[:12], wire[12:], None)


def post(url: str, body: bytes, content_type: str) -> tuple[int, bytes]:
    req = urllib.request.Request(url, data=body, method="POST", headers={"Content-Type": content_type})
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


def mock_body(name: str, pad: int) -> str:
    return '{"endpoint":"%s","pad":"%s"}' % (name, "x" * pad)


def expected(plaintext: bytes, pad: int) -> bytes:
    parsed = json.loads(plaintext)
    checksum = fnv1a32(plaintext)
    length = len(plaintext)
    tag = (checksum ^ parsed["multiplier"] ^ length) & 0xFFFFFFFF
    downstream = [
        {"name": name, "status": 200, "body": mock_body(name, pad)}
        for name in "abcde"
    ]
    return json.dumps(
        {
            "id": parsed["id"],
            "data": parsed["data"],
            "checksum": checksum,
            "length": length,
            "tag": tag,
            "downstream": downstream,
        },
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rust", required=True)
    parser.add_argument("--dotnet", required=True)
    parser.add_argument("--pad-bytes", type=int, default=4)
    args = parser.parse_args()
    key = os.environ.get("BENCH_AES_KEY", "").strip() or open(os.path.join(ROOT, "testdata", "bench_key.hex"), encoding="utf-8").read().strip()
    aes = AESGCM(bytes.fromhex(key))
    plain = b'{"id":"hello","data":"hello","multiplier":3}'
    wire = encrypt(aes, plain)
    want = expected(plain, args.pad_bytes)
    opened = {}
    for name, base in (("rust", args.rust), ("dotnet", args.dotnet)):
        status, body = post(base.rstrip("/") + "/v1/process", wire, "application/octet-stream")
        if status != 200:
            print(f"{name} HTTP {status} {body[:200]!r}", file=sys.stderr)
            return 1
        got = decrypt(aes, body)
        if got != want:
            print(f"{name} mismatch\n got {got[:300]!r}\n exp {want[:300]!r}", file=sys.stderr)
            return 1
        opened[name] = got
    if opened["rust"] != opened["dotnet"]:
        print("services disagree", file=sys.stderr)
        return 1
    print(f"downstream interop ok bytes={len(want)}")
    return 0


if __name__ == "__main__":
    import urllib.error

    raise SystemExit(main())
