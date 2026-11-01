#!/usr/bin/env python3
"""Send one ciphertext to both services and require the same plaintext back.

The client is Python `cryptography`, not either service's AES implementation.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = Path(__file__).resolve().parent


def load_key() -> bytes:
    env = os.environ.get("BENCH_AES_KEY", "").strip()
    if env:
        return bytes.fromhex(env)
    return bytes.fromhex((ROOT / "testdata" / "bench_key.hex").read_text(encoding="utf-8").strip())


def encrypt(aes: AESGCM, plaintext: bytes) -> bytes:
    nonce = os.urandom(12)
    return nonce + aes.encrypt(nonce, plaintext, None)


def fnv1a32(data: bytes) -> int:
    hash_value = 2166136261
    for byte in data:
        hash_value ^= byte
        hash_value = (hash_value * 16777619) & 0xFFFFFFFF
    return hash_value


def full_response(plaintext: bytes) -> bytes:
    parsed = json.loads(plaintext)
    checksum = fnv1a32(plaintext)
    length = len(plaintext)
    tag = (checksum ^ parsed["multiplier"] ^ length) & 0xFFFFFFFF
    return json.dumps(
        {
            "id": parsed["id"],
            "data": parsed["data"],
            "checksum": checksum,
            "length": length,
            "tag": tag,
        },
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")


def decrypt(aes: AESGCM, wire: bytes) -> bytes:
    if len(wire) < 28:
        raise AssertionError(f"truncated wire ({len(wire)} bytes)")
    return aes.decrypt(wire[:12], wire[12:], None)


def request(url: str, body: bytes, content_type: str) -> tuple[int, bytes, str]:
    req = urllib.request.Request(
        url,
        data=body if body else None,
        method="POST" if body else "GET",
        headers={"Content-Type": content_type} if body else {},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return response.status, response.read(), response.headers.get("Content-Type", "")
    except urllib.error.HTTPError as error:
        return error.code, error.read(), error.headers.get("Content-Type", "")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rust", required=True, help="Rust base URL, e.g. http://127.0.0.1:8081")
    parser.add_argument("--dotnet", required=True, help=".NET base URL")
    args = parser.parse_args()
    aes = AESGCM(load_key())
    services = (("rust", args.rust.rstrip("/")), ("dotnet", args.dotnet.rstrip("/")))

    for name, base in services:
        status, body, _ = request(base + "/health", b"", "")
        if status != 200 or body.strip() != b"ok":
            print(f"{name} health failed: {status} {body!r}", file=sys.stderr)
            return 1

    vectors = json.loads((ROOT / "testdata" / "process_vectors.json").read_text(encoding="utf-8"))
    for case in vectors["cases"]:
        wire = encrypt(aes, case["requestJson"].encode("utf-8"))
        opened: dict[str, bytes] = {}
        for name, base in services:
            status, body, content_type = request(base + "/v1/process", wire, "application/octet-stream")
            if status != 200:
                print(f"{name} {case['name']} HTTP {status} {body[:200]!r}", file=sys.stderr)
                return 1
            if not content_type.startswith("application/octet-stream"):
                print(f"{name} {case['name']} content-type {content_type}", file=sys.stderr)
                return 1
            plain = decrypt(aes, body)
            if plain != case["responseJson"].encode("utf-8"):
                print(
                    f"{name} {case['name']} plaintext mismatch\n got {plain!r}\n exp {case['responseJson']!r}",
                    file=sys.stderr,
                )
                return 1
            opened[name] = plain
        if opened["rust"] != opened["dotnet"]:
            print(f"services disagree on {case['name']}", file=sys.stderr)
            return 1
        print(f"ok {case['name']}")

    for size in (1024, 65536, 1048576):
        plain = b'{"id":"bench","data":"' + (b"x" * size) + b'","multiplier":1}'
        expected = full_response(plain)
        wire = encrypt(aes, plain)
        for name, base in services:
            status, body, content_type = request(base + "/v1/process", wire, "application/octet-stream")
            if status != 200 or not content_type.startswith("application/octet-stream"):
                print(f"{name} payload {size} HTTP {status} {body[:120]!r}", file=sys.stderr)
                return 1
            opened_body = decrypt(aes, body)
            if len(opened_body) != len(expected) or opened_body != expected:
                print(
                    f"{name} payload {size} full response mismatch len {len(opened_body)} != {len(expected)}",
                    file=sys.stderr,
                )
                return 1
            if size > len(opened_body):
                print(f"{name} payload {size} response shorter than the payload", file=sys.stderr)
                return 1
        print(f"ok full {size}")

    tamper_src = encrypt(aes, vectors["cases"][1]["requestJson"].encode("utf-8"))
    bad = bytearray(tamper_src)
    bad[-1] ^= 0x01
    chopped = bytes(tamper_src[:-10])
    not_json = encrypt(aes, b"not-json")
    missing = encrypt(aes, b'{"id":"a","multiplier":1}')
    wrong_key = AESGCM(b"\x11" * 32)
    wrong = encrypt(wrong_key, vectors["cases"][1]["requestJson"].encode("utf-8"))
    plaintext_body = vectors["cases"][1]["requestJson"].encode("utf-8")
    probes = (
        ("tamper", bytes(bad), "decrypt_failed"),
        ("truncated-ciphertext", chopped, "decrypt_failed"),
        ("truncated-frame", b"\x00" * 20, "truncated_message"),
        ("not-json", not_json, "invalid_json"),
        ("missing-field", missing, "invalid_request"),
        ("wrong-key", wrong, "decrypt_failed"),
        ("missing-nonce", b"\x00" * 11, "missing_nonce"),
        ("plaintext-body", plaintext_body, "decrypt_failed"),
    )
    for label, wire, code in probes:
        for name, base in services:
            status, body, content_type = request(base + "/v1/process", wire, "application/octet-stream")
            if status != 400 or not content_type.startswith("application/json"):
                print(f"{name} {label}: HTTP {status} {content_type} {body!r}", file=sys.stderr)
                return 1
            if json.loads(body).get("error") != code:
                print(f"{name} {label}: {body!r}", file=sys.stderr)
                return 1
            print(f"ok {label} {name}")

    print("interop ok")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ModuleNotFoundError:
        print("Python package `cryptography` is required. See bench/testdata/requirements.txt.", file=sys.stderr)
        raise SystemExit(1)
