# Codex

This repository holds two browser games and a Rust versus .NET benchmark. The games and the GitHub Pages workflow are separate from the benchmark services.

- **Gloam**, a survivors-like, is the site root. Play it from `index.html`. On GitHub Pages it stays at `/`.
- **전생검신**, a random-defense game, is in [`geomsin-defense/`](geomsin-defense/README.md). On GitHub Pages it is served at `/geomsin-defense/`.
- The AES-GCM comparison is in [`rust-service/`](rust-service/), [`dotnet-service/`](dotnet-service/), and [`bench/`](bench/WIRE_FORMAT.md).

# Gloam

A small survivors-like you can play in the browser. Move through a dark field, let your bolt fire on its own, pick up the gems enemies drop, and choose an upgrade each time you level. The run ends when your health reaches zero.

Everything on screen is drawn with canvas shapes and CSS. There are no image assets and no third-party libraries.

## Play on your phone

After a push to `main`, and once GitHub Pages is pointed at Actions, both games are served over HTTPS:

- **Gloam** stays at **https://devyeonhoju-tech.github.io/codex/**
- **전생검신** is at **https://devyeonhoju-tech.github.io/codex/geomsin-defense/**

Those addresses stay put. They update a minute or two after each push to `main`. On a phone, drag anywhere on the Gloam field to move. For 전생검신, tap cells and buttons. Neither page scrolls or pinch-zooms while you play, and turning the phone refits the field.

Pages is not enabled until the repository owner sets it. Do this once:

1. On GitHub, open **Settings → Pages** for `devyeonhoju-tech/codex`.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Open the **Actions** tab. The workflow **Deploy games to GitHub Pages** starts on the next push to `main`. If it does not, choose that workflow and press **Run workflow**. If GitHub asks you to approve the `github-pages` environment, approve it.
4. When the run is green, open the addresses above on your phone.

The first visit can take a minute while the certificate is issued. A 404 right after the run finishes usually means the site is still propagating. Reload once.

## Run locally

Open `index.html` in a browser.

Or serve the folder and open the printed address:

```bash
python3 -m http.server 8080
```

No install step and no build.

## Controls

- **Move:** `W` `A` `S` `D` or the arrow keys
- **Touch:** press and drag anywhere on the field. A stick appears under your finger. A mouse drag does the same.
- **Attack:** automatic, toward the nearest enemy
- **Level up:** the run pauses. Click one of up to three arts, or press `1` `2` `3`
- **Sound:** the button in the corner, or `M`
- **After you fall:** `Face the night again`, or press `Enter` or `R`

Health, experience, level, time survived, and kills stay along the top of the screen.

## What a run is

Shamblers arrive first. Skitters show up soon after and can catch you. Brutes are slow, large, and drop three gems. Standing in a crowd blocks your path and chips your health. Gems fly to you only from a short distance, so curve back through the trail you leave behind. Magnetism makes that reach longer. Each level offers a random handful of upgrades: damage, attack speed, extra bolts, move speed, pickup range, health, pierce, bolt size, or regeneration.

# Rust and .NET AES-GCM services

Two small HTTP services that do the same work, plus a load test that runs them under the same conditions.

`POST /v1/process` takes an AES-256-GCM body, decrypts it, runs one deterministic JSON step (FNV-1a 32-bit over the whole decrypted request, echoing `data` into the response), and returns a freshly encrypted response. The byte layout is in [bench/WIRE_FORMAT.md](bench/WIRE_FORMAT.md). Both services and the Python client follow that file.

```
rust-service/     axum + tokio + RustCrypto aes-gcm
dotnet-service/   ASP.NET Core 10 minimal API + System.Security.Cryptography.AesGcm
bench/            wire format, shared vectors, load generator, scripts, results
```

The benchmark servers bind to loopback unless you set `BIND` or `ASPNETCORE_URLS`.

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

`bench/run.sh` measures Rust once and four .NET GC setups, plus Native AOT, all with the same payloads, pinning, warm-up, duration, and repetitions:

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

## Prerequisites

### Linux

- rustup, so `rust-toolchain.toml` can select Rust **1.99.1** (1.88+ is the floor the crates ask for)
- .NET SDK **10**
- Python 3 with the `cryptography` package (`pip install -r bench/testdata/requirements.txt`, or your distro's `python3-cryptography`)
- `curl`, `taskset` (util-linux), and a shell

No C compiler is required for the benchmark's Rust crates. Native AOT for the .NET service needs clang and zlib headers on Linux.

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# https://dotnet.microsoft.com/download/dotnet/10.0
python3 -m pip install --user -r bench/testdata/requirements.txt
```

### Windows

- rustup with the toolchain in `rust-toolchain.toml` (the MSVC toolchain is fine; this repo does not compile C for the benchmark crates)
- .NET SDK 10
- Python 3 on `PATH`, then `py -3 -m pip install -r bench/testdata/requirements.txt`
- PowerShell 5.1 or PowerShell 7

The Windows script does not pin CPUs. `crypto-bench` reads `/proc` for CPU and RSS, so on Windows those columns are `n/a`. Latency and requests/sec still come from the same load generator. For the numbers this repository publishes, use Linux or WSL. Native AOT on Windows needs the C++ build tools.

## Run

From the repository root.

```bash
bash bench/run.sh
```

```powershell
powershell -ExecutionPolicy Bypass -File bench\run.ps1
```

The script runs dev-profile unit tests, checks the shared vectors against Python, builds the release binaries, and runs `bench/interop.py` against those binaries. That client is Python `cryptography` (OpenSSL), not either service. It sends one ciphertext to both processes and requires the decrypted responses to match the vector file, including tampered input and bad JSON.

`bash bench/run-fanout.sh` is a separate matrix. After the same correctness checks it starts `crypto-bench mock` (five loopback `POST /v1/{a,b,c,d,e}` endpoints) and measures baseline (no downstream), five concurrent calls, and a smaller sequential and jitter slice. It does not replace `run.sh`. It skips the 1 MiB payload, the heap cap, and blocking workstation GC. The mock is pinned to the same CPUs as the load generator, so those rates are indicative.

| Knob | `run-fanout.sh` |
| --- | --- |
| `data` length | 1024 and 65536 bytes. Sequential and jitter are 1024 only |
| In-flight requests | 32, 256, and 1024. Sequential and jitter are 32 only |
| Downstream | off, then five calls at a fixed 20 ms and 100 ms. Jitter is 20 ms plus a uniform 0..=30 ms |
| Mock body | `{"endpoint":"<name>","pad":"<128 x>"}` |
| Warm-up, window, repetitions | 5 s, 10 s, 3, median, same as `run.sh` |
| Variants | Rust, Server GC, Workstation GC (background on), Native AOT |

Outputs from that script: `bench/results/fanout-results.md`, `fanout-results.csv`, `fanout-runs.jsonl`, `fanout-environment.txt`. A short reading of those medians is in [bench/results/FANOUT_OBSERVATIONS.md](bench/results/FANOUT_OBSERVATIONS.md).

`bench/run.sh` then load-tests one service at a time:

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

## Five downstream calls

`bench/run-fanout.sh` measured the same services after each decrypted request also POSTs that plaintext to five local endpoints and encrypts the aggregated response. Cells below are medians from [bench/results/fanout-results.md](bench/results/fanout-results.md). Every repetition had zero HTTP errors, and every 32nd success was decrypted and matched in full. The mock and the load generator shared CPUs 2-3, so treat the absolute rates as indicative. `fanout-environment.txt` records `git=7d4847e` because that was HEAD when the script started; the binaries were this working tree.

At concurrency 32 and 1 KiB, adding the five calls removes the CPU-bound gap. Baseline (no downstream) is still Rust ahead: 131759.8 req/s, p50 0.234 ms, RSS 5.4 MiB, against Server GC 94958.6 / 0.304 ms / 91.5 MiB, Workstation 106982.0 / 0.299 ms / 252.1 MiB, and Native AOT 84978.9 / 0.341 ms / 37.5 MiB, all near 200% CPU. With five concurrent calls at 20 ms the four rows sit at 1430.7–1442.0 req/s and p50 22.1–22.3 ms, using about 20–24% CPU. At 100 ms every row is 310.4 req/s and p50 102.2–102.4 ms, about 5–6% CPU. That is the mock delay times 32 in-flight requests, not the language. RSS still separates them at 100 ms: Rust 13.6 MiB, AOT 59.8, Server GC 123.4, Workstation 254.0.

Sequential mode is the delay times five. At 100 ms every stack does 60.8 req/s with p50 about 509 ms. At 20 ms the rows are 291.2–294.4 req/s with p50 107–109 ms. The jitter row (20 ms plus 0..=30 ms) is 681.2–682.5 req/s, p50 about 47.9 ms, again the same for all four.

Higher concurrency is where the stacks split, and not all in one direction. At 1 KiB, 1024 in flight, and a 100 ms mock, Rust stays on the delay: 9757.0 req/s, p50 103.615 ms, p99 109.631 ms, 158.5% CPU, RSS 271.7 MiB. Server GC is 3819.6 req/s, p50 261.503 ms, p99 329.727 ms, 55.1% CPU. AOT is 3788.8 and Workstation is 3693.7, with p50 261.6 ms and 280.6 ms. .NET is leaving cores idle and queueing. At the same concurrency with a 20 ms mock the client and the mock are the tight resource, and Server GC completes more requests than Rust: 14357.8 req/s, p50 70.207 ms, p99 97.087 ms, against Rust 12078.3 req/s, p50 32.111 ms, p99 252.671 ms. Rust's median is lower and its tail is much worse, so its throughput is lower. At 64 KiB and 1024 in flight everyone is near two busy cores and the req/s gap shrinks (Rust 2449.7 vs Server GC 2237.3 at 100 ms) while tails and RSS are both large.

At 64 KiB and concurrency 32 the baseline is still CPU-bound (Rust 9184.0 req/s, RSS 30.9 MiB; Server GC 7180.1 / 129.9). A 100 ms fan-out pulls everyone to 305.1–307.6 req/s. A 20 ms fan-out leaves a smaller Rust lead: 1379.6 vs Server GC 1260.7, AOT 1216.1, Workstation 1158.2. On that 64 KiB fan-out the Rust resident set is no longer the small one (233.0 MiB at 100 ms, 187.7 MiB at 20 ms, against Server GC 133.9 and 138.6).

The earlier table in this file is a different run (`results.md`: 1 MiB, heap cap, blocking workstation, concurrency 32 only). Do not mix those req/s with this matrix. The 1 KiB Rust baseline here is 131759.8, not the 157886.0 from that earlier file.

## Tests without a load run

```bash
cargo test -p rust-service
dotnet test dotnet-service/tests/CryptoBench.Tests.csproj -c Release
python3 bench/check_vectors.py
cargo build -p rust-service -p crypto-bench
dotnet publish dotnet-service/CryptoBench.csproj -c Release -o dotnet-service/publish
bash bench/interop_servers.sh target/debug/rust-service dotnet-service/publish/cryptobench
bash bench/interop_downstream.sh target/debug/rust-service target/debug/crypto-bench dotnet-service/publish/cryptobench
```

Rust tests include the HTTP handler (encrypt, post, decrypt), the five-call aggregate, a downstream 5xx, and a downstream timeout. .NET tests cover the cipher, the JSON step, baseline omission of `downstream`, the five-call order, a non-2xx, and a timeout. Both services answer those failures with HTTP 502 and plaintext `{"error":"downstream_failed"}`. The Python scripts prove the two processes agree with each other and with a third implementation. CI runs these checks and does not run `bench/run.sh` or `bench/run-fanout.sh`.

## Limits

These are localhost numbers from one machine. The crypto-only run includes HTTP, AES-GCM, and a JSON transform. The fan-out run adds five loopback REST calls to a mock that shares the VM with the load generator. They are not a language ranking, not a TLS test, and not a pure cipher microbenchmark.

The load generator encrypts one request and resends those bytes. Reusing a GCM nonce is unsafe in production; it only keeps the request body identical. Each response still uses a new nonce. During the measured window every 32nd success is decrypted and compared in full.

Absolute rates on a shared cloud VM move around. Read the median, the three repetitions, and `environment.txt` together. Rerun the script on the machine you care about.
