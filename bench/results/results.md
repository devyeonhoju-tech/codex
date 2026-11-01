# Benchmark results

These numbers were measured by `bench/run.sh` on this machine. They are not a general ranking of Rust and C#. Absolute throughput will move on other hardware, and a shared cloud VM is noisy.

Summary values are the **median of 3 repetitions**. Each repetition is a closed-loop HTTP/1.1 run: 32 in-flight requests, 5s warm-up (discarded), 10s measured. Payload is the UTF-8 length of the JSON `data` field. CPU is server user+system time from `/proc/<pid>/stat` over the measured window, where 100% means one fully busy core. RSS is the server's resident set during that window.

## Summary

| Service | Payload | HTTP body | RPS | p50 ms | p95 ms | p99 ms | CPU (1 core = 100%) | RSS avg MiB | RSS peak MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| rust | 1024 | 1091 | 182545.1 | 0.167 | 0.259 | 0.292 | 197.6 | 4.7 | 4.7 |
| dotnet-server-gc | 1024 | 1091 | 100023.6 | 0.293 | 0.575 | 0.667 | 196.3 | 91.4 | 91.5 |
| dotnet-workstation | 1024 | 1091 | 94607.6 | 0.331 | 0.488 | 0.639 | 197.2 | 249.5 | 249.6 |
| dotnet-workstation-blocking | 1024 | 1091 | 106334.7 | 0.297 | 0.431 | 0.577 | 197.9 | 251.0 | 251.7 |
| dotnet-heap-limit | 1024 | 1091 | 95258.2 | 0.298 | 0.624 | 0.791 | 189.6 | 91.1 | 91.1 |
| rust | 65536 | 65603 | 15192.7 | 2.067 | 3.105 | 3.511 | 200.0 | 8.8 | 9.2 |
| dotnet-server-gc | 65536 | 65603 | 7780.1 | 4.015 | 6.699 | 9.639 | 165.9 | 110.2 | 123.3 |
| dotnet-workstation | 65536 | 65603 | 6177.0 | 4.947 | 7.423 | 8.895 | 152.4 | 98.8 | 99.4 |
| dotnet-workstation-blocking | 65536 | 65603 | 6793.7 | 4.615 | 6.591 | 7.587 | 149.8 | 101.4 | 102.2 |
| dotnet-heap-limit | 65536 | 65603 | 7490.9 | 4.183 | 7.131 | 9.775 | 165.1 | 109.6 | 123.7 |
| rust | 1048576 | 1048643 | 888.8 | 36.383 | 54.271 | 60.255 | 200.0 | 35.8 | 40.4 |
| dotnet-server-gc | 1048576 | 1048643 | 546.1 | 57.183 | 80.703 | 94.527 | 168.8 | 220.9 | 267.5 |
| dotnet-workstation | 1048576 | 1048643 | 541.7 | 57.599 | 80.255 | 90.943 | 189.7 | 333.8 | 429.1 |
| dotnet-workstation-blocking | 1048576 | 1048643 | 533.3 | 59.775 | 80.511 | 92.287 | 169.8 | 214.4 | 298.2 |
| dotnet-heap-limit | 1048576 | 1048643 | 438.4 | 72.063 | 99.775 | 120.447 | 161.2 | 187.0 | 207.9 |

## Every repetition

| Service | Payload | Rep | Requests | Errors | RPS | p50 ms | p95 ms | p99 ms | Server CPU | Client CPU | RSS avg | RSS peak | Affinity | Verified |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| rust | 1024 | 1 | 1794396 | 0 | 179439.6 | 0.170 | 0.265 | 0.296 | 197.7 | 172.5 | 4.4 | 4.4 | 0-1 | true |
| rust | 1024 | 2 | 1835931 | 0 | 183593.1 | 0.165 | 0.259 | 0.292 | 197.6 | 170.6 | 4.7 | 4.7 | 0-1 | true |
| rust | 1024 | 3 | 1825451 | 0 | 182545.1 | 0.167 | 0.259 | 0.291 | 197.4 | 168.9 | 4.8 | 4.8 | 0-1 | true |
| dotnet-server-gc | 1024 | 1 | 999428 | 0 | 99942.8 | 0.293 | 0.577 | 0.672 | 195.8 | 92.7 | 90.3 | 90.4 | 0-1 | true |
| dotnet-server-gc | 1024 | 2 | 1016673 | 0 | 101667.3 | 0.293 | 0.542 | 0.632 | 196.9 | 96.1 | 91.4 | 91.5 | 0-1 | true |
| dotnet-server-gc | 1024 | 3 | 1000236 | 0 | 100023.6 | 0.292 | 0.575 | 0.667 | 196.3 | 94.4 | 91.7 | 91.7 | 0-1 | true |
| dotnet-workstation | 1024 | 1 | 946076 | 0 | 94607.6 | 0.331 | 0.492 | 0.724 | 196.7 | 99.3 | 248.6 | 248.8 | 0-1 | true |
| dotnet-workstation | 1024 | 2 | 974930 | 0 | 97493.0 | 0.325 | 0.468 | 0.622 | 197.2 | 100.8 | 249.5 | 249.6 | 0-1 | true |
| dotnet-workstation | 1024 | 3 | 938535 | 0 | 93853.5 | 0.338 | 0.488 | 0.639 | 197.6 | 100.8 | 250.1 | 250.1 | 0-1 | true |
| dotnet-workstation-blocking | 1024 | 1 | 1021583 | 0 | 102158.3 | 0.311 | 0.450 | 0.622 | 197.4 | 98.9 | 248.8 | 248.9 | 0-1 | true |
| dotnet-workstation-blocking | 1024 | 2 | 1078698 | 0 | 107869.8 | 0.295 | 0.422 | 0.537 | 197.9 | 103.6 | 251.0 | 251.7 | 0-1 | true |
| dotnet-workstation-blocking | 1024 | 3 | 1063347 | 0 | 106334.7 | 0.297 | 0.431 | 0.577 | 197.9 | 101.1 | 256.3 | 256.3 | 0-1 | true |
| dotnet-heap-limit | 1024 | 1 | 945424 | 0 | 94542.4 | 0.298 | 0.637 | 0.804 | 187.0 | 89.7 | 90.1 | 90.3 | 0-1 | true |
| dotnet-heap-limit | 1024 | 2 | 982566 | 0 | 98256.6 | 0.295 | 0.582 | 0.738 | 189.6 | 92.1 | 91.1 | 91.1 | 0-1 | true |
| dotnet-heap-limit | 1024 | 3 | 952582 | 0 | 95258.2 | 0.299 | 0.624 | 0.791 | 189.7 | 91.4 | 91.5 | 91.5 | 0-1 | true |
| rust | 65536 | 1 | 153001 | 0 | 15300.1 | 2.053 | 3.089 | 3.407 | 200.0 | 25.3 | 8.3 | 8.5 | 0-1 | true |
| rust | 65536 | 2 | 150440 | 0 | 15044.0 | 2.085 | 3.129 | 3.533 | 200.0 | 25.4 | 8.8 | 9.2 | 0-1 | true |
| rust | 65536 | 3 | 151927 | 0 | 15192.7 | 2.067 | 3.105 | 3.511 | 199.9 | 25.4 | 8.8 | 9.2 | 0-1 | true |
| dotnet-server-gc | 65536 | 1 | 77000 | 0 | 7700.0 | 4.029 | 6.987 | 9.551 | 165.2 | 14.6 | 110.2 | 123.3 | 0-1 | true |
| dotnet-server-gc | 65536 | 2 | 78412 | 0 | 7841.2 | 3.941 | 6.699 | 9.639 | 168.1 | 15.2 | 110.1 | 131.4 | 0-1 | true |
| dotnet-server-gc | 65536 | 3 | 77801 | 0 | 7780.1 | 4.015 | 6.499 | 9.647 | 165.9 | 14.9 | 110.7 | 120.6 | 0-1 | true |
| dotnet-workstation | 65536 | 1 | 60122 | 0 | 6012.2 | 5.127 | 7.739 | 9.415 | 153.6 | 13.8 | 98.8 | 99.2 | 0-1 | true |
| dotnet-workstation | 65536 | 2 | 61770 | 0 | 6177.0 | 4.947 | 7.423 | 8.895 | 152.4 | 13.8 | 98.6 | 99.6 | 0-1 | true |
| dotnet-workstation | 65536 | 3 | 65504 | 0 | 6550.4 | 4.707 | 6.863 | 7.955 | 151.1 | 13.8 | 98.8 | 99.4 | 0-1 | true |
| dotnet-workstation-blocking | 65536 | 1 | 68245 | 0 | 6824.5 | 4.615 | 6.487 | 7.363 | 149.7 | 13.5 | 101.4 | 102.2 | 0-1 | true |
| dotnet-workstation-blocking | 65536 | 2 | 67545 | 0 | 6754.5 | 4.631 | 6.631 | 7.859 | 150.0 | 13.3 | 101.3 | 102.2 | 0-1 | true |
| dotnet-workstation-blocking | 65536 | 3 | 67937 | 0 | 6793.7 | 4.587 | 6.591 | 7.587 | 149.8 | 13.6 | 101.4 | 102.3 | 0-1 | true |
| dotnet-heap-limit | 65536 | 1 | 74909 | 0 | 7490.9 | 4.183 | 6.763 | 9.575 | 165.1 | 14.7 | 109.1 | 120.1 | 0-1 | true |
| dotnet-heap-limit | 65536 | 2 | 75028 | 0 | 7502.8 | 4.123 | 7.235 | 10.047 | 164.0 | 14.6 | 109.6 | 125.1 | 0-1 | true |
| dotnet-heap-limit | 65536 | 3 | 73903 | 0 | 7390.3 | 4.183 | 7.131 | 9.775 | 166.1 | 14.3 | 110.8 | 123.7 | 0-1 | true |
| rust | 1048576 | 1 | 8811 | 0 | 881.1 | 36.479 | 54.335 | 60.255 | 200.0 | 12.6 | 36.0 | 41.1 | 0-1 | true |
| rust | 1048576 | 2 | 8888 | 0 | 888.8 | 36.383 | 54.271 | 61.567 | 199.9 | 12.0 | 35.8 | 40.4 | 0-1 | true |
| rust | 1048576 | 3 | 8911 | 0 | 891.1 | 36.319 | 53.759 | 59.103 | 200.1 | 12.2 | 35.5 | 40.1 | 0-1 | true |
| dotnet-server-gc | 1048576 | 1 | 5441 | 0 | 544.1 | 57.183 | 80.703 | 94.527 | 168.1 | 8.6 | 220.9 | 267.5 | 0-1 | true |
| dotnet-server-gc | 1048576 | 2 | 5467 | 0 | 546.7 | 57.087 | 80.447 | 95.103 | 171.6 | 8.6 | 224.6 | 255.2 | 0-1 | true |
| dotnet-server-gc | 1048576 | 3 | 5461 | 0 | 546.1 | 57.503 | 81.535 | 88.383 | 168.8 | 8.4 | 216.7 | 268.6 | 0-1 | true |
| dotnet-workstation | 1048576 | 1 | 4747 | 0 | 474.7 | 67.199 | 92.671 | 108.607 | 183.1 | 9.7 | 286.6 | 429.1 | 0-1 | true |
| dotnet-workstation | 1048576 | 2 | 5501 | 0 | 550.1 | 56.767 | 78.015 | 87.871 | 189.7 | 9.9 | 333.8 | 428.6 | 0-1 | true |
| dotnet-workstation | 1048576 | 3 | 5417 | 0 | 541.7 | 57.599 | 80.255 | 90.943 | 189.7 | 10.1 | 335.9 | 479.1 | 0-1 | true |
| dotnet-workstation-blocking | 1048576 | 1 | 5198 | 0 | 519.8 | 61.503 | 83.263 | 97.471 | 169.8 | 8.1 | 214.4 | 296.8 | 0-1 | true |
| dotnet-workstation-blocking | 1048576 | 2 | 5333 | 0 | 533.3 | 59.775 | 79.039 | 89.599 | 170.2 | 8.6 | 213.6 | 298.2 | 0-1 | true |
| dotnet-workstation-blocking | 1048576 | 3 | 5388 | 0 | 538.8 | 58.751 | 80.511 | 92.287 | 169.4 | 8.1 | 216.1 | 299.9 | 0-1 | true |
| dotnet-heap-limit | 1048576 | 1 | 4373 | 0 | 437.3 | 72.063 | 100.543 | 120.575 | 159.8 | 6.5 | 187.0 | 207.8 | 0-1 | true |
| dotnet-heap-limit | 1048576 | 2 | 4384 | 0 | 438.4 | 72.191 | 99.775 | 120.447 | 162.5 | 6.9 | 186.3 | 207.9 | 0-1 | true |
| dotnet-heap-limit | 1048576 | 3 | 4494 | 0 | 449.4 | 70.399 | 96.255 | 110.271 | 161.2 | 6.5 | 189.4 | 209.6 | 0-1 | true |

## What stood out

None of the median rows tripped the client-saturation heuristic (client CPU at least 170% of one core and more than 40 points above the server).

## How this was measured

- Load generator: `crypto-bench` (this repo), Hyper HTTP/1.1 keep-alive, one connection per in-flight request, TCP_NODELAY, HDR histogram of client latency.
- The request body is encrypted once and repeated. That reuses a GCM nonce, which is not safe in production; it keeps the bytes identical. Services still pick a new nonce for every response. One response per repetition is decrypted and compared to the expected JSON.
- Linux affinity during `run.sh`: server on CPUs 0-1, load generator on CPUs 2-3. They still share memory bandwidth, last-level cache, and the hypervisor.
- No TLS. The work is HTTP framing, AES-256-GCM, JSON, and the FNV-1a step.
- Rust: release profile, thin LTO, codegen-units = 1, axum/tokio, RustCrypto `aes-gcm` with runtime AES-NI detection. Not `target-cpu=native`.
- .NET 10 baseline (`dotnet-server-gc`): `dotnet publish -c Release`, framework-dependent, ReadyToRun, Server GC, background GC, tiered PGO, invariant globalization.
- `dotnet-workstation`: same binary, `DOTNET_gcServer=0` (background GC stays on).
- `dotnet-workstation-blocking`: second publish with `ServerGarbageCollection=false` and `ConcurrentGarbageCollection=false`. `DOTNET_gcConcurrent=0` does not override `System.GC.Concurrent` when that property is already in runtimeconfig.json.
- `dotnet-heap-limit`: Server GC baseline plus `DOTNET_GCHeapHardLimit` (hex bytes, value in `environment.txt`). 128 MiB. A 64 MiB cap returned HTTP 500 on the 1 MiB payload.
- Native AOT is attempted on every run. If publish fails, `bench/results/aot-publish.txt` has the compiler output and there is no AOT row.
- Warm-up is short. Three repetitions and the median are there so a single cold run does not decide the row.

## Environment

```
date_utc=2026-11-01T10:56:27Z
git=83729cb80626fd3ea67aaa49ebb29628b2cbc34e
rustc=rustc 1.99.1 (58cf8f9c3 2026-10-13)
cargo=cargo 1.99.1 (5f94df478 2026-08-27)
dotnet_sdk=10.0.403
uname=Linux cursor 6.12.94+ #1 SMP PREEMPT_DYNAMIC Tue Oct 27 12:38:43 UTC 2026 x86_64 x86_64 x86_64 GNU/Linux
nproc=4
mem_total_kib=16387280
cpu_model=Intel(R) Xeon(R) Processor
cpu_family=6
cpu_model_id=207
hypervisor=KVM
aes_flag=present
clk_tck=100
concurrency=32
warmup_secs=5
duration_secs=10
repetitions=3
server_cpus=0,1
client_cpus=2,3
openssl=OpenSSL 3.0.13 30 Jan 2024 (Library: OpenSSL 3.0.13 30 Jan 2024)
python=Python 3.12.3
gc_heap_hard_limit_hex=8000000
gc_heap_hard_limit_bytes=134217728
aot_publish=failed
```

## Limits

A 4-vCPU guest cannot say which language is faster in production. Use this as a same-machine comparison of these two programs, and rerun `bench/run.sh` or `bench/run.ps1` where the result matters.
