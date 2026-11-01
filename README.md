# Rust and .NET AES-GCM services

Two small HTTP services that do the same work, plus a load test that runs them under the same conditions.

`POST /v1/process` takes an AES-256-GCM body, decrypts it, runs one deterministic JSON step (FNV-1a 32-bit over the UTF-8 `data` field, then a xor), and returns a freshly encrypted JSON response. The byte layout is in [bench/WIRE_FORMAT.md](bench/WIRE_FORMAT.md). Both services and the Python client follow that file.

```
rust-service/     axum + tokio + RustCrypto aes-gcm
dotnet-service/   ASP.NET Core 10 minimal API + System.Security.Cryptography.AesGcm
bench/            wire format, shared vectors, load generator, scripts, results
```

Nothing here is part of a game or a GitHub Pages site. The servers bind to loopback unless you set `BIND` or `ASPNETCORE_URLS`.

## Key

`BENCH_AES_KEY` is required: 64 hex characters, 32 bytes. The servers have no built-in key.

`bench/testdata/bench_key.hex` is a **public benchmark key**. It is not secret. Do not use it for real traffic. It is checked in so two machines can run the same test. The scripts export it for you.

## What is compared

| | Rust | .NET |
| --- | --- | --- |
| Stack | axum 0.8, tokio, RustCrypto `aes-gcm` 0.10 (AES-NI chosen at runtime) | ASP.NET Core minimal API, Kestrel, `AesGcm` (OpenSSL on Linux) |
| Build | `cargo build --release` with thin LTO and `codegen-units = 1`. Not `target-cpu=native` | `dotnet publish -c Release`, framework-dependent, ReadyToRun, tiered PGO, invariant globalization. The load test then repeats that binary under several GC settings |
| HTTP | HTTP/1.1, `TCP_NODELAY` on accepted sockets | HTTP/1.1, Kestrel socket transport `NoDelay = true` |
| Threads | `TOKIO_WORKER_THREADS=2` when the Linux script pins the process to two CPUs | `Environment.ProcessorCount` follows the Linux affinity mask (two CPUs in the script) |
| JSON | `serde_json` | `System.Text.Json`, camelCase, `UnsafeRelaxedJsonEscaping` |
| AES object | one `Aes256Gcm` shared across tasks (`encrypt` takes `&self`) | one `AesGcm` per thread (`ThreadLocal`); the type is not thread-safe |

`bench/run.sh` measures Rust once and four .NET GC setups, all with the same payloads, pinning, warm-up, duration, and repetitions:

| Row | What it is |
| --- | --- |
| `rust` | Release binary, two Tokio workers when pinned |
| `dotnet-server-gc` | Baseline. Server GC and background GC, from the project file |
| `dotnet-workstation` | Same binary, `DOTNET_gcServer=0`. Background GC stays on |
| `dotnet-workstation-blocking` | Second publish with server GC and concurrent GC both off. `DOTNET_gcConcurrent=0` does not override `System.GC.Concurrent` after it is written into `runtimeconfig.json` |
| `dotnet-heap-limit` | Baseline plus `DOTNET_GCHeapHardLimit=10000000` (256 MiB, hex). 128 MiB returns HTTP 500 once the response echoes a 1 MiB payload |
| `dotnet-aot` | Native AOT publish of the same program, Server GC and background GC. ReadyToRun is off for that publish only |

Request and response JSON go through `ProtocolJsonContext` (source generation, same camelCase and relaxed escaping as before). The JIT publishes use that context too, so those rows are measured with it, not with the older reflection calls. Invariant globalization is on because this service never formats cultures.

The Linux script pins the server to CPUs 0-1 and the load generator to CPUs 2-3. They still share memory bandwidth, cache, and the hypervisor.

The Linux script pins the server to CPUs 0-1 and the load generator to CPUs 2-3. They still share memory bandwidth, cache, and the hypervisor.

## Prerequisites

### Linux

- rustup, so `rust-toolchain.toml` can select Rust **1.99.1** (1.88+ is the floor the crates ask for)
- .NET SDK **10**
- Python 3 with the `cryptography` package (`pip install -r bench/testdata/requirements.txt`, or your distro's `python3-cryptography`)
- `curl`, `taskset` (util-linux), and a shell

No C compiler is required. The Rust crates in this repo are pure Rust.

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# https://dotnet.microsoft.com/download/dotnet/10.0
python3 -m pip install --user -r bench/testdata/requirements.txt
```

### Windows

- rustup with the toolchain in `rust-toolchain.toml` (the MSVC toolchain is fine; this repo does not compile C)
- .NET SDK 10
- Python 3 on `PATH`, then `py -3 -m pip install -r bench/testdata/requirements.txt`
- PowerShell 5.1 or PowerShell 7

The Windows script does not pin CPUs. `crypto-bench` reads `/proc` for CPU and RSS, so on Windows those columns are `n/a`. Latency and requests/sec still come from the same load generator. For the numbers this repository publishes, use Linux or WSL.

## Run

From the repository root.

```bash
bash bench/run.sh
```

```powershell
powershell -ExecutionPolicy Bypass -File bench\run.ps1
```

The script runs dev-profile unit tests, checks the shared vectors against Python, builds the release binaries, and runs `bench/interop.py` against those binaries. That client is Python `cryptography` (OpenSSL), not either service. It sends one ciphertext to both processes and requires the decrypted responses to match the vector file, including tampered input and bad JSON.

It then load-tests one service at a time:

| Knob | Default |
| --- | --- |
| `data` length | 1024, 65536, 1048576 bytes (ASCII `x`) |
| In-flight requests | `CONCURRENCY=32` |
| Warm-up | `WARMUP_SECS=5` (not recorded) |
| Measured window | `DURATION_SECS=10` |
| Repetitions | `REPETITIONS=3` |
| Summary | median of the three repetitions |

Override any of those environment variables, including `HEAP_LIMIT` (hex bytes, no `0x`; default `10000000`, 256 MiB). A full default run is about fifteen minutes of load plus the release builds, because Rust, four .NET GC setups, and the Native AOT publish each get the same three payloads and three repetitions. Native AOT also needs clang and zlib development headers on Linux, and the C++ build tools on Windows.

Outputs:

- `bench/results/results.md` — table used in the write-up
- `bench/results/results.csv`
- `bench/results/runs.jsonl` — one JSON object per repetition
- `bench/results/environment.txt` — versions and machine facts

## Measured results

The checksum now covers every decrypted request byte, and the encrypted response echoes `data`, so both sides encrypt a full-size message. That replaced the previous short digest. Same load otherwise: 32 in-flight requests, 5 s warm-up, 10 s measured, three repetitions, server on CPUs 0-1. Cells are medians. p95 and every repetition, including how many responses were fully checked, are in [bench/results/results.md](bench/results/results.md).

| Variant | 1 KiB req/s | p50 ms | p99 ms | CPU | RSS MiB | 64 KiB req/s | RSS MiB | 1 MiB req/s | p99 ms | RSS MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| rust | 157886.0 | 0.193 | 0.342 | 197.8% | 4.9 | 9934.8 | 9.0 | 533.8 | 102.143 | 38.8 |
| dotnet-server-gc | 95544.9 | 0.305 | 0.704 | 196.4% | 90.1 | 7166.6 | 125.9 | 483.9 | 110.271 | 278.2 |
| dotnet-workstation | 109161.3 | 0.293 | 0.520 | 197.7% | 250.4 | 7930.7 | 211.7 | 484.3 | 108.863 | 521.0 |
| dotnet-workstation-blocking | 106948.1 | 0.299 | 0.539 | 197.9% | 251.2 | 6344.2 | 105.7 | 475.8 | 112.191 | 270.7 |
| dotnet-heap-limit | 93620.1 | 0.308 | 0.808 | 188.8% | 91.1 | 7038.9 | 125.1 | 474.2 | 113.663 | 279.7 |
| dotnet-aot | 83945.6 | 0.340 | 0.832 | 195.9% | 33.4 | 6254.1 | 74.4 | 466.0 | 108.543 | 211.9 |

Compared with the previous digest-only run, 1 MiB throughput fell for everyone because the response is now about as large as the request: Rust 875.4 to 533.8 req/s, Server GC 576.9 to 483.9, Native AOT 518.9 to 466.0. At 1 KiB the drop is smaller (Rust 185926.3 to 157886.0, Server GC 101956.6 to 95544.9, AOT 92096.4 to 83945.6). Every repetition fully decrypted and matched thousands of responses (about 160 on each 1 MiB repetition).

Time to the first `/health` (20 ms poll): Rust 6 ms, Native AOT 58 ms, JIT variants 163–190 ms. The AOT file is 16,005,008 bytes. The ReadyToRun apphost is 78,192 bytes plus a 76,800 byte DLL and needs the shared runtime.

Native AOT is still the smaller .NET process (33.4 MiB at 1 KiB, 211.9 MiB at 1 MiB) and the slower one on throughput. Workstation GC was fastest among the .NET rows at 1 KiB and 64 KiB and tied Server GC at 1 MiB, with a 521.0 MiB resident set at 1 MiB. The heap cap is 256 MiB for this run. 128 MiB returned HTTP 500 once the response echoed a 1 MiB payload at 32 in-flight requests, and at 256 MiB the 1 MiB RSS (279.7 MiB) matches uncapped Server GC (278.2 MiB), so the cap is not binding on that row.

## Tests without a load run

```bash
cargo test -p rust-service
dotnet test dotnet-service/tests/CryptoBench.Tests.csproj -c Release
python3 bench/check_vectors.py
cargo build -p rust-service
dotnet publish dotnet-service/CryptoBench.csproj -c Release -o dotnet-service/publish
bash bench/interop_servers.sh target/debug/rust-service dotnet-service/publish/cryptobench
```

Rust tests include the HTTP handler (encrypt, post, decrypt). .NET tests cover the cipher and the JSON step against the same files. The Python script is what proves the two processes agree with each other and with a third implementation.

## Limits

These are localhost numbers from one machine. They include HTTP, AES-GCM, and a small JSON transform. They are not a language ranking, not a TLS test, and not a pure cipher microbenchmark.

The load generator encrypts one request and resends those bytes. Reusing a GCM nonce is unsafe in production; it only keeps the request body identical. Each response still uses a new nonce. One response per repetition is decrypted and checked.

Absolute rates on a shared cloud VM move around. Read the median, the three repetitions, and `environment.txt` together. Rerun the script on the machine you care about.
