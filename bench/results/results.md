# Benchmark results

These numbers were measured by `bench/run.sh` on this machine. They are not a general ranking of Rust and C#. Absolute throughput will move on other hardware, and a shared cloud VM is noisy.

Summary values are the **median of 3 repetitions**. Each repetition is a closed-loop HTTP/1.1 run: 32 in-flight requests, 5s warm-up (discarded), 10s measured. Payload is the UTF-8 length of the JSON `data` field. CPU is server user+system time from `/proc/<pid>/stat` over the measured window, where 100% means one fully busy core. RSS is the server's resident set during that window.

## Summary

| Service | Payload | HTTP body | RPS | p50 ms | p95 ms | p99 ms | CPU (1 core = 100%) | RSS avg MiB | RSS peak MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| rust | 1024 | 1091 | 157886.0 | 0.193 | 0.302 | 0.342 | 197.8 | 4.9 | 4.9 |
| dotnet-server-gc | 1024 | 1091 | 95544.9 | 0.305 | 0.602 | 0.704 | 196.4 | 90.1 | 90.1 |
| dotnet-workstation | 1024 | 1091 | 109161.3 | 0.293 | 0.413 | 0.520 | 197.7 | 250.4 | 250.5 |
| dotnet-workstation-blocking | 1024 | 1091 | 106948.1 | 0.299 | 0.424 | 0.539 | 197.9 | 251.2 | 251.2 |
| dotnet-heap-limit | 1024 | 1091 | 93620.1 | 0.308 | 0.630 | 0.808 | 188.8 | 91.1 | 91.1 |
| dotnet-aot | 1024 | 1091 | 83945.6 | 0.340 | 0.712 | 0.832 | 195.9 | 33.4 | 33.4 |
| rust | 65536 | 65603 | 9934.8 | 3.155 | 4.735 | 5.391 | 199.8 | 9.0 | 9.2 |
| dotnet-server-gc | 65536 | 65603 | 7166.6 | 4.251 | 8.439 | 10.495 | 172.5 | 125.9 | 152.0 |
| dotnet-workstation | 65536 | 65603 | 7930.7 | 3.869 | 6.507 | 8.479 | 181.0 | 211.7 | 244.2 |
| dotnet-workstation-blocking | 65536 | 65603 | 6344.2 | 4.667 | 7.315 | 9.199 | 155.0 | 105.7 | 106.3 |
| dotnet-heap-limit | 65536 | 65603 | 7038.9 | 4.343 | 8.391 | 10.663 | 170.9 | 125.1 | 137.7 |
| dotnet-aot | 65536 | 65603 | 6254.1 | 4.775 | 9.775 | 11.511 | 164.6 | 74.4 | 86.3 |
| rust | 1048576 | 1048643 | 533.8 | 59.935 | 91.135 | 102.143 | 199.5 | 38.8 | 44.5 |
| dotnet-server-gc | 1048576 | 1048643 | 483.9 | 64.831 | 91.455 | 110.271 | 173.4 | 278.2 | 321.5 |
| dotnet-workstation | 1048576 | 1048643 | 484.3 | 64.511 | 94.079 | 108.863 | 189.7 | 521.0 | 837.7 |
| dotnet-workstation-blocking | 1048576 | 1048643 | 475.8 | 65.663 | 94.207 | 112.191 | 179.7 | 270.7 | 362.7 |
| dotnet-heap-limit | 1048576 | 1048643 | 474.2 | 65.855 | 97.855 | 113.663 | 174.4 | 279.7 | 319.6 |
| dotnet-aot | 1048576 | 1048643 | 466.0 | 67.455 | 95.487 | 108.543 | 172.0 | 211.9 | 260.3 |

## Every repetition

| Service | Payload | Rep | Requests | Errors | RPS | p50 ms | p95 ms | p99 ms | Server CPU | Client CPU | RSS avg | RSS peak | Affinity | Verified |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| rust | 1024 | 1 | 1578860 | 0 | 157886.0 | 0.193 | 0.302 | 0.342 | 197.8 | 155.4 | 4.5 | 4.5 | 0-1 | true (49355) |
| rust | 1024 | 2 | 1611197 | 0 | 161119.7 | 0.190 | 0.294 | 0.334 | 197.8 | 156.5 | 4.9 | 4.9 | 0-1 | true (50364) |
| rust | 1024 | 3 | 1544237 | 0 | 154423.7 | 0.198 | 0.309 | 0.347 | 197.9 | 153.9 | 5.2 | 5.2 | 0-1 | true (48274) |
| dotnet-server-gc | 1024 | 1 | 960259 | 0 | 96025.9 | 0.305 | 0.590 | 0.694 | 195.8 | 93.4 | 89.2 | 89.3 | 0-1 | true (30024) |
| dotnet-server-gc | 1024 | 2 | 955449 | 0 | 95544.9 | 0.304 | 0.602 | 0.704 | 196.4 | 93.6 | 90.1 | 90.1 | 0-1 | true (29871) |
| dotnet-server-gc | 1024 | 3 | 950973 | 0 | 95097.3 | 0.306 | 0.607 | 0.705 | 196.7 | 92.4 | 90.6 | 90.6 | 0-1 | true (29732) |
| dotnet-workstation | 1024 | 1 | 1088166 | 0 | 108816.6 | 0.294 | 0.413 | 0.520 | 197.7 | 103.8 | 248.7 | 248.9 | 0-1 | true (34020) |
| dotnet-workstation | 1024 | 2 | 1101962 | 0 | 110196.2 | 0.290 | 0.407 | 0.514 | 197.7 | 106.2 | 250.4 | 250.5 | 0-1 | true (34450) |
| dotnet-workstation | 1024 | 3 | 1091613 | 0 | 109161.3 | 0.293 | 0.415 | 0.529 | 197.9 | 104.7 | 251.0 | 251.0 | 0-1 | true (34124) |
| dotnet-workstation-blocking | 1024 | 1 | 1069481 | 0 | 106948.1 | 0.299 | 0.424 | 0.569 | 197.9 | 103.3 | 248.9 | 249.8 | 0-1 | true (33434) |
| dotnet-workstation-blocking | 1024 | 2 | 1055482 | 0 | 105548.2 | 0.303 | 0.427 | 0.539 | 197.9 | 102.6 | 255.1 | 255.1 | 0-1 | true (33001) |
| dotnet-workstation-blocking | 1024 | 3 | 1097715 | 0 | 109771.5 | 0.291 | 0.409 | 0.501 | 197.9 | 106.5 | 251.2 | 251.2 | 0-1 | true (34320) |
| dotnet-heap-limit | 1024 | 1 | 913665 | 0 | 91366.5 | 0.309 | 0.651 | 0.821 | 187.7 | 89.3 | 90.1 | 90.3 | 0-1 | true (28567) |
| dotnet-heap-limit | 1024 | 2 | 936201 | 0 | 93620.1 | 0.308 | 0.602 | 0.782 | 188.8 | 91.6 | 91.1 | 91.1 | 0-1 | true (29275) |
| dotnet-heap-limit | 1024 | 3 | 938099 | 0 | 93809.9 | 0.300 | 0.630 | 0.808 | 188.8 | 90.3 | 91.4 | 91.4 | 0-1 | true (29332) |
| dotnet-aot | 1024 | 1 | 795951 | 0 | 79595.1 | 0.345 | 0.814 | 0.932 | 193.8 | 79.0 | 33.2 | 33.3 | 0-1 | true (24890) |
| dotnet-aot | 1024 | 2 | 852227 | 0 | 85222.7 | 0.334 | 0.709 | 0.814 | 196.4 | 83.8 | 33.4 | 33.4 | 0-1 | true (26647) |
| dotnet-aot | 1024 | 3 | 839456 | 0 | 83945.6 | 0.340 | 0.712 | 0.832 | 195.9 | 81.4 | 33.8 | 33.8 | 0-1 | true (26249) |
| rust | 65536 | 1 | 99348 | 0 | 9934.8 | 3.155 | 4.731 | 5.439 | 199.8 | 24.5 | 9.0 | 9.2 | 0-1 | true (3119) |
| rust | 65536 | 2 | 97844 | 0 | 9784.4 | 3.213 | 4.799 | 5.391 | 199.6 | 23.3 | 9.7 | 9.9 | 0-1 | true (3074) |
| rust | 65536 | 3 | 99801 | 0 | 9980.1 | 3.141 | 4.735 | 5.247 | 199.8 | 24.2 | 9.0 | 9.1 | 0-1 | true (3134) |
| dotnet-server-gc | 65536 | 1 | 71382 | 0 | 7138.2 | 4.271 | 8.583 | 10.495 | 171.8 | 21.4 | 125.9 | 152.0 | 0-1 | true (2244) |
| dotnet-server-gc | 65536 | 2 | 71666 | 0 | 7166.6 | 4.251 | 8.199 | 10.839 | 173.9 | 21.7 | 127.5 | 157.0 | 0-1 | true (2255) |
| dotnet-server-gc | 65536 | 3 | 72781 | 0 | 7278.1 | 4.183 | 8.439 | 10.391 | 172.5 | 21.6 | 125.0 | 139.7 | 0-1 | true (2289) |
| dotnet-workstation | 65536 | 1 | 69491 | 0 | 6949.1 | 4.451 | 7.103 | 8.479 | 167.5 | 21.1 | 178.1 | 232.4 | 0-1 | true (2186) |
| dotnet-workstation | 65536 | 2 | 79307 | 0 | 7930.7 | 3.869 | 6.507 | 8.671 | 182.5 | 23.9 | 219.0 | 265.2 | 0-1 | true (2495) |
| dotnet-workstation | 65536 | 3 | 79998 | 0 | 7999.8 | 3.859 | 6.323 | 8.455 | 181.0 | 24.2 | 211.7 | 244.2 | 0-1 | true (2515) |
| dotnet-workstation-blocking | 65536 | 1 | 63442 | 0 | 6344.2 | 4.647 | 7.315 | 9.487 | 154.9 | 19.2 | 105.8 | 106.4 | 0-1 | true (1997) |
| dotnet-workstation-blocking | 65536 | 2 | 63187 | 0 | 6318.7 | 4.691 | 7.347 | 9.199 | 155.0 | 18.6 | 105.7 | 106.1 | 0-1 | true (1987) |
| dotnet-workstation-blocking | 65536 | 3 | 63718 | 0 | 6371.8 | 4.667 | 7.247 | 9.103 | 155.1 | 19.4 | 105.7 | 106.3 | 0-1 | true (2009) |
| dotnet-heap-limit | 65536 | 1 | 70389 | 0 | 7038.9 | 4.343 | 8.391 | 10.663 | 170.4 | 21.2 | 125.4 | 143.1 | 0-1 | true (2213) |
| dotnet-heap-limit | 65536 | 2 | 68749 | 0 | 6874.9 | 4.451 | 8.487 | 10.727 | 170.9 | 20.6 | 125.1 | 137.7 | 0-1 | true (2162) |
| dotnet-heap-limit | 65536 | 3 | 70798 | 0 | 7079.8 | 4.331 | 8.383 | 10.495 | 171.0 | 22.0 | 124.7 | 135.6 | 0-1 | true (2226) |
| dotnet-aot | 65536 | 1 | 62380 | 0 | 6238.0 | 4.775 | 9.975 | 11.575 | 163.6 | 19.0 | 73.3 | 85.8 | 0-1 | true (1963) |
| dotnet-aot | 65536 | 2 | 62541 | 0 | 6254.1 | 4.803 | 9.775 | 11.511 | 164.6 | 18.9 | 74.4 | 87.7 | 0-1 | true (1968) |
| dotnet-aot | 65536 | 3 | 63822 | 0 | 6382.2 | 4.715 | 9.447 | 11.127 | 166.2 | 19.6 | 75.5 | 86.3 | 0-1 | true (2011) |
| rust | 1048576 | 1 | 5338 | 0 | 533.8 | 59.935 | 92.479 | 102.143 | 199.5 | 20.1 | 38.8 | 44.5 | 0-1 | true (190) |
| rust | 1048576 | 2 | 5231 | 0 | 523.1 | 61.311 | 91.135 | 102.335 | 199.7 | 19.6 | 37.7 | 44.1 | 0-1 | true (182) |
| rust | 1048576 | 3 | 5484 | 0 | 548.4 | 58.271 | 87.999 | 100.799 | 199.4 | 20.3 | 38.9 | 45.6 | 0-1 | true (192) |
| dotnet-server-gc | 1048576 | 1 | 4835 | 0 | 483.5 | 64.959 | 94.591 | 112.063 | 172.5 | 18.2 | 272.9 | 321.5 | 0-1 | true (160) |
| dotnet-server-gc | 1048576 | 2 | 4839 | 0 | 483.9 | 64.831 | 91.455 | 109.567 | 173.4 | 17.7 | 278.2 | 326.6 | 0-1 | true (160) |
| dotnet-server-gc | 1048576 | 3 | 4894 | 0 | 489.4 | 63.711 | 91.455 | 110.271 | 175.5 | 18.0 | 280.1 | 315.0 | 0-1 | true (160) |
| dotnet-workstation | 1048576 | 1 | 4843 | 0 | 484.3 | 64.511 | 93.695 | 108.863 | 188.5 | 18.9 | 521.0 | 837.7 | 0-1 | true (160) |
| dotnet-workstation | 1048576 | 2 | 4878 | 0 | 487.8 | 63.583 | 94.079 | 108.863 | 189.7 | 18.7 | 503.1 | 714.6 | 0-1 | true (160) |
| dotnet-workstation | 1048576 | 3 | 4637 | 0 | 463.7 | 66.111 | 100.095 | 119.487 | 191.3 | 18.8 | 586.3 | 843.0 | 0-1 | true (160) |
| dotnet-workstation-blocking | 1048576 | 1 | 4877 | 0 | 487.7 | 63.999 | 94.207 | 105.663 | 180.2 | 18.2 | 287.2 | 362.7 | 0-1 | true (161) |
| dotnet-workstation-blocking | 1048576 | 2 | 4537 | 0 | 453.7 | 69.055 | 98.687 | 113.343 | 179.4 | 18.1 | 270.7 | 363.6 | 0-1 | true (160) |
| dotnet-workstation-blocking | 1048576 | 3 | 4758 | 0 | 475.8 | 65.663 | 93.119 | 112.191 | 179.7 | 18.4 | 266.2 | 347.2 | 0-1 | true (160) |
| dotnet-heap-limit | 1048576 | 1 | 4864 | 0 | 486.4 | 64.607 | 92.991 | 107.519 | 168.9 | 17.1 | 258.1 | 317.9 | 0-1 | true (160) |
| dotnet-heap-limit | 1048576 | 2 | 4657 | 0 | 465.7 | 66.623 | 100.223 | 116.095 | 175.0 | 17.2 | 287.1 | 319.6 | 0-1 | true (160) |
| dotnet-heap-limit | 1048576 | 3 | 4742 | 0 | 474.2 | 65.855 | 97.855 | 113.663 | 174.4 | 17.6 | 279.7 | 323.9 | 0-1 | true (160) |
| dotnet-aot | 1048576 | 1 | 4660 | 0 | 466.0 | 67.455 | 95.487 | 108.543 | 172.0 | 16.2 | 206.4 | 260.3 | 0-1 | true (160) |
| dotnet-aot | 1048576 | 2 | 4858 | 0 | 485.8 | 64.031 | 93.951 | 106.431 | 178.5 | 17.6 | 231.9 | 275.6 | 0-1 | true (160) |
| dotnet-aot | 1048576 | 3 | 4606 | 0 | 460.6 | 68.095 | 99.519 | 112.063 | 171.8 | 16.4 | 211.9 | 250.7 | 0-1 | true (160) |

## What stood out

None of the median rows tripped the client-saturation heuristic (client CPU at least 170% of one core and more than 40 points above the server).

## How this was measured

- Load generator: `crypto-bench` (this repo), Hyper HTTP/1.1 keep-alive, one connection per in-flight request, TCP_NODELAY, HDR histogram of client latency.
- The request body is encrypted once and repeated. That reuses a GCM nonce, which is not safe in production; it keeps the bytes identical. Services still pick a new nonce for every response. During the measured window every 32nd success is decrypted and compared, in full, to the expected plaintext (length and bytes). A run with zero full matches fails.
- Linux affinity during `run.sh`: server on CPUs 0-1, load generator on CPUs 2-3. They still share memory bandwidth, last-level cache, and the hypervisor.
- No TLS. The work is HTTP framing, AES-256-GCM, JSON, and the FNV-1a step.
- Rust: release profile, thin LTO, codegen-units = 1, axum/tokio, RustCrypto `aes-gcm` with runtime AES-NI detection. Not `target-cpu=native`.
- .NET 10 baseline (`dotnet-server-gc`): `dotnet publish -c Release`, framework-dependent, ReadyToRun, Server GC, background GC, tiered PGO, invariant globalization.
- `dotnet-workstation`: same binary, `DOTNET_gcServer=0` (background GC stays on).
- `dotnet-workstation-blocking`: second publish with `ServerGarbageCollection=false` and `ConcurrentGarbageCollection=false`. `DOTNET_gcConcurrent=0` does not override `System.GC.Concurrent` when that property is already in runtimeconfig.json.
- `dotnet-heap-limit`: Server GC baseline plus `DOTNET_GCHeapHardLimit` (hex bytes, value in `environment.txt`). 256 MiB. A 128 MiB cap returns HTTP 500 once the response echoes a 1 MiB payload at 32 in-flight requests.
- `dotnet-aot`: Native AOT publish of the same program (`PublishAot=true`, ReadyToRun off for that publish), Server GC and background GC. Request and response JSON go through `ProtocolJsonContext`. The JIT variants use that context too, so they are remeasured with it. If publish fails, there is no AOT row and `bench/results/aot-publish.txt` has the error.
- Warm-up is short. Three repetitions and the median are there so a single cold run does not decide the row.

## Environment

```
date_utc=2026-11-01T12:18:54Z
git=8d5416fe8172985ab51433dbf25c4b25864aa646
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
gc_heap_hard_limit_hex=10000000
gc_heap_hard_limit_bytes=268435456
aot_publish=ok
r2r_apphost_bytes=78192
r2r_dll_bytes=76800
aot_binary_bytes=16005008
startup_ms_rust=6
startup_ms_dotnet-server-gc=164
startup_ms_dotnet-workstation=187
startup_ms_dotnet-workstation-blocking=190
startup_ms_dotnet-heap-limit=163
startup_ms_dotnet-aot=58
```

## Limits

A 4-vCPU guest cannot say which language is faster in production. Use this as a same-machine comparison of these two programs, and rerun `bench/run.sh` or `bench/run.ps1` where the result matters.
