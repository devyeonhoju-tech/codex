# Wire format

Both services and the load generator speak this protocol. Byte layout and the processing step are normative. If an implementation disagrees with this file, the implementation is wrong.

## Transport

- `POST /v1/process`
- Request and successful response bodies are raw bytes, `Content-Type: application/octet-stream`.
- No TLS in this benchmark. Bind to loopback unless you are deliberately measuring a network.
- `GET /health` returns the exact body `ok` (text/plain) when the process is up.
- Failures are **not** encrypted. The body is compact JSON `{"error":"<code>"}` with `Content-Type: application/json`.

| Status | `error` code | When |
| --- | --- | --- |
| 400 | `truncated_message` | Body shorter than 28 bytes |
| 400 | `decrypt_failed` | AES-GCM authentication failed |
| 400 | `invalid_json` | Plaintext is not the request JSON schema |
| 400 | `invalid_request` | JSON parsed but a field is missing or out of range |
| 413 | `body_too_large` | Body larger than 8 MiB (the host may also reject it first) |

Unknown JSON fields on the request are ignored. Duplicate handling follows each stack's JSON parser. Numbers must be JSON integers in range; floats and strings are `invalid_json`.

## Key

`BENCH_AES_KEY` is required. It is 64 hexadecimal characters (32 bytes), optional surrounding whitespace, case-insensitive.

The value checked into `bench/testdata/bench_key.hex` is a **public benchmark key**. It is not secret, it must not be used for real data, and it exists so runs are reproducible. The servers do not embed a fallback key.

## Cipher

AES-256-GCM, 96-bit nonce, 128-bit tag, empty additional authenticated data (no AAD).

Each message a service **sends** uses a fresh nonce from the OS CSPRNG. The tag is the standard 16-byte GCM tag. Decrypting with the wrong key or a flipped bit must fail closed (`decrypt_failed`).

### Byte layout

Both the request body and the successful response body are:

```
offset 0           12 bytes   nonce
offset 12          N bytes    ciphertext
offset 12+N        16 bytes   tag
```

`N` is the plaintext length. Total length is `N + 28`. The ciphertext is not framed any further (no length prefix). This matches the concatenation used by Python `cryptography` `AESGCM.encrypt` (ciphertext || tag) with the nonce prepended.

Known-answer vectors live in `bench/testdata/aes_gcm_kat.json`. They were produced by Python's `cryptography` AESGCM (OpenSSL EVP) and are checked by `bench/check_vectors.py`.

## Plaintext

UTF-8 JSON, compact, no BOM.

### Request

```json
{"id":"<string>","data":"<string>","multiplier":<uint32>}
```

| Field | Rule |
| --- | --- |
| `id` | JSON string, 1 to 256 UTF-8 bytes after decoding |
| `data` | JSON string, 0 to 2,000,000 UTF-8 bytes after decoding |
| `multiplier` | JSON integer, 0 through 4294967295 |

The benchmark's `data` sizes (1 KiB, 64 KiB, 1 MiB) are this decoded UTF-8 length, not the HTTP body size.

### Processing

Let `bytes` be the UTF-8 encoding of `data` (not UTF-16 code units, not the raw JSON text).

FNV-1a 32-bit:

```
hash = 2166136261
for each byte b in bytes:
    hash = (hash XOR b) * 16777619    # mod 2^32
length = number of bytes            # fits in uint32 because of the limit above
tag = hash XOR multiplier XOR length   # uint32 bitwise xor
```

### Response

Compact UTF-8 JSON, no extra whitespace, keys in this order, default JSON string escaping (`"`, `\`, and control characters; do **not** escape `/`; do **not** escape non-ASCII as `\uXXXX`):

```json
{"id":"<same id>","checksum":<hash>,"length":<length>,"tag":<tag>}
```

`checksum`, `length`, and `tag` are JSON numbers, not strings. `id` is echoed exactly.

`bench/testdata/process_vectors.json` holds request JSON, expected response JSON, and the integer fields. Both services must emit those response bytes.

## What the load generator does

`crypto-bench load` builds one request of the chosen `data` length (`id` = `bench`, `data` = `x` repeated, `multiplier` = 1), encrypts it once, and resends those same bytes. Repeating a GCM nonce under one key is not safe in production; it is only so every request is byte-identical. Response nonces are still random. The tool checks one decrypted response against the expected JSON and reports client latency plus the server's CPU and RSS.

## Benchmark defaults

| Knob | Value |
| --- | --- |
| Cipher | AES-256-GCM as above |
| HTTP | HTTP/1.1, keep-alive, TCP_NODELAY when the stack exposes it |
| Payload | 1024, 65536, and 1048576 byte `data` |
| Concurrency | 32 in-flight requests |
| Warm-up | 5 seconds (not recorded) |
| Measure | 10 seconds |
| Repetitions | 3 |
| Summary | median of the three repetitions |
| Linux affinity | server on CPUs 0-1, client on CPUs 2-3 |

Rust server threads follow `TOKIO_WORKER_THREADS`, otherwise the process CPU affinity. The .NET process uses `Environment.ProcessorCount` (affinity-aware on Linux), Server GC, and tiered PGO.
