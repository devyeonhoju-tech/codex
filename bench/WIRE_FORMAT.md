# Wire format

Both services and the load generator speak this protocol. Byte layout and the processing step are normative. If an implementation disagrees with this file, the implementation is wrong.

## Transport

- `POST /v1/process`
- Request and successful response bodies are raw bytes, `Content-Type: application/octet-stream`.
- No TLS in this benchmark. Bind to loopback unless you are deliberately measuring a network.
- `GET /health` returns the exact body `ok` (text/plain) when the process is up.
- Failures are **not** encrypted. The body is compact JSON `{"error":"<code>"}` with `Content-Type: application/json`.

There is no plaintext mode, query flag, or benchmark switch that skips decryption or encryption. `POST /v1/process` always decrypts the entire body and, on success, encrypts the entire response. Anything that is not a complete authentic frame is rejected:

| Status | `error` code | When |
| --- | --- | --- |
| 400 | `missing_nonce` | Body shorter than 12 bytes, so there is no nonce |
| 400 | `truncated_message` | Nonce present, but ciphertext plus tag is shorter than 16 bytes |
| 400 | `decrypt_failed` | Frame is long enough and AES-GCM authentication failed. This includes a tampered tag, a truncated ciphertext that is still at least 28 bytes, a body encrypted with the wrong key, and a plaintext/JSON body that is not a valid frame |
| 400 | `invalid_json` | Decrypted bytes are not the request JSON schema |
| 400 | `invalid_request` | JSON parsed but a field is missing or out of range |
| 413 | `body_too_large` | Body larger than 8 MiB (the host may also reject it first) |

Unknown JSON fields on the request are ignored. Duplicate handling follows each stack's JSON parser. Numbers must be JSON integers in range; floats and strings are `invalid_json`.

## Key

`BENCH_AES_KEY` is required. It is 64 hexadecimal characters (32 bytes), optional surrounding whitespace, case-insensitive.

The value checked into `bench/testdata/bench_key.hex` is a **public benchmark key**. It is not secret, it must not be used for real data, and it exists so runs are reproducible. The servers do not embed a fallback key.

## Cipher

AES-256-GCM, 96-bit nonce, 128-bit tag, empty additional authenticated data (no AAD).

Each message a service **sends** uses a fresh nonce from the OS CSPRNG. The tag is the standard 16-byte GCM tag over the entire plaintext. Decrypting with the wrong key, a flipped bit, or a plaintext body must fail closed (`decrypt_failed` once the body is long enough to be a frame).

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

The checksum covers **every byte of the decrypted request**, including the JSON punctuation, not only the `data` field and not UTF-16 code units.

FNV-1a 32-bit:

```
hash = 2166136261
for each byte b in the decrypted request:
    hash = (hash XOR b) * 16777619    # mod 2^32
length = number of decrypted bytes    # the whole plaintext
tag = hash XOR multiplier XOR length  # uint32 bitwise xor
```

`data` is then copied unchanged into the response. The service encrypts that whole response, so the ciphertext is the size of the payload, not a short digest.

### Response

Compact UTF-8 JSON, no extra whitespace, keys in this order, default JSON string escaping (`"`, `\`, and control characters; do **not** escape `/`; do **not** escape non-ASCII as `\uXXXX`):

```json
{"id":"<same id>","data":"<same data>","checksum":<hash>,"length":<length>,"tag":<tag>}
```

`checksum`, `length`, and `tag` are JSON numbers, not strings. `id` and `data` are echoed exactly. `length` is the decrypted request size, not the length of `data` alone.

### Downstream fan-out

If `BENCH_DOWNSTREAM_URLS` is unset, the response is exactly the object above. If it is set, it must be five comma-separated HTTP URLs. After the checksum is computed, the service POSTs the decrypted request bytes (`Content-Type: application/json`) to each URL. `BENCH_DOWNSTREAM_MODE=concurrent` (the default) issues the five calls together. `BENCH_DOWNSTREAM_MODE=sequential` waits for each before starting the next. Each call times out after `BENCH_DOWNSTREAM_TIMEOUT_MS` (default 2000). Rust keeps one `reqwest` client with a per-host idle pool. .NET uses `IHttpClientFactory` and a shared `SocketsHttpHandler` pool.

The endpoint name is the last path segment of the URL. Results are stored in that URL order, not completion order. On success the encrypted JSON adds:

```json
"downstream":[{"name":"a","status":200,"body":"<raw response text>"}, ...]
```

`body` is the raw response text, not a nested object. A timeout, a connection error, or any non-2xx status on any of the five calls fails the whole request with HTTP 502 and plaintext `{"error":"downstream_failed"}`. Partial aggregates are not returned.

The benchmark never calls the public internet. `crypto-bench mock` is the only downstream. It listens on five `POST /v1/{a,b,c,d,e}` routes, sleeps `delay_ms` plus a uniform `0..=jitter_ms`, and returns:

```json
{"endpoint":"<name>","pad":"<pad_bytes of x>"}
```

`bench/testdata/process_vectors.json` holds request JSON, expected response JSON, and the integer fields. Both services must emit those response bytes. The interop client also checks 1 KiB, 64 KiB, and 1 MiB messages by decrypting the response and comparing its full length and bytes.

## What the load generator does

`crypto-bench load` builds one request of the chosen `data` length (`id` = `bench`, `data` = `x` repeated, `multiplier` = 1), encrypts it once, and resends those same bytes. Repeating a GCM nonce under one key is not safe in production; it is only so every request is byte-identical. Response nonces are still random. During the measured window every 32nd success is decrypted and compared, in full, to the expected response bytes. A repetition with no full match is a failure. The tool also reports client latency plus the server's CPU and RSS.

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

`bench/run.sh` uses the table above, including the 1 MiB payload and the extra .NET GC variants. `bench/run-fanout.sh` keeps the cipher, the warm-up, the 10 second window, and the three repetitions, and changes the matrix: payloads 1024 and 65536, in-flight concurrency 32, 256, and 1024, and a local five-endpoint mock. Sequential mode and the jitter variant are measured only at 1024 bytes and concurrency 32. The mock is pinned to the same CPUs as the load generator. The 1 MiB payload, the 256 MiB heap cap, and blocking workstation GC are not part of that run.

Rust server threads follow `TOKIO_WORKER_THREADS`, otherwise the process CPU affinity. The .NET process uses `Environment.ProcessorCount` (affinity-aware on Linux), Server GC, and tiered PGO.
