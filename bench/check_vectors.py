#!/usr/bin/env python3
"""Recompute the shared vectors with an implementation that is neither service.

Processing uses this file's FNV-1a. AES-256-GCM uses the `cryptography` package
(OpenSSL EVP), not RustCrypto and not System.Security.Cryptography.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "testdata"


def fnv1a32(data: bytes) -> int:
    hash_value = 2166136261
    for byte in data:
        hash_value ^= byte
        hash_value = (hash_value * 16777619) & 0xFFFFFFFF
    return hash_value


def main() -> int:
    vectors = json.loads((DATA / "process_vectors.json").read_text(encoding="utf-8"))
    if not vectors["cases"]:
        print("no process vectors", file=sys.stderr)
        return 1
    for case in vectors["cases"]:
        parsed = json.loads(case["requestJson"])
        if parsed["id"] != case["id"] or parsed["data"] != case["data"] or parsed["multiplier"] != case["multiplier"]:
            print(f"request JSON does not match fields: {case['name']}", file=sys.stderr)
            return 1
        raw_message = case["requestJson"].encode("utf-8")
        checksum = fnv1a32(raw_message)
        length = len(raw_message)
        tag = (checksum ^ case["multiplier"] ^ length) & 0xFFFFFFFF
        if (checksum, length, tag) != (case["checksum"], case["length"], case["tag"]):
            print(
                f"checksum mismatch: {case['name']} got {(checksum, length, tag)} file {(case['checksum'], case['length'], case['tag'])}",
                file=sys.stderr,
            )
            return 1
        expected = {
            "id": case["id"],
            "data": case["data"],
            "checksum": checksum,
            "length": length,
            "tag": tag,
        }
        encoded = json.dumps(expected, separators=(",", ":"), ensure_ascii=False)
        if encoded != case["responseJson"]:
            print(f"response JSON mismatch: {case['name']}\n {encoded}\n {case['responseJson']}", file=sys.stderr)
            return 1

    kat = json.loads((DATA / "aes_gcm_kat.json").read_text(encoding="utf-8"))
    key = bytes.fromhex(kat["keyHex"])
    if key.hex() != (DATA / "bench_key.hex").read_text(encoding="utf-8").strip():
        print("KAT key and bench_key.hex differ", file=sys.stderr)
        return 1
    aes = AESGCM(key)
    if not kat["cases"]:
        print("no AES vectors", file=sys.stderr)
        return 1
    for case in kat["cases"]:
        nonce = bytes.fromhex(case["nonceHex"])
        plaintext = bytes.fromhex(case["plaintextHex"])
        sealed = aes.encrypt(nonce, plaintext, None)
        ciphertext, tag = sealed[:-16], sealed[-16:]
        if ciphertext.hex() != case["ciphertextHex"] or tag.hex() != case["tagHex"]:
            print(f"AES KAT mismatch: {case['name']}", file=sys.stderr)
            return 1
        if aes.decrypt(nonce, sealed, None) != plaintext:
            print(f"AES decrypt mismatch: {case['name']}", file=sys.stderr)
            return 1
    print(f"vectors ok ({len(vectors['cases'])} process, {len(kat['cases'])} aes)")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ModuleNotFoundError:
        print("Python package `cryptography` is required. See bench/testdata/requirements.txt.", file=sys.stderr)
        raise SystemExit(1)
