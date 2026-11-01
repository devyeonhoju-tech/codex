# Observations from the committed run

These notes belong to the tables in `results.md`. `bench/run.sh` rewrites that file and does not rewrite this one.

The `git=` line in `environment.txt` is `f544b618d3b64c19761d06723bceaa0d51eb4dd9`. That commit is the two services. The load generator that produced these numbers also contains the CPU-counter fix committed with the results: it reads `/proc/<pid>/stat` (thread-group total). An earlier pass summed `/proc/<pid>/task/*/stat`. When a thread exits, that sum drops, and one .NET 1 MiB repetition was reported as 0% CPU. That pass was not kept.

## What the medians say

Rust handled more requests at every size. Median requests/sec:

| Payload | Rust | .NET | Rust / .NET |
| ---: | ---: | ---: | ---: |
| 1 KiB | 178525 | 98523 | 1.81 |
| 64 KiB | 15006 | 7799 | 1.92 |
| 1 MiB | 875 | 570 | 1.54 |

Latency moved with throughput: Rust p50 was 0.171 ms, 2.085 ms, and 36.991 ms; .NET was 0.293 ms, 3.991 ms, and 54.751 ms. Every repetition had zero HTTP errors, and the decrypted sample matched the expected JSON (`verified=true`).

The three repetitions sit close together. The .NET 1 MiB row did not keep climbing after the warm-up (566.6, 579.8, 570.2 req/s).

## CPU and memory

Both processes were pinned to CPUs 0-1, so 200% means both allowed cores were busy. Rust sat on that ceiling at every size (about 197–200%). .NET did too at 1 KiB (about 196%) and then sat nearer 167% at 64 KiB and 173% at 1 MiB, which is also where the throughput gap narrows. This run does not isolate whether that idle time is GC, allocation, or memory bandwidth.

Resident set is far apart. At 1 KiB the medians are about 4.7 MiB (Rust) and 90 MiB (.NET). At 1 MiB they are about 36 MiB and 231 MiB. The .NET process is Server GC with two heaps, which holds onto more memory than the Rust allocator on this workload.

At 1 KiB the Rust client used about 170% of one core while the server used about 198%. The script's client-limit check did not fire (it wants the client well above the server). That is still the busiest the client got. At 64 KiB and 1 MiB the client was under 30%.

## Startup lines from this run

- Rust: `tokio_worker_threads=2 aes_ni=true`
- .NET: `processor_count=2 server_gc=True`
- The published `cryptobench.dll` contains a ReadyToRun header (`RTR`). `runtimeconfig.json` enables Server GC, invariant globalization, and tiered PGO.
- Host runtime was `Microsoft.AspNetCore.App` 10.0.14, SDK 10.0.403. Rustc was 1.99.1.

## What this does not show

Localhost on a 4-vCPU KVM guest (Intel Xeon family 6 model 207, AES advertised, 16 GiB). No TLS. The request ciphertext is reused, so the client's nonce does not change; the servers still mint a new nonce per response. Windows runs of `bench/run.ps1` will not reproduce the CPU and RSS columns.
