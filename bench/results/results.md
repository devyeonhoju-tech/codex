# Benchmark results

These numbers were measured by `bench/run.sh` on this machine. They are not a general ranking of Rust and C#. Absolute throughput will move on other hardware, and a shared cloud VM is noisy.

Summary values are the **median of 3 repetitions**. Each repetition is a closed-loop HTTP/1.1 run: 32 in-flight requests, 5s warm-up (discarded), 10s measured. Payload is the UTF-8 length of the JSON `data` field. CPU is server user+system time from `/proc/<pid>/stat` over the measured window, where 100% means one fully busy core. RSS is the server's resident set during that window.

## Summary

| Service | Payload | HTTP body | RPS | p50 ms | p95 ms | p99 ms | CPU (1 core = 100%) | RSS avg MiB | RSS peak MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| dotnet | 1024 | 1091 | 98522.9 | 0.293 | 0.597 | 0.707 | 196.1 | 90.3 | 90.3 |
| rust | 1024 | 1091 | 178525.2 | 0.171 | 0.266 | 0.304 | 197.5 | 4.7 | 4.7 |
| dotnet | 65536 | 65603 | 7799.1 | 3.991 | 6.651 | 9.487 | 166.9 | 110.3 | 128.5 |
| rust | 65536 | 65603 | 15006.2 | 2.085 | 3.137 | 3.631 | 199.9 | 8.8 | 9.1 |
| dotnet | 1048576 | 1048643 | 570.2 | 54.751 | 77.887 | 89.343 | 172.7 | 230.6 | 279.6 |
| rust | 1048576 | 1048643 | 875.2 | 36.991 | 55.423 | 60.543 | 200.0 | 36.1 | 40.5 |

## Every repetition

| Service | Payload | Rep | Requests | Errors | RPS | p50 ms | p95 ms | p99 ms | Server CPU | Client CPU | RSS avg | RSS peak | Affinity | Verified |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| dotnet | 1024 | 1 | 1005152 | 0 | 100515.2 | 0.294 | 0.556 | 0.660 | 196.6 | 94.3 | 89.4 | 89.6 | 0-1 | true |
| dotnet | 1024 | 2 | 983762 | 0 | 98376.2 | 0.293 | 0.597 | 0.707 | 196.1 | 93.3 | 90.3 | 90.3 | 0-1 | true |
| dotnet | 1024 | 3 | 985229 | 0 | 98522.9 | 0.291 | 0.609 | 0.712 | 195.9 | 92.8 | 90.8 | 90.8 | 0-1 | true |
| rust | 1024 | 1 | 1785252 | 0 | 178525.2 | 0.171 | 0.266 | 0.304 | 197.6 | 171.0 | 4.5 | 4.5 | 0-1 | true |
| rust | 1024 | 2 | 1764627 | 0 | 176462.7 | 0.173 | 0.269 | 0.309 | 197.5 | 169.1 | 4.7 | 4.7 | 0-1 | true |
| rust | 1024 | 3 | 1868540 | 0 | 186854.0 | 0.163 | 0.253 | 0.286 | 197.3 | 169.7 | 5.0 | 5.0 | 0-1 | true |
| dotnet | 65536 | 1 | 78214 | 0 | 7821.4 | 3.951 | 6.651 | 9.623 | 166.9 | 15.0 | 110.3 | 128.7 | 0-1 | true |
| dotnet | 65536 | 2 | 77991 | 0 | 7799.1 | 3.991 | 6.459 | 9.455 | 167.6 | 15.4 | 108.9 | 128.5 | 0-1 | true |
| dotnet | 65536 | 3 | 76435 | 0 | 7643.5 | 4.081 | 6.751 | 9.487 | 166.5 | 14.8 | 110.6 | 121.4 | 0-1 | true |
| rust | 65536 | 1 | 150998 | 0 | 15099.8 | 2.073 | 3.127 | 3.489 | 199.9 | 25.2 | 8.1 | 8.2 | 0-1 | true |
| rust | 65536 | 2 | 150062 | 0 | 15006.2 | 2.085 | 3.137 | 3.631 | 199.8 | 25.1 | 8.9 | 9.6 | 0-1 | true |
| rust | 65536 | 3 | 148574 | 0 | 14857.4 | 2.105 | 3.163 | 3.695 | 200.0 | 25.4 | 8.8 | 9.1 | 0-1 | true |
| dotnet | 1048576 | 1 | 5666 | 0 | 566.6 | 54.911 | 79.359 | 89.151 | 172.7 | 8.6 | 230.6 | 279.6 | 0-1 | true |
| dotnet | 1048576 | 2 | 5798 | 0 | 579.8 | 53.663 | 77.183 | 89.535 | 174.3 | 8.9 | 237.4 | 288.6 | 0-1 | true |
| dotnet | 1048576 | 3 | 5702 | 0 | 570.2 | 54.751 | 77.887 | 89.343 | 171.9 | 8.3 | 225.3 | 265.0 | 0-1 | true |
| rust | 1048576 | 1 | 8733 | 0 | 873.3 | 36.991 | 55.423 | 60.543 | 200.0 | 12.1 | 34.9 | 39.7 | 0-1 | true |
| rust | 1048576 | 2 | 8752 | 0 | 875.2 | 36.959 | 55.615 | 61.951 | 199.9 | 13.1 | 36.5 | 43.3 | 0-1 | true |
| rust | 1048576 | 3 | 8754 | 0 | 875.4 | 37.119 | 54.783 | 60.543 | 200.0 | 12.1 | 36.1 | 40.5 | 0-1 | true |

## What stood out

None of the median rows tripped the client-saturation heuristic (client CPU at least 170% of one core and more than 40 points above the server).

## How this was measured

- Load generator: `crypto-bench` (this repo), Hyper HTTP/1.1 keep-alive, one connection per in-flight request, TCP_NODELAY, HDR histogram of client latency.
- The request body is encrypted once and repeated. That reuses a GCM nonce, which is not safe in production; it keeps the bytes identical. Services still pick a new nonce for every response. One response per repetition is decrypted and compared to the expected JSON.
- Linux affinity during `run.sh`: server on CPUs 0-1, load generator on CPUs 2-3. They still share memory bandwidth, last-level cache, and the hypervisor.
- No TLS. The work is HTTP framing, AES-256-GCM, JSON, and the FNV-1a step.
- Rust: release profile, thin LTO, codegen-units = 1, axum/tokio, RustCrypto `aes-gcm` with runtime AES-NI detection. Not `target-cpu=native`.
- .NET 10: `dotnet publish -c Release`, framework-dependent, ReadyToRun, Server GC, tiered PGO, invariant globalization. Not Native AOT.
- Warm-up is short. Three repetitions and the median are there so a single cold run does not decide the row.

## Environment

```
date_utc=2026-11-01T10:09:59Z
git=f544b618d3b64c19761d06723bceaa0d51eb4dd9
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
```

## Limits

A 4-vCPU guest cannot say which language is faster in production. Use this as a same-machine comparison of these two programs, and rerun `bench/run.sh` or `bench/run.ps1` where the result matters.
