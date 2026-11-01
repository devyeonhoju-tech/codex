# Observations from the five-call run

`fanout-results.md` is the table. This file is not rewritten by the script. Every repetition in `fanout-runs.jsonl` has `errors: 0` and `verified: true`. The load generator decrypted and compared every 32nd success in full.

`fanout-environment.txt` records `git=7d4847e` because that was HEAD when `bench/run-fanout.sh` started. The measured binaries are the fan-out working tree. The mock and the load generator shared CPUs 2-3. Absolute req/s are indicative.

The matrix is Rust, Server GC, Workstation GC (background on), and Native AOT. No heap cap and no blocking workstation. Payloads are 1 KiB and 64 KiB. Sequential mode and the 20 ms + 0..=30 ms jitter variant are 1 KiB at concurrency 32 only. Downstream pad is 128 bytes. Warm-up 5 s, measure 10 s, three repetitions, median.

## Concurrency 32, 1 KiB

| Mode | rust | server GC | workstation | AOT |
| --- | ---: | ---: | ---: | ---: |
| baseline req/s | 131759.8 | 94958.6 | 106982.0 | 84978.9 |
| baseline RSS MiB | 5.4 | 91.5 | 252.1 | 37.5 |
| concurrent 20 ms req/s | 1442.0 | 1432.6 | 1438.8 | 1430.7 |
| concurrent 100 ms req/s | 310.4 | 310.4 | 310.4 | 310.4 |
| sequential 20 ms req/s | 294.4 | 291.3 | 291.2 | 291.2 |
| sequential 100 ms req/s | 60.8 | 60.8 | 60.8 | 60.8 |
| jitter 20 ms req/s | 682.5 | 681.7 | 682.3 | 681.2 |

Baseline is still CPU-bound and Rust is ahead, with the smallest resident set. Once five calls wait on a 20 ms or 100 ms mock, req/s collapses to the latency budget and the four stacks match. Sequential p50 is about five times the delay (about 509 ms at 100 ms, 107–109 ms at 20 ms). Jitter p50 is about 47.9 ms for all four. RSS at concurrent 100 ms is still Rust 13.6, AOT 59.8, Server GC 123.4, Workstation 254.0.

## Where the stacks separate

At 1 KiB, concurrency 1024, concurrent 100 ms:

| | req/s | p50 ms | p99 ms | CPU | RSS MiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| rust | 9757.0 | 103.615 | 109.631 | 158.5% | 271.7 |
| dotnet-server-gc | 3819.6 | 261.503 | 329.727 | 55.1% | 270.2 |
| dotnet-aot | 3788.8 | 261.631 | 333.567 | 57.9% | 210.0 |
| dotnet-workstation | 3693.7 | 280.575 | 357.119 | 53.9% | 325.7 |

Rust stays near the 100 ms floor and uses more than one core. The .NET rows queue (p50 262–281 ms) and use about half of one core.

At 1 KiB, concurrency 1024, concurrent 20 ms, Server GC completes more requests than Rust. Server GC 14357.8 req/s, p50 70.207 ms, p99 97.087 ms. Rust 12078.3 req/s, p50 32.111 ms, p99 252.671 ms. The Rust median is lower and the tail is much worse. AOT is 13572.2 req/s and Workstation is 12597.6. The mock and the client share two CPUs, so this row is not a clean server measurement.

At 64 KiB and concurrency 32, concurrent 100 ms, everyone is 305.1–307.6 req/s. Concurrent 20 ms: Rust 1379.6, Server GC 1260.7, AOT 1216.1, Workstation 1158.2. Rust RSS on those two rows is 233.0 and 187.7 MiB. Server GC is 133.9 and 138.6. The small Rust resident set from the 1 KiB rows does not hold once a 64 KiB body is fanned out.

At 64 KiB and concurrency 1024, concurrent 100 ms: Rust 2449.7 req/s (p99 755.199 ms, RSS 713.6 MiB) and Server GC 2237.3 (p99 543.743 ms, RSS 615.2 MiB). Both are near 195% CPU.

## What this run does not say

The crypto-only table in `results.md` is a different process. Its 1 KiB Rust baseline is 157886.0 req/s. This file's baseline is 131759.8. Compare fan-out rows with the baseline rows in `fanout-results.md`.

The 1 MiB payload was not run. The 256 MiB heap cap was not run. No repetition returned a downstream 502.
