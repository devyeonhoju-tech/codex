use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Router;
use serde_json::json;

use crate::db::{self, Settings, WriteMode};
use crate::writer::{self, Stats, SubmitHandle, WriteOutcome};

pub const MAX_BODY: usize = 16 * 1024;

#[derive(Clone)]
pub enum Engine {
    Batch(SubmitHandle),
    Single(Arc<writer::SinglePool>),
}

#[derive(Clone)]
pub struct AppState {
    pub settings: Arc<Settings>,
    pub stats: Arc<Stats>,
    pub engine: Engine,
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/ready", get(ready))
        .route("/stats", get(stats))
        .route("/v1/ingest", post(ingest))
        .layer(DefaultBodyLimit::max(MAX_BODY))
        .with_state(state)
}

async fn health() -> &'static str {
    "ok"
}

async fn ready(State(state): State<AppState>) -> Response {
    match db::connect(&state.settings, &state.settings.database).await {
        Ok(mut client) => match client.simple_query("SELECT 1").await {
            Ok(stream) => match stream.into_row().await {
                Ok(_) => (StatusCode::OK, "ok").into_response(),
                Err(err) => (StatusCode::SERVICE_UNAVAILABLE, err.to_string()).into_response(),
            },
            Err(err) => (StatusCode::SERVICE_UNAVAILABLE, err.to_string()).into_response(),
        },
        Err(err) => (StatusCode::SERVICE_UNAVAILABLE, err.to_string()).into_response(),
    }
}

async fn stats(State(state): State<AppState>) -> Response {
    let queue_depth = match &state.engine {
        Engine::Batch(handle) => handle.queue_depth(),
        Engine::Single(pool) => pool.queue_depth(),
    };
    let body = json!({
        "service": "rust",
        "mode": writer::mode_name(state.settings.mode),
        "batchSize": state.settings.batch_size,
        "flushIntervalMs": state.settings.flush_ms,
        "writers": state.settings.writers,
        "queueCapacity": state.settings.queue_capacity,
        "maxPoolSize": state.settings.max_pool_size,
        "queueDepth": queue_depth,
        "accepted": state.stats.accepted.load(std::sync::atomic::Ordering::Relaxed),
        "rejected": state.stats.rejected.load(std::sync::atomic::Ordering::Relaxed),
        "committed": state.stats.committed.load(std::sync::atomic::Ordering::Relaxed),
        "duplicates": state.stats.duplicates.load(std::sync::atomic::Ordering::Relaxed),
        "failed": state.stats.failed.load(std::sync::atomic::Ordering::Relaxed),
        "batches": state.stats.batches.load(std::sync::atomic::Ordering::Relaxed),
        "acknowledgement": "after_commit",
    });
    json_response(StatusCode::OK, body.to_string())
}

async fn ingest(State(state): State<AppState>, body: Bytes) -> Response {
    let event = match crate::event::parse_event(&body) {
        Ok(event) => event,
        Err(code) => return error(StatusCode::BAD_REQUEST, code),
    };
    let outcome = match &state.engine {
        Engine::Batch(handle) => match handle.try_submit(event, &state.stats) {
            Ok(mut rx) => match rx.recv().await {
                Some(outcome) => outcome,
                None => WriteOutcome::Failed,
            },
            Err(outcome) => return outcome_response(outcome),
        },
        Engine::Single(pool) => pool.insert(event).await,
    };
    outcome_response(outcome)
}

fn outcome_response(outcome: WriteOutcome) -> Response {
    match outcome {
        WriteOutcome::Committed => json_response(StatusCode::ACCEPTED, r#"{"status":"committed"}"#.to_string()),
        WriteOutcome::Duplicate => error(StatusCode::CONFLICT, "duplicate_id"),
        WriteOutcome::Rejected => error(StatusCode::TOO_MANY_REQUESTS, "queue_full"),
        WriteOutcome::Failed => error(StatusCode::SERVICE_UNAVAILABLE, "write_failed"),
    }
}

fn error(status: StatusCode, code: &str) -> Response {
    json_response(status, format!(r#"{{"error":"{code}"}}"#))
}

fn json_response(status: StatusCode, body: String) -> Response {
    (status, [(header::CONTENT_TYPE, "application/json")], body).into_response()
}

pub fn listen_line(settings: &Settings, pid: u32) -> String {
    format!(
        "listening http://{}:{} service=rust mode={} batch_size={} flush_ms={} writers={} queue_capacity={} max_pool={} acknowledgement=after_commit throwaway_password={} tokio_worker_threads={} pid={pid}",
        settings.bind,
        settings.http_port,
        writer::mode_name(settings.mode),
        settings.batch_size,
        settings.flush_ms,
        settings.writers,
        settings.queue_capacity,
        settings.max_pool_size,
        settings.password_is_throwaway,
        settings.worker_threads,
    )
}

pub async fn build_engine(settings: Arc<Settings>, stats: Arc<Stats>) -> Engine {
    match settings.mode {
        WriteMode::Batch => {
            let (handle, rx) = writer::batch_channel(settings.queue_capacity);
            let settings_bg = Arc::clone(&settings);
            let stats_bg = Arc::clone(&stats);
            tokio::spawn(async move {
                writer::run_batch(settings_bg, stats_bg, rx).await;
            });
            Engine::Batch(handle)
        }
        WriteMode::Single => Engine::Single(Arc::new(writer::SinglePool::new(settings, stats))),
    }
}
