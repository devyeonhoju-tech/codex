# Observations from the Native AOT run

`results.md` is the table. This note is the reading of it. The script rewrites the table and does not rewrite this file.

`environment.txt` records `git=e27496e` because that was HEAD when the script started. This run's binaries include `ProtocolJsonContext`, which was not in that commit. The commit that adds these results contains that source generator.

JSON for every .NET variant, JIT and AOT, goes through that context. The wire format and the FNV step are unchanged. Python interop passed against both the ReadyToRun binary and the Native AOT binary, including a tampered tag, invalid JSON, and a missing field. Because the shared serializer changed, the JIT GC variants were measured again in the same run. Server GC at 1 KiB is 101956.6 req/s and 89.6 MiB, next to 100023.6 req/s and 91.4 MiB on the previous reflection-based run. Same band, new measurement.

## Medians

| Variant | 1 KiB req/s | 1 KiB RSS | 64 KiB req/s | 64 KiB RSS | 1 MiB req/s | 1 MiB RSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| rust | 185926.3 | 4.6 | 14973.2 | 8.9 | 875.4 | 36.2 |
| dotnet-server-gc | 101956.6 | 89.6 | 7809.4 | 109.6 | 576.9 | 231.5 |
| dotnet-workstation | 113089.5 | 249.1 | 7037.1 | 98.5 | 602.5 | 304.2 |
| dotnet-workstation-blocking | 112339.3 | 250.4 | 7020.2 | 100.9 | 508.8 | 207.4 |
| dotnet-heap-limit (128 MiB) | 97517.9 | 90.6 | 7668.9 | 110.0 | 446.5 | 187.2 |
| dotnet-aot | 92096.4 | 35.0 | 6752.0 | 53.2 | 518.9 | 149.8 |

p50, p95, p99, and CPU are in `results.md`. Zero HTTP errors. The AOT process logged `server_gc=True concurrent_gc=True`, same GC mode as `dotnet-server-gc`.

## Native AOT

At 1 KiB, AOT RSS is 35.0 MiB against 89.6 MiB for Server GC JIT, and throughput is 92096.4 against 101956.6 req/s. At 64 KiB the gap is 6752.0 vs 7809.4 req/s and 53.2 vs 109.6 MiB. At 1 MiB it is 518.9 vs 576.9 req/s and 149.8 vs 231.5 MiB. p99 at 1 MiB is 97.919 ms for AOT and 89.023 ms for Server GC JIT.

The three 1 MiB AOT repetitions were 486.9, 518.9, and 535.0 req/s. The median is the middle value, and the series was still rising, so a longer warm-up could land a bit higher. Server GC JIT on the same payload was flat to slightly down (584.4, 576.9, 571.2).

Time from process start to the first `/health`, polled every 20 ms: Rust 6 ms, AOT 33 ms, JIT variants 162–165 ms. The AOT image is 16,004,992 bytes and stands alone. The ReadyToRun publish is a 78,192 byte apphost and a 74,240 byte DLL that need the shared ASP.NET Core runtime, which is not included in those two sizes.

AOT does not reach Rust. 35.0 MiB is still about 7.6 times 4.6 MiB at 1 KiB.

## The other .NET rows, remeasured

Workstation GC was the fastest .NET mode at 1 KiB (113089.5 req/s) and at 1 MiB (602.5 req/s) in this run. RSS was 249.1 MiB and 304.2 MiB. That is the opposite of a memory win. Blocking workstation was close at 1 KiB (112339.3 req/s, 250.4 MiB) and slower at 1 MiB (508.8 req/s, 207.4 MiB).

The 128 MiB hard limit leaves the 1 KiB RSS at 90.6 MiB. At 1 MiB it lowers RSS from 231.5 to 187.2 MiB and throughput from 576.9 to 446.5 req/s, with p99 110.527 ms versus 89.023 ms.

## Recommendation

Use **dotnet-aot** when the goal is a smaller .NET process and a faster start, and the roughly 10% throughput gap versus Server GC JIT is acceptable. Use **dotnet-server-gc** when steady-state throughput matters more than RSS and the shared runtime is already installed. Workstation GC is not the way to chase the Rust memory number. The heap cap is only useful if the 1 MiB process must stay under about 200 MiB and the throughput cut is acceptable.
