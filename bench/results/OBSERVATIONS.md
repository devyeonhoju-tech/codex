# Observations from the GC-variant run

`results.md` is the table. This note is the reading of it. `bench/run.sh` rewrites the table and does not rewrite this file.

`environment.txt` records `git=83729cb` because that was HEAD when the script started. The binaries in this run were built from the working tree that also contains the GC startup line and the variant runner; those changes land in the commit that adds this file.

Startup lines confirmed the modes: Server GC `server_gc=True concurrent_gc=True`; workstation `server_gc=False concurrent_gc=True`; blocking workstation `server_gc=False concurrent_gc=False`; heap cap `heap_hard_limit=134217728` (128 MiB). Every repetition had zero HTTP errors and a decrypted sample that matched. Native AOT did not publish (`aot-publish.txt`).

## Medians

| Variant | 1 KiB req/s | 1 KiB RSS | 64 KiB req/s | 64 KiB RSS | 1 MiB req/s | 1 MiB RSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| rust | 182545.1 | 4.7 | 15192.7 | 8.8 | 888.8 | 35.8 |
| dotnet-server-gc | 100023.6 | 91.4 | 7780.1 | 110.2 | 546.1 | 220.9 |
| dotnet-workstation | 94607.6 | 249.5 | 6177.0 | 98.8 | 541.7 | 333.8 |
| dotnet-workstation-blocking | 106334.7 | 251.0 | 6793.7 | 101.4 | 533.3 | 214.4 |
| dotnet-heap-limit (128 MiB) | 95258.2 | 91.1 | 7490.9 | 109.6 | 438.4 | 187.0 |

p50/p95/p99 and CPU are in `results.md`. Rust stayed near 200% CPU. The .NET rows were near 200% at 1 KiB and lower on the bigger payloads, same pattern as the earlier run.

## What the memory gap did

Workstation GC was the obvious candidate for the 4.7 MiB vs 91.4 MiB gap, and it went the other way at 1 KiB: 249.5 MiB RSS instead of 91.4 MiB, with fewer requests/sec (94607.6 vs 100023.6). The GC was told the machine had about 11.7 GB available (`total_available_bytes` in the log) and, under this allocation rate, it kept a much larger heap. At 64 KiB workstation RSS did fall a bit (98.8 vs 110.2 MiB) and throughput fell more (6177.0 vs 7780.1). At 1 MiB workstation RSS rose to 333.8 MiB against the baseline 220.9 MiB, with almost the same throughput (541.7 vs 546.1).

Turning background GC off (blocking workstation) did not shrink the 1 KiB heap either (251.0 MiB). It was the fastest .NET mode at 1 KiB (106334.7 req/s, p50 0.297 ms) and still behind Rust. At 64 KiB and 1 MiB it was slower than Server GC. At 1 MiB its RSS (214.4 MiB) was close to Server GC, unlike the background workstation heap (333.8 MiB).

The 128 MiB hard limit does not touch the 1 KiB result: RSS stays 91.1 MiB because that process was already under the cap, and throughput drops from 100023.6 to 95258.2 req/s. At 64 KiB the cap is also barely visible (109.6 vs 110.2 MiB, 7490.9 vs 7780.1 req/s). At 1 MiB the cap binds. RSS falls from 220.9 to 187.0 MiB and throughput falls from 546.1 to 438.4 req/s, with p99 moving from 94.527 ms to 120.447 ms. A 64 MiB cap was tried first and returned HTTP 500 on the 1 MiB payload at 32 in-flight requests, so it is not in the table.

No GC setting measured here approaches Rust's 4.7 MiB. The baseline 90 MiB is the Server GC steady state for this process on this machine, not a switch that was left in the expensive position.

## Recommendation

Keep **dotnet-server-gc** for this service and for the comparison with Rust. It is the smallest .NET heap at 1 KiB, and it is the fastest .NET mode at 64 KiB and 1 MiB. Blocking workstation wins only the 1 KiB throughput row, and it triples that row's RSS. The 128 MiB cap is worth turning on only if the 1 MiB process must stay under roughly 200 MiB RSS and a 20% throughput cut is acceptable. It does not fix the 1 KiB gap the question started from.
