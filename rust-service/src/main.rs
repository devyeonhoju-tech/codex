//! Benchmark HTTP service. Requires `BENCH_AES_KEY` (see `bench/WIRE_FORMAT.md`).

use std::net::SocketAddr;

use axum::serve::ListenerExt;
use rust_service::{aes_ni_available, parse_key, router, CryptoError};

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

    eprintln!(
        "listening http://{addr} tokio_worker_threads={worker_threads} aes_ni={} pid={}",
        aes_ni_available(),
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
        axum::serve(listener, router(&key))
            .await
            .unwrap_or_else(|err| {
                eprintln!("server error: {err}");
                std::process::exit(1);
            });
    });
}
