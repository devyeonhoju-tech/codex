# Benchmark results

These numbers were measured by `bench/run.sh` on this machine. They are not a general ranking of Rust and C#. Absolute throughput will move on other hardware, and a shared cloud VM is noisy.

Summary values are the **median of 3 repetitions**. Each repetition is a closed-loop HTTP/1.1 run: 32 in-flight requests, 5s warm-up (discarded), 10s measured. Payload is the UTF-8 length of the JSON `data` field. CPU is server user+system time from `/proc/<pid>/stat` over the measured window, where 100% means one fully busy core. RSS is the server's resident set during that window.

## Summary

| Service | Payload | HTTP body | RPS | p50 ms | p95 ms | p99 ms | CPU (1 core = 100%) | RSS avg MiB | RSS peak MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| rust | 1024 | 1091 | 185926.3 | 0.164 | 0.254 | 0.286 | 197.4 | 4.6 | 4.6 |
| dotnet-server-gc | 1024 | 1091 | 101956.6 | 0.291 | 0.561 | 0.648 | 196.2 | 89.6 | 89.7 |
| dotnet-workstation | 1024 | 1091 | 113089.5 | 0.280 | 0.403 | 0.530 | 197.5 | 249.1 | 249.2 |
| dotnet-workstation-blocking | 1024 | 1091 | 112339.3 | 0.285 | 0.400 | 0.506 | 198.1 | 250.4 | 251.0 |
| dotnet-heap-limit | 1024 | 1091 | 97517.9 | 0.292 | 0.612 | 0.780 | 189.8 | 90.6 | 90.6 |
| dotnet-aot | 1024 | 1091 | 92096.4 | 0.320 | 0.639 | 0.735 | 197.0 | 35.0 | 35.0 |
| rust | 65536 | 65603 | 14973.2 | 2.099 | 3.137 | 3.611 | 199.9 | 8.9 | 9.2 |
| dotnet-server-gc | 65536 | 65603 | 7809.4 | 4.001 | 6.415 | 9.415 | 167.2 | 109.6 | 127.2 |
| dotnet-workstation | 65536 | 65603 | 7037.1 | 4.447 | 6.299 | 7.115 | 150.7 | 98.5 | 99.1 |
| dotnet-workstation-blocking | 65536 | 65603 | 7020.2 | 4.407 | 6.283 | 7.123 | 151.0 | 100.9 | 101.7 |
| dotnet-heap-limit | 65536 | 65603 | 7668.9 | 4.055 | 6.735 | 9.647 | 162.6 | 110.0 | 123.9 |
| dotnet-aot | 65536 | 65603 | 6752.0 | 4.551 | 8.911 | 10.407 | 159.8 | 53.2 | 65.1 |
| rust | 1048576 | 1048643 | 875.4 | 36.767 | 55.967 | 62.463 | 199.9 | 36.2 | 41.5 |
| dotnet-server-gc | 1048576 | 1048643 | 576.9 | 54.207 | 77.055 | 89.023 | 173.8 | 231.5 | 289.0 |
| dotnet-workstation | 1048576 | 1048643 | 602.5 | 52.895 | 72.127 | 84.351 | 184.7 | 304.2 | 426.0 |
| dotnet-workstation-blocking | 1048576 | 1048643 | 508.8 | 62.463 | 84.671 | 95.487 | 171.5 | 207.4 | 284.8 |
| dotnet-heap-limit | 1048576 | 1048643 | 446.5 | 70.783 | 94.591 | 110.527 | 158.8 | 187.2 | 208.8 |
| dotnet-aot | 1048576 | 1048643 | 518.9 | 60.287 | 84.287 | 97.919 | 166.5 | 149.8 | 187.8 |

## Every repetition

| Service | Payload | Rep | Requests | Errors | RPS | p50 ms | p95 ms | p99 ms | Server CPU | Client CPU | RSS avg | RSS peak | Affinity | Verified |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| rust | 1024 | 1 | 1864649 | 0 | 186464.9 | 0.163 | 0.254 | 0.286 | 197.4 | 169.1 | 4.5 | 4.5 | 0-1 | true |
| rust | 1024 | 2 | 1848190 | 0 | 184819.0 | 0.165 | 0.255 | 0.288 | 197.3 | 172.9 | 4.6 | 4.6 | 0-1 | true |
| rust | 1024 | 3 | 1859263 | 0 | 185926.3 | 0.164 | 0.254 | 0.285 | 197.6 | 173.6 | 4.8 | 4.8 | 0-1 | true |
| dotnet-server-gc | 1024 | 1 | 1019566 | 0 | 101956.6 | 0.291 | 0.548 | 0.644 | 196.2 | 95.3 | 88.8 | 88.9 | 0-1 | true |
| dotnet-server-gc | 1024 | 2 | 1031181 | 0 | 103118.1 | 0.283 | 0.561 | 0.648 | 197.1 | 95.3 | 89.6 | 89.7 | 0-1 | true |
| dotnet-server-gc | 1024 | 3 | 993159 | 0 | 99315.9 | 0.291 | 0.599 | 0.701 | 196.0 | 92.9 | 90.2 | 90.2 | 0-1 | true |
| dotnet-workstation | 1024 | 1 | 1130492 | 0 | 113049.2 | 0.280 | 0.403 | 0.540 | 197.5 | 105.7 | 248.2 | 248.3 | 0-1 | true |
| dotnet-workstation | 1024 | 2 | 1179514 | 0 | 117951.4 | 0.271 | 0.378 | 0.458 | 198.4 | 109.2 | 249.1 | 249.2 | 0-1 | true |
| dotnet-workstation | 1024 | 3 | 1130895 | 0 | 113089.5 | 0.280 | 0.404 | 0.530 | 197.5 | 105.5 | 249.8 | 249.8 | 0-1 | true |
| dotnet-workstation-blocking | 1024 | 1 | 1087351 | 0 | 108735.1 | 0.294 | 0.417 | 0.526 | 198.1 | 101.9 | 248.2 | 248.5 | 0-1 | true |
| dotnet-workstation-blocking | 1024 | 2 | 1123393 | 0 | 112339.3 | 0.285 | 0.399 | 0.490 | 198.2 | 105.6 | 250.4 | 251.0 | 0-1 | true |
| dotnet-workstation-blocking | 1024 | 3 | 1127174 | 0 | 112717.4 | 0.283 | 0.400 | 0.506 | 197.8 | 104.7 | 255.7 | 255.7 | 0-1 | true |
| dotnet-heap-limit | 1024 | 1 | 965303 | 0 | 96530.3 | 0.292 | 0.618 | 0.790 | 187.8 | 90.5 | 89.6 | 89.6 | 0-1 | true |
| dotnet-heap-limit | 1024 | 2 | 988185 | 0 | 98818.5 | 0.294 | 0.576 | 0.746 | 189.8 | 92.0 | 90.6 | 90.6 | 0-1 | true |
| dotnet-heap-limit | 1024 | 3 | 975179 | 0 | 97517.9 | 0.292 | 0.612 | 0.780 | 190.3 | 91.1 | 91.0 | 91.0 | 0-1 | true |
| dotnet-aot | 1024 | 1 | 920964 | 0 | 92096.4 | 0.320 | 0.622 | 0.718 | 196.3 | 86.8 | 34.7 | 34.7 | 0-1 | true |
| dotnet-aot | 1024 | 2 | 922825 | 0 | 92282.5 | 0.316 | 0.639 | 0.735 | 197.0 | 86.8 | 35.0 | 35.0 | 0-1 | true |
| dotnet-aot | 1024 | 3 | 887461 | 0 | 88746.1 | 0.330 | 0.658 | 0.763 | 197.1 | 84.0 | 35.2 | 35.2 | 0-1 | true |
| rust | 65536 | 1 | 149535 | 0 | 14953.5 | 2.099 | 3.145 | 3.631 | 200.0 | 25.2 | 8.8 | 9.0 | 0-1 | true |
| rust | 65536 | 2 | 151455 | 0 | 15145.5 | 2.069 | 3.107 | 3.611 | 199.8 | 25.4 | 8.9 | 9.2 | 0-1 | true |
| rust | 65536 | 3 | 149732 | 0 | 14973.2 | 2.099 | 3.137 | 3.605 | 199.9 | 25.3 | 9.4 | 10.0 | 0-1 | true |
| dotnet-server-gc | 65536 | 1 | 78094 | 0 | 7809.4 | 4.001 | 6.415 | 9.415 | 167.2 | 14.5 | 107.7 | 122.9 | 0-1 | true |
| dotnet-server-gc | 65536 | 2 | 79705 | 0 | 7970.5 | 3.935 | 6.095 | 9.359 | 169.3 | 14.9 | 110.0 | 127.6 | 0-1 | true |
| dotnet-server-gc | 65536 | 3 | 77612 | 0 | 7761.2 | 4.039 | 6.447 | 9.663 | 165.3 | 14.6 | 109.6 | 127.2 | 0-1 | true |
| dotnet-workstation | 65536 | 1 | 70008 | 0 | 7000.8 | 4.459 | 6.303 | 7.123 | 150.1 | 13.4 | 98.4 | 99.1 | 0-1 | true |
| dotnet-workstation | 65536 | 2 | 70371 | 0 | 7037.1 | 4.447 | 6.299 | 7.115 | 150.7 | 14.0 | 98.5 | 99.2 | 0-1 | true |
| dotnet-workstation | 65536 | 3 | 71090 | 0 | 7109.0 | 4.383 | 6.219 | 7.059 | 151.1 | 14.2 | 98.5 | 99.1 | 0-1 | true |
| dotnet-workstation-blocking | 65536 | 1 | 71420 | 0 | 7142.0 | 4.363 | 6.239 | 7.075 | 151.9 | 14.3 | 100.8 | 101.7 | 0-1 | true |
| dotnet-workstation-blocking | 65536 | 2 | 70202 | 0 | 7020.2 | 4.407 | 6.343 | 7.239 | 150.5 | 13.9 | 100.9 | 101.7 | 0-1 | true |
| dotnet-workstation-blocking | 65536 | 3 | 70053 | 0 | 7005.3 | 4.435 | 6.283 | 7.123 | 151.0 | 13.9 | 100.9 | 101.6 | 0-1 | true |
| dotnet-heap-limit | 65536 | 1 | 75483 | 0 | 7548.3 | 4.089 | 7.295 | 9.831 | 161.9 | 14.4 | 110.0 | 123.9 | 0-1 | true |
| dotnet-heap-limit | 65536 | 2 | 77287 | 0 | 7728.7 | 4.031 | 6.663 | 9.647 | 162.6 | 14.4 | 110.1 | 129.4 | 0-1 | true |
| dotnet-heap-limit | 65536 | 3 | 76689 | 0 | 7668.9 | 4.055 | 6.735 | 9.551 | 166.3 | 14.4 | 109.1 | 119.4 | 0-1 | true |
| dotnet-aot | 65536 | 1 | 68046 | 0 | 6804.6 | 4.607 | 7.867 | 10.391 | 162.8 | 13.2 | 52.9 | 65.1 | 0-1 | true |
| dotnet-aot | 65536 | 2 | 67366 | 0 | 6736.6 | 4.551 | 9.039 | 10.567 | 159.8 | 13.1 | 53.2 | 66.7 | 0-1 | true |
| dotnet-aot | 65536 | 3 | 67520 | 0 | 6752.0 | 4.531 | 8.911 | 10.407 | 159.5 | 13.1 | 53.5 | 63.5 | 0-1 | true |
| rust | 1048576 | 1 | 8762 | 0 | 876.2 | 36.767 | 54.975 | 60.543 | 199.9 | 12.4 | 36.2 | 40.6 | 0-1 | true |
| rust | 1048576 | 2 | 8651 | 0 | 865.1 | 37.407 | 55.967 | 64.447 | 199.9 | 13.0 | 36.5 | 43.1 | 0-1 | true |
| rust | 1048576 | 3 | 8754 | 0 | 875.4 | 36.415 | 56.639 | 62.463 | 199.8 | 12.5 | 36.2 | 41.5 | 0-1 | true |
| dotnet-server-gc | 1048576 | 1 | 5844 | 0 | 584.4 | 53.119 | 76.351 | 89.023 | 173.8 | 8.7 | 231.5 | 273.0 | 0-1 | true |
| dotnet-server-gc | 1048576 | 2 | 5769 | 0 | 576.9 | 54.207 | 77.247 | 89.151 | 176.0 | 8.8 | 233.2 | 289.0 | 0-1 | true |
| dotnet-server-gc | 1048576 | 3 | 5712 | 0 | 571.2 | 54.463 | 77.055 | 87.999 | 170.3 | 8.4 | 215.7 | 296.5 | 0-1 | true |
| dotnet-workstation | 1048576 | 1 | 5882 | 0 | 588.2 | 53.887 | 73.599 | 85.055 | 184.2 | 9.7 | 300.9 | 452.6 | 0-1 | true |
| dotnet-workstation | 1048576 | 2 | 6031 | 0 | 603.1 | 52.159 | 72.127 | 81.663 | 185.4 | 9.6 | 309.0 | 409.6 | 0-1 | true |
| dotnet-workstation | 1048576 | 3 | 6025 | 0 | 602.5 | 52.895 | 71.999 | 84.351 | 184.7 | 9.8 | 304.2 | 426.0 | 0-1 | true |
| dotnet-workstation-blocking | 1048576 | 1 | 4978 | 0 | 497.8 | 64.255 | 86.847 | 95.487 | 171.5 | 8.2 | 202.1 | 274.8 | 0-1 | true |
| dotnet-workstation-blocking | 1048576 | 2 | 5088 | 0 | 508.8 | 62.463 | 84.671 | 95.615 | 171.7 | 8.5 | 207.5 | 286.9 | 0-1 | true |
| dotnet-workstation-blocking | 1048576 | 3 | 5126 | 0 | 512.6 | 62.207 | 84.607 | 95.295 | 171.3 | 8.1 | 207.4 | 284.8 | 0-1 | true |
| dotnet-heap-limit | 1048576 | 1 | 4465 | 0 | 446.5 | 70.911 | 94.207 | 115.903 | 156.3 | 6.2 | 188.4 | 208.9 | 0-1 | true |
| dotnet-heap-limit | 1048576 | 2 | 4598 | 0 | 459.8 | 68.671 | 94.591 | 108.287 | 162.5 | 6.8 | 187.2 | 208.8 | 0-1 | true |
| dotnet-heap-limit | 1048576 | 3 | 4444 | 0 | 444.4 | 70.783 | 97.407 | 110.527 | 158.8 | 6.1 | 184.7 | 207.8 | 0-1 | true |
| dotnet-aot | 1048576 | 1 | 4869 | 0 | 486.9 | 65.055 | 88.767 | 101.439 | 161.0 | 6.8 | 143.5 | 182.9 | 0-1 | true |
| dotnet-aot | 1048576 | 2 | 5189 | 0 | 518.9 | 60.287 | 84.287 | 97.919 | 166.5 | 7.4 | 149.8 | 187.8 | 0-1 | true |
| dotnet-aot | 1048576 | 3 | 5350 | 0 | 535.0 | 57.951 | 82.111 | 95.999 | 171.4 | 7.4 | 160.5 | 200.7 | 0-1 | true |

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
- `dotnet-aot`: Native AOT publish of the same program (`PublishAot=true`, ReadyToRun off for that publish), Server GC and background GC. Request and response JSON go through `ProtocolJsonContext`. The JIT variants use that context too, so they are remeasured with it. If publish fails, there is no AOT row and `bench/results/aot-publish.txt` has the error.
- Warm-up is short. Three repetitions and the median are there so a single cold run does not decide the row.

## Environment

```
date_utc=2026-11-01T11:56:26Z
git=e27496eb156a415f3d7731624adb4f3b077d4d99
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
aot_publish=ok
r2r_apphost_bytes=78192
r2r_dll_bytes=74240
aot_binary_bytes=16004992
startup_ms_rust=6
startup_ms_dotnet-server-gc=165
startup_ms_dotnet-workstation=165
startup_ms_dotnet-workstation-blocking=162
startup_ms_dotnet-heap-limit=163
startup_ms_dotnet-aot=33
```

## Limits

A 4-vCPU guest cannot say which language is faster in production. Use this as a same-machine comparison of these two programs, and rerun `bench/run.sh` or `bench/run.ps1` where the result matters.
