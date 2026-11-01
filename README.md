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
| Build | `cargo build --release` with thin LTO and `codegen-units = 1`. Not `target-cpu=native` | `dotnet publish -c Release`, framework-dependent, ReadyToRun, Server GC, tiered PGO, invariant globalization. Not Native AOT |
| HTTP | HTTP/1.1, `TCP_NODELAY` on accepted sockets | HTTP/1.1, Kestrel socket transport `NoDelay = true` |
| Threads | `TOKIO_WORKER_THREADS=2` when the Linux script pins the process to two CPUs | `Environment.ProcessorCount` follows the Linux affinity mask (two CPUs in the script) |
| JSON | `serde_json` | `System.Text.Json`, camelCase, `UnsafeRelaxedJsonEscaping` |
| AES object | one `Aes256Gcm` shared across tasks (`encrypt` takes `&self`) | one `AesGcm` per thread (`ThreadLocal`); the type is not thread-safe |

Native AOT is a reasonable production build, and it is not what was measured. ReadyToRun plus the JIT is the usual ASP.NET deployment, and it does not need the C++/clang toolchain AOT wants on Windows. Invariant globalization is on because this service never formats cultures; it drops the ICU dependency.

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

Override any of those environment variables. A full default run is a few minutes of load plus the release builds (thin LTO is the slow part).

Outputs:

- `bench/results/results.md` — table used in the write-up
- `bench/results/results.csv`
- `bench/results/runs.jsonl` — one JSON object per repetition
- `bench/results/environment.txt` — versions and machine facts

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
