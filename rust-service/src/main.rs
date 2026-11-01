//! Benchmark HTTP service. Requires `BENCH_AES_KEY` (see `bench/WIRE_FORMAT.md`).

use std::net::SocketAddr;

use axum::serve::ListenerExt;
use std::time::Duration;

use rust_service::downstream::DownstreamClient;
use rust_service::{aes_ni_available, parse_key, router_with, CryptoError};

fn main() {
    let key_hex = std::env::var("BENCH_AES_KEY").unwrap_or_else(|_| {
        eprintln!(
            "BENCH_AES_KEY is required (64 hex characters). The key in bench/testdata/bench_key.hex is a public benchmark key, not a secret."
        );
        std::process::exit(1);
    });
    let key = match parse_key(&key_hex) {
        Ok(key) => key,
        Err(CryptoError::Key) => {
            eprintln!("BENCH_AES_KEY must be exactly 32 bytes encoded as 64 hex characters.");
            std::process::exit(1);
        }
        Err(_) => unreachable!(),
    };

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(8080);
    let bind = std::env::var("BIND").unwrap_or_else(|_| "127.0.0.1".to_string());
    let addr: SocketAddr = format!("{bind}:{port}").parse().unwrap_or_else(|_| {
        eprintln!("invalid BIND/PORT");
        std::process::exit(1);
    });

    let worker_threads = std::env::var("TOKIO_WORKER_THREADS")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or_else(|| {
            std::thread::available_parallelism()
                .map(|n| n.get())
                .unwrap_or(1)
        });

    let downstream = match std::env::var("BENCH_DOWNSTREAM_URLS") {
        Ok(raw) if !raw.trim().is_empty() => {
            let urls: Vec<String> = raw
                .split(',')
                .map(|part| part.trim().to_string())
                .filter(|part| !part.is_empty())
                .collect();
            let sequential = matches!(
                std::env::var("BENCH_DOWNSTREAM_MODE").ok().as_deref(),
                Some("sequential")
            );
            let timeout_ms = std::env::var("BENCH_DOWNSTREAM_TIMEOUT_MS")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(2_000u64);
            match DownstreamClient::new(urls, sequential, Duration::from_millis(timeout_ms)) {
                Ok(client) => {
                    eprintln!(
                        "downstream_mode={} timeout_ms={timeout_ms}",
                        if sequential { "sequential" } else { "concurrent" }
                    );
                    Some(client)
                }
                Err(err) => {
                    eprintln!("{err}");
                    std::process::exit(1);
                }
            }
        }
        _ => None,
    };

    eprintln!(
        "listening http://{addr} tokio_worker_threads={worker_threads} aes_ni={} downstream={} pid={}",
        aes_ni_available(),
        downstream.is_some(),
        std::process::id()
    );

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(worker_threads)
        .enable_all()
        .build()
        .expect("tokio runtime");

    runtime.block_on(async move {
        let listener = tokio::net::TcpListener::bind(addr)
            .await
            .unwrap_or_else(|err| {
                eprintln!("bind {addr} failed: {err}");
                std::process::exit(1);
            })
            .tap_io(|stream| {
                let _ = stream.set_nodelay(true);
            });
        axum::serve(listener, router_with(&key, downstream))
            .await
            .unwrap_or_else(|err| {
                eprintln!("server error: {err}");
                std::process::exit(1);
            });
    });
}
