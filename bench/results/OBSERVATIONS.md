# Observations from the full-message run

The decrypted request is hashed in full, and the encrypted response echoes `data`, so the ciphertext is the size of the payload rather than a short digest. `results.md` is the table from that run. The script does not rewrite this file.

`environment.txt` records `git=e27496e` because that was HEAD when the script started. The processing change is in the commit that adds these results.

Interop, including the Native AOT binary, checked 1 KiB, 64 KiB, and 1 MiB responses by length and bytes, and rejected a tampered tag, a truncated ciphertext, a truncated frame, a wrong key, a missing nonce, and a plaintext body. During each load repetition every 32nd success was decrypted and compared in full. Sample counts on the 1 MiB rows are about 160 per repetition, with `verified=true` and zero HTTP errors.

## What changed versus the previous run

The previous response was a small JSON digest. Encrypting the echoed payload lowered throughput. Medians:

| Variant | 1 KiB req/s then | 1 KiB req/s now | 1 MiB req/s then | 1 MiB req/s now |
| --- | ---: | ---: | ---: | ---: |
| rust | 185926.3 | 157886.0 | 875.4 | 533.8 |
| dotnet-server-gc | 101956.6 | 95544.9 | 576.9 | 483.9 |
| dotnet-aot | 92096.4 | 83945.6 | 518.9 | 466.0 |

1 KiB RSS stayed in the same place: Rust 4.6 to 4.9 MiB, Server GC 89.6 to 90.1, AOT 35.0 to 33.4. 1 MiB RSS rose where the larger response has to live: Server GC 231.5 to 278.2 MiB, AOT 149.8 to 211.9.

## This run

| Variant | 1 KiB req/s | 1 KiB RSS | 64 KiB req/s | 64 KiB RSS | 1 MiB req/s | 1 MiB RSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| rust | 157886.0 | 4.9 | 9934.8 | 9.0 | 533.8 | 38.8 |
| dotnet-server-gc | 95544.9 | 90.1 | 7166.6 | 125.9 | 483.9 | 278.2 |
| dotnet-workstation | 109161.3 | 250.4 | 7930.7 | 211.7 | 484.3 | 521.0 |
| dotnet-workstation-blocking | 106948.1 | 251.2 | 6344.2 | 105.7 | 475.8 | 270.7 |
| dotnet-heap-limit (256 MiB) | 93620.1 | 91.1 | 7038.9 | 125.1 | 474.2 | 279.7 |
| dotnet-aot | 83945.6 | 33.4 | 6254.1 | 74.4 | 466.0 | 211.9 |

p50, p95, p99, and CPU are in `results.md`. Startup to the first `/health`: Rust 6 ms, AOT 58 ms, JIT 163–190 ms. The AOT image is 16,005,008 bytes.

The 256 MiB cap does not separate itself from Server GC at 1 MiB (474.2 vs 483.9 req/s, 279.7 vs 278.2 MiB). A 128 MiB cap, which was enough when the response was a digest, returns HTTP 500 on this full-size 1 MiB response at 32 in-flight requests. That is why the published cap moved.

Workstation GC is again the large heap: 250.4 MiB at 1 KiB and 521.0 MiB at 1 MiB. It was the fastest .NET row at 1 KiB and 64 KiB.

## Recommendation

Native AOT remains the .NET build that keeps the smallest resident set (33.4 MiB at 1 KiB, 211.9 MiB at 1 MiB) and the faster start. It is also the slowest .NET row at 1 KiB and 64 KiB. Server GC is the straightforward JIT default and matches workstation at 1 MiB without the 521 MiB heap. The heap cap is not doing useful work at 256 MiB, and a tighter cap fails the full-size 1 MiB payload.
