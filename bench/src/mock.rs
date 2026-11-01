//! Local stand-in for five downstream REST APIs. Not a third-party service.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::post;
use axum::Router;
use clap::Parser;
use rust_service::mock_downstream_body;

#[derive(Parser)]
pub struct MockArgs {
    #[arg(long, default_value = "127.0.0.1:8090")]
    pub bind: String,
    #[arg(long, default_value_t = 20)]
    pub delay_ms: u64,
    /// Extra delay, uniform from 0 through this many milliseconds.
    #[arg(long, default_value_t = 0)]
    pub jitter_ms: u64,
    /// Length of the ASCII `pad` field in each JSON body.
    #[arg(long, default_value_t = 32)]
    pub pad_bytes: usize,
    /// If set, that endpoint name returns HTTP 500.
    #[arg(long, default_value = "")]
    pub fail_name: String,
}

#[derive(Clone)]
struct MockState {
    delay_ms: u64,
    jitter_ms: u64,
    pad_bytes: usize,
    fail_name: String,
}

static JITTER_SEED: AtomicU64 = AtomicU64::new(0xA5A5_5A5A_1234_5678);

fn jitter(max: u64) -> u64 {
    if max == 0 {
        return 0;
    }
    let mut x = JITTER_SEED.fetch_add(0x9E37_79B9_7F4A_7C15, Ordering::Relaxed);
    x ^= x >> 30;
    x ^= x << 27;
    x ^= x >> 31;
    x % (max + 1)
}

pub async fn serve(args: MockArgs) -> anyhow::Result<()> {
    let state = Arc::new(MockState {
        delay_ms: args.delay_ms,
        jitter_ms: args.jitter_ms,
        pad_bytes: args.pad_bytes,
        fail_name: args.fail_name,
    });
    let router = Router::new()
        .route("/v1/{name}", post(hit))
        .with_state(state);
    let listener = tokio::net::TcpListener::bind(&args.bind).await?;
    eprintln!(
        "mock listening http://{} delay_ms={} jitter_ms={} pad_bytes={} pid={}",
        args.bind,
        args.delay_ms,
        args.jitter_ms,
        args.pad_bytes,
        std::process::id()
    );
    axum::serve(listener, router).await?;
    Ok(())
}

async fn hit(State(state): State<Arc<MockState>>, Path(name): Path<String>) -> axum::response::Response {
    let wait = state.delay_ms + jitter(state.jitter_ms);
    if wait > 0 {
        tokio::time::sleep(Duration::from_millis(wait)).await;
    }
    if !state.fail_name.is_empty() && state.fail_name == name {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            [("content-type", "application/json")],
            "{\"error\":\"boom\"}".to_string(),
        )
            .into_response();
    }
    (
        StatusCode::OK,
        [("content-type", "application/json")],
        mock_downstream_body(&name, state.pad_bytes),
    )
        .into_response()
}
