//! Closed-loop HTTP/1.1 load generator for the two benchmark services.
//!
//! Latency is client-observed. On Linux, CPU is user+system time from
//! `/proc/<pid>/stat` over the measurement window (100% = one core). That file
//! is the thread group's total, including threads that have already exited.
//! Summing `/proc/<pid>/task/*/stat` drops those threads and can report 0%.
//! Memory is VmRSS sampled about five times a second.

use std::fs::OpenOptions;
use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::process::id as own_pid;
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Context};
use bytes::Bytes;
use clap::{Parser, Subcommand};
use hdrhistogram::Histogram;
use http_body_util::{BodyExt, Full};
use hyper::client::conn::http1::handshake;
use hyper::Request;
use hyper_util::rt::TokioIo;
use rust_service::crypto::cipher;
use rust_service::{open, parse_key, process_plaintext, seal};
use serde::{Deserialize, Serialize};
use tokio::net::TcpStream;
use tokio::task::JoinHandle;

#[derive(Parser)]
#[command(name = "crypto-bench")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Run one measured repetition against an already-running service.
    Load(LoadArgs),
    /// Fold runs.jsonl into markdown and CSV.
    Report(ReportArgs),
}

#[derive(Parser)]
struct LoadArgs {
    /// Full URL of POST /v1/process.
    #[arg(long)]
    url: String,
    /// Server process id to sample.
    #[arg(long)]
    pid: u32,
    #[arg(long)]
    service: String,
    /// Decoded length of the JSON `data` string.
    #[arg(long)]
    payload_bytes: usize,
    #[arg(long)]
    repetition: u32,
    #[arg(long, default_value_t = 32)]
    concurrency: usize,
    #[arg(long, default_value_t = 5)]
    warmup_secs: u64,
    #[arg(long, default_value_t = 10)]
    duration_secs: u64,
    #[arg(long)]
    output: PathBuf,
}

#[derive(Parser)]
struct ReportArgs {
    #[arg(long)]
    input: PathBuf,
    #[arg(long)]
    markdown: PathBuf,
    #[arg(long)]
    csv: PathBuf,
    /// Optional environment notes pasted into the markdown report.
    #[arg(long)]
    env_file: Option<PathBuf>,
}

#[derive(Clone, Serialize, Deserialize)]
struct RunRecord {
    service: String,
    payload_bytes: u64,
    http_body_bytes: u64,
    repetition: u32,
    concurrency: u32,
    warmup_secs: u64,
    duration_secs: u64,
    requests: u64,
    errors: u64,
    rps: f64,
    p50_ms: f64,
    p95_ms: f64,
    p99_ms: f64,
    cpu_pct_one_core: f64,
    rss_avg_mib: f64,
    rss_peak_mib: f64,
    client_cpu_pct_one_core: f64,
    verified: bool,
    affinity: String,
}

struct Resources {
    cpu_pct_one_core: f64,
    rss_avg_mib: f64,
    rss_peak_mib: f64,
    client_cpu_pct_one_core: f64,
    affinity: String,
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Command::Load(args) => load(args),
        Command::Report(args) => report(args),
    }
}

fn load(args: LoadArgs) -> anyhow::Result<()> {
    let key_hex = std::env::var("BENCH_AES_KEY")
        .context("BENCH_AES_KEY is required (public benchmark key; see bench/WIRE_FORMAT.md)")?;
    let key =
        parse_key(&key_hex).map_err(|_| anyhow!("BENCH_AES_KEY must be 64 hex characters"))?;
    let aes = cipher(&key);
    let plaintext = request_json(args.payload_bytes);
    let wire = Bytes::from(seal(&aes, &plaintext).map_err(|_| anyhow!("encrypt request failed"))?);
    let expected = process_plaintext(&plaintext).map_err(|_| anyhow!("build expected response"))?;
    let (host, port, path) = parse_http_url(&args.url)?;
    let host_header = format!("{host}:{port}");

    let warmup = Duration::from_secs(args.warmup_secs);
    let duration = Duration::from_secs(args.duration_secs);
    let origin = Instant::now();
    let pid = args.pid;
    let sampler =
        std::thread::spawn(move || sample_resources(pid, own_pid(), origin, warmup, duration));

    let workers = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1);
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(workers)
        .enable_all()
        .build()?;

    let wire = Arc::new(wire);
    let mut joins = Vec::with_capacity(args.concurrency);
    for _ in 0..args.concurrency {
        let wire = Arc::clone(&wire);
        let host_header = host_header.clone();
        let path = path.clone();
        let host = host.clone();
        joins.push(runtime.spawn(async move {
            worker(
                host,
                port,
                host_header,
                path,
                wire,
                origin,
                warmup,
                duration,
            )
            .await
        }));
    }

    let mut merged = Histogram::<u64>::new_with_bounds(1, 120_000_000, 3)?;
    let mut requests = 0u64;
    let mut errors = 0u64;
    let mut sample: Option<Bytes> = None;
    for join in joins {
        let (hist, ok, err, last) = runtime.block_on(join)??;
        requests += ok;
        errors += err;
        if sample.is_none() {
            sample = last;
        }
        if hist.len() > 0 {
            merged.add(&hist)?;
        }
    }
    let resources = sampler
        .join()
        .map_err(|_| anyhow!("resource sampler panicked"))??;

    let verified = match sample {
        Some(body) => {
            let opened =
                open(&aes, &body).map_err(|_| anyhow!("sample response did not decrypt"))?;
            if opened.as_slice() != expected.as_slice() {
                eprintln!(
                    "verification mismatch\n got {}\n exp {}",
                    String::from_utf8_lossy(&opened),
                    String::from_utf8_lossy(&expected)
                );
                false
            } else {
                true
            }
        }
        None => false,
    };

    let (p50, p95, p99) = if merged.len() == 0 {
        (0.0, 0.0, 0.0)
    } else {
        (
            merged.value_at_quantile(0.50) as f64 / 1000.0,
            merged.value_at_quantile(0.95) as f64 / 1000.0,
            merged.value_at_quantile(0.99) as f64 / 1000.0,
        )
    };
    let rps = requests as f64 / args.duration_secs as f64;
    let record = RunRecord {
        service: args.service,
        payload_bytes: args.payload_bytes as u64,
        http_body_bytes: wire.len() as u64,
        repetition: args.repetition,
        concurrency: args.concurrency as u32,
        warmup_secs: args.warmup_secs,
        duration_secs: args.duration_secs,
        requests,
        errors,
        rps,
        p50_ms: p50,
        p95_ms: p95,
        p99_ms: p99,
        cpu_pct_one_core: resources.cpu_pct_one_core,
        rss_avg_mib: resources.rss_avg_mib,
        rss_peak_mib: resources.rss_peak_mib,
        client_cpu_pct_one_core: resources.client_cpu_pct_one_core,
        verified,
        affinity: resources.affinity,
    };

    if let Some(parent) = args.output.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&args.output)?;
    writeln!(file, "{}", serde_json::to_string(&record)?)?;
    println!(
        "{} payload={} rep={} rps={:.1} p50={:.3}ms p99={:.3}ms cpu={:.1}% rss={:.1}MiB errors={} verified={}",
        record.service,
        record.payload_bytes,
        record.repetition,
        record.rps,
        record.p50_ms,
        record.p99_ms,
        record.cpu_pct_one_core,
        record.rss_avg_mib,
        record.errors,
        record.verified
    );

    if errors > 0 || !verified || requests == 0 {
        anyhow::bail!(
            "load run failed (errors={errors}, verified={verified}, requests={requests})"
        );
    }
    Ok(())
}

fn request_json(payload: usize) -> Vec<u8> {
    let mut body = Vec::with_capacity(payload + 64);
    body.extend_from_slice(br#"{"id":"bench","data":""#);
    body.resize(body.len() + payload, b'x');
    body.extend_from_slice(br#"","multiplier":1}"#);
    body
}

fn parse_http_url(url: &str) -> anyhow::Result<(String, u16, String)> {
    let rest = url
        .strip_prefix("http://")
        .ok_or_else(|| anyhow!("only http:// URLs are supported, got {url}"))?;
    let (hostport, path) = match rest.split_once('/') {
        Some((hostport, path)) => (hostport, format!("/{path}")),
        None => (rest, "/".to_string()),
    };
    if hostport.is_empty() {
        anyhow::bail!("missing host in {url}");
    }
    let (host, port) = match hostport.rsplit_once(':') {
        Some((host, port)) => (host.to_string(), port.parse::<u16>()?),
        None => (hostport.to_string(), 80),
    };
    Ok((host, port, path))
}

async fn worker(
    host: String,
    port: u16,
    host_header: String,
    path: String,
    body: Arc<Bytes>,
    origin: Instant,
    warmup: Duration,
    duration: Duration,
) -> anyhow::Result<(Histogram<u64>, u64, u64, Option<Bytes>)> {
    let measure_end = origin + warmup + duration;
    let warmup_end = origin + warmup;
    let mut hist = Histogram::<u64>::new_with_bounds(1, 120_000_000, 3)?;
    let mut ok = 0u64;
    let mut err = 0u64;
    let mut last = None;
    let mut live = connect(&host, port).await?;
    while Instant::now() < measure_end {
        let started = Instant::now();
        let in_window = started >= warmup_end;
        let result = send_one(&mut live, &host_header, &path, (*body).clone()).await;
        let finished = Instant::now();
        match result {
            Ok(bytes) => {
                if in_window && finished <= measure_end {
                    let us = started.elapsed().as_micros().clamp(1, 120_000_000) as u64;
                    hist.record(us)?;
                    ok += 1;
                    last = Some(bytes);
                }
            }
            Err(error) => {
                if in_window && finished <= measure_end {
                    err += 1;
                    if err <= 3 {
                        eprintln!("request error: {error:#}");
                    }
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
                if let Ok(fresh) = connect(&host, port).await {
                    live = fresh;
                }
            }
        }
    }
    Ok((hist, ok, err, last))
}

struct Live {
    sender: hyper::client::conn::http1::SendRequest<Full<Bytes>>,
    conn: JoinHandle<()>,
}

impl Drop for Live {
    fn drop(&mut self) {
        self.conn.abort();
    }
}

async fn connect(host: &str, port: u16) -> anyhow::Result<Live> {
    let stream = TcpStream::connect((host, port))
        .await
        .with_context(|| format!("connect {host}:{port}"))?;
    stream.set_nodelay(true)?;
    let io = TokioIo::new(stream);
    let (sender, connection) = handshake::<_, Full<Bytes>>(io).await?;
    let conn = tokio::spawn(async move {
        let _ = connection.await;
    });
    Ok(Live { sender, conn })
}

async fn send_one(
    live: &mut Live,
    host_header: &str,
    path: &str,
    body: Bytes,
) -> anyhow::Result<Bytes> {
    live.sender.ready().await?;
    let request = Request::builder()
        .method("POST")
        .uri(path)
        .header("host", host_header)
        .header("content-type", "application/octet-stream")
        .header("connection", "keep-alive")
        .body(Full::new(body))?;
    let response = live.sender.send_request(request).await?;
    let status = response.status().as_u16();
    let bytes = response.into_body().collect().await?.to_bytes();
    if status != 200 {
        anyhow::bail!(
            "HTTP {status} body {}",
            String::from_utf8_lossy(&bytes[..bytes.len().min(180)])
        );
    }
    if bytes.len() < 28 {
        anyhow::bail!("short response ({} bytes)", bytes.len());
    }
    Ok(bytes)
}

fn sample_resources(
    pid: u32,
    client_pid: u32,
    origin: Instant,
    warmup: Duration,
    duration: Duration,
) -> anyhow::Result<Resources> {
    if !cfg!(target_os = "linux") {
        let wait = (warmup + duration).saturating_sub(origin.elapsed());
        std::thread::sleep(wait);
        return Ok(Resources {
            cpu_pct_one_core: -1.0,
            rss_avg_mib: -1.0,
            rss_peak_mib: -1.0,
            client_cpu_pct_one_core: -1.0,
            affinity: "not collected on this OS".to_string(),
        });
    }
    let affinity = read_affinity(pid);
    let wait = warmup.saturating_sub(origin.elapsed());
    std::thread::sleep(wait);
    let start = Instant::now();
    let server_ticks = read_cpu_ticks(pid)?;
    let client_ticks = read_cpu_ticks(client_pid)?;
    let mut rss = Vec::new();
    while start.elapsed() < duration {
        if let Ok(kib) = read_rss_kib(pid) {
            rss.push(kib);
        }
        let remaining = duration.saturating_sub(start.elapsed());
        std::thread::sleep(remaining.min(Duration::from_millis(200)));
    }
    let elapsed = start.elapsed().as_secs_f64().max(0.001);
    let server_end = read_cpu_ticks(pid)?;
    let client_end = read_cpu_ticks(client_pid)?;
    let hz = clk_tck() as f64;
    let cpu = (server_end.saturating_sub(server_ticks) as f64) / hz / elapsed * 100.0;
    let client_cpu = (client_end.saturating_sub(client_ticks) as f64) / hz / elapsed * 100.0;
    let rss_avg = if rss.is_empty() {
        0.0
    } else {
        rss.iter().sum::<u64>() as f64 / rss.len() as f64 / 1024.0
    };
    let rss_peak = rss.iter().copied().max().unwrap_or(0) as f64 / 1024.0;
    Ok(Resources {
        cpu_pct_one_core: cpu,
        rss_avg_mib: rss_avg,
        rss_peak_mib: rss_peak,
        client_cpu_pct_one_core: client_cpu,
        affinity,
    })
}

fn clk_tck() -> u64 {
    let value = unsafe { libc::sysconf(libc::_SC_CLK_TCK) };
    if value > 0 {
        value as u64
    } else {
        100
    }
}

fn read_cpu_ticks(pid: u32) -> anyhow::Result<u64> {
    // `/proc/<pid>/stat` keeps the whole thread group's time. Per-task files do
    // not: a thread that exits disappears, and the sum can go backwards.
    let text = std::fs::read_to_string(format!("/proc/{pid}/stat"))
        .with_context(|| format!("read /proc/{pid}/stat"))?;
    let (_, rest) = text
        .rsplit_once(')')
        .ok_or_else(|| anyhow!("unrecognized stat for {pid}"))?;
    let fields: Vec<&str> = rest.split_whitespace().collect();
    if fields.len() < 13 {
        anyhow::bail!("short stat for {pid}");
    }
    let utime: u64 = fields[11].parse().context("utime")?;
    let stime: u64 = fields[12].parse().context("stime")?;
    Ok(utime + stime)
}

fn read_rss_kib(pid: u32) -> anyhow::Result<u64> {
    let text = std::fs::read_to_string(format!("/proc/{pid}/status"))?;
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("VmRSS:") {
            let kib = rest
                .split_whitespace()
                .next()
                .ok_or_else(|| anyhow!("empty VmRSS"))?
                .parse()?;
            return Ok(kib);
        }
    }
    anyhow::bail!("VmRSS missing for {pid}")
}

fn read_affinity(pid: u32) -> String {
    let Ok(text) = std::fs::read_to_string(format!("/proc/{pid}/status")) else {
        return String::new();
    };
    text.lines()
        .find_map(|line| line.strip_prefix("Cpus_allowed_list:"))
        .map(|rest| rest.trim().to_string())
        .unwrap_or_default()
}

fn report(args: ReportArgs) -> anyhow::Result<()> {
    let file = std::fs::File::open(&args.input)
        .with_context(|| format!("open {}", args.input.display()))?;
    let mut runs = Vec::new();
    for line in std::io::BufReader::new(file).lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        runs.push(serde_json::from_str::<RunRecord>(&line)?);
    }
    if runs.is_empty() {
        anyhow::bail!("no runs in {}", args.input.display());
    }

    let mut groups: Vec<(String, u64)> = Vec::new();
    for run in &runs {
        let key = (run.service.clone(), run.payload_bytes);
        if !groups.contains(&key) {
            groups.push(key);
        }
    }
    groups.sort_by(|a, b| a.1.cmp(&b.1).then_with(|| a.0.cmp(&b.0)));

    let mut notes = Vec::new();
    let mut summary = String::new();
    summary.push_str("| Service | Payload | HTTP body | RPS | p50 ms | p95 ms | p99 ms | CPU (1 core = 100%) | RSS avg MiB | RSS peak MiB |\n");
    summary.push_str("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n");

    for (service, payload) in &groups {
        let mut subset: Vec<&RunRecord> = runs
            .iter()
            .filter(|run| run.service == *service && run.payload_bytes == *payload)
            .collect();
        subset.sort_by_key(|run| run.repetition);
        let median = median_run(&subset);
        summary.push_str(&format!(
            "| {service} | {payload} | {} | {:.1} | {:.3} | {:.3} | {:.3} | {} | {} | {} |\n",
            median.http_body_bytes,
            median.rps,
            median.p50_ms,
            median.p95_ms,
            median.p99_ms,
            fmt_metric(median.cpu_pct_one_core, 1),
            fmt_metric(median.rss_avg_mib, 1),
            fmt_metric(median.rss_peak_mib, 1),
        ));
        if median.client_cpu_pct_one_core >= 170.0
            && median.cpu_pct_one_core + 40.0 < median.client_cpu_pct_one_core
        {
            notes.push(format!(
                "{service} at {payload} bytes looks client-limited: client CPU {:.0}% of one core, server CPU {:.0}%.",
                median.client_cpu_pct_one_core, median.cpu_pct_one_core
            ));
        }
        if subset.iter().any(|run| run.errors > 0 || !run.verified) {
            notes.push(format!(
                "{service} at {payload} bytes has a failed repetition; do not trust that row."
            ));
        }
    }

    let mut details = String::new();
    details.push_str("| Service | Payload | Rep | Requests | Errors | RPS | p50 ms | p95 ms | p99 ms | Server CPU | Client CPU | RSS avg | RSS peak | Affinity | Verified |\n");
    details.push_str("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |\n");
    let mut ordered = runs.clone();
    ordered.sort_by(|a, b| {
        a.payload_bytes
            .cmp(&b.payload_bytes)
            .then_with(|| a.service.cmp(&b.service))
            .then_with(|| a.repetition.cmp(&b.repetition))
    });
    for run in &ordered {
        details.push_str(&format!(
            "| {} | {} | {} | {} | {} | {:.1} | {:.3} | {:.3} | {:.3} | {} | {} | {} | {} | {} | {} |\n",
            run.service,
            run.payload_bytes,
            run.repetition,
            run.requests,
            run.errors,
            run.rps,
            run.p50_ms,
            run.p95_ms,
            run.p99_ms,
            fmt_metric(run.cpu_pct_one_core, 1),
            fmt_metric(run.client_cpu_pct_one_core, 1),
            fmt_metric(run.rss_avg_mib, 1),
            fmt_metric(run.rss_peak_mib, 1),
            if run.affinity.is_empty() { "-".to_string() } else { run.affinity.clone() },
            run.verified
        ));
    }

    let env = match &args.env_file {
        Some(path) => {
            std::fs::read_to_string(path).with_context(|| format!("read {}", path.display()))?
        }
        None => "(environment file not provided)\n".to_string(),
    };
    let note_text = if notes.is_empty() {
        "None of the median rows tripped the client-saturation heuristic (client CPU at least 170% of one core and more than 40 points above the server).".to_string()
    } else {
        notes
            .iter()
            .map(|note| format!("- {note}"))
            .collect::<Vec<_>>()
            .join("\n")
    };
    let head = &runs[0];
    let markdown = format!(
        r#"# Benchmark results

These numbers were measured by `bench/run.sh` on this machine. They are not a general ranking of Rust and C#. Absolute throughput will move on other hardware, and a shared cloud VM is noisy.

Summary values are the **median of {reps} repetitions**. Each repetition is a closed-loop HTTP/1.1 run: {concurrency} in-flight requests, {warmup}s warm-up (discarded), {duration}s measured. Payload is the UTF-8 length of the JSON `data` field. CPU is server user+system time from `/proc/<pid>/stat` over the measured window, where 100% means one fully busy core. RSS is the server's resident set during that window.

## Summary

{summary}
## Every repetition

{details}
## What stood out

{note_text}

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
{env}```

## Limits

A 4-vCPU guest cannot say which language is faster in production. Use this as a same-machine comparison of these two programs, and rerun `bench/run.sh` or `bench/run.ps1` where the result matters.
"#,
        reps = head
            .repetition
            .max(ordered.iter().map(|run| run.repetition).max().unwrap_or(1)),
        concurrency = head.concurrency,
        warmup = head.warmup_secs,
        duration = head.duration_secs,
        summary = summary,
        details = details,
        note_text = note_text,
        env = env,
    );

    if let Some(parent) = args.markdown.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&args.markdown, markdown)?;

    let mut csv = String::from("service,payload_bytes,http_body_bytes,repetition,concurrency,warmup_secs,duration_secs,requests,errors,rps,p50_ms,p95_ms,p99_ms,cpu_pct_one_core,rss_avg_mib,rss_peak_mib,client_cpu_pct_one_core,verified,affinity\n");
    for run in &ordered {
        csv.push_str(&format!(
            "{},{},{},{},{},{},{},{},{},{:.4},{:.4},{:.4},{:.4},{:.4},{:.4},{:.4},{:.4},{},{}\n",
            run.service,
            run.payload_bytes,
            run.http_body_bytes,
            run.repetition,
            run.concurrency,
            run.warmup_secs,
            run.duration_secs,
            run.requests,
            run.errors,
            run.rps,
            run.p50_ms,
            run.p95_ms,
            run.p99_ms,
            run.cpu_pct_one_core,
            run.rss_avg_mib,
            run.rss_peak_mib,
            run.client_cpu_pct_one_core,
            run.verified,
            run.affinity
        ));
    }
    std::fs::write(&args.csv, csv)?;
    println!(
        "wrote {} and {}",
        args.markdown.display(),
        args.csv.display()
    );
    Ok(())
}

fn fmt_metric(value: f64, digits: usize) -> String {
    if value < 0.0 {
        "n/a".to_string()
    } else {
        format!("{value:.digits$}")
    }
}

fn median_run(runs: &[&RunRecord]) -> RunRecord {
    fn median(mut values: Vec<f64>) -> f64 {
        values.sort_by(|a, b| a.total_cmp(b));
        values[values.len() / 2]
    }
    let mut sample = (*runs[runs.len() / 2]).clone();
    sample.rps = median(runs.iter().map(|run| run.rps).collect());
    sample.p50_ms = median(runs.iter().map(|run| run.p50_ms).collect());
    sample.p95_ms = median(runs.iter().map(|run| run.p95_ms).collect());
    sample.p99_ms = median(runs.iter().map(|run| run.p99_ms).collect());
    sample.cpu_pct_one_core = median(runs.iter().map(|run| run.cpu_pct_one_core).collect());
    sample.rss_avg_mib = median(runs.iter().map(|run| run.rss_avg_mib).collect());
    sample.rss_peak_mib = median(runs.iter().map(|run| run.rss_peak_mib).collect());
    sample.client_cpu_pct_one_core =
        median(runs.iter().map(|run| run.client_cpu_pct_one_core).collect());
    sample.requests = median(runs.iter().map(|run| run.requests as f64).collect()) as u64;
    sample.errors = runs.iter().map(|run| run.errors).sum();
    sample
}
