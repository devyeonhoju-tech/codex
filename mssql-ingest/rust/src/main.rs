use std::net::SocketAddr;
use std::sync::Arc;

use axum::serve::ListenerExt;
use mssql_ingest::{build_engine, listen_line, router, AppState, Settings, Stats};

fn main() {
    let settings = match Settings::from_env() {
        Ok(settings) => settings,
        Err(err) => {
            eprintln!("{err}");
            std::process::exit(2);
        }
    };
    let worker_threads = settings.worker_threads.max(1);
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(worker_threads)
        .enable_all()
        .build()
        .expect("tokio runtime");
    if let Err(err) = runtime.block_on(run(settings)) {
        eprintln!("{err}");
        std::process::exit(1);
    }
}

async fn run(settings: Settings) -> Result<(), String> {
    let command = std::env::args().nth(1);
    match command.as_deref() {
        Some("count") => {
            mssql_ingest_schema(&settings).await?;
            let (rows, distinct_ids) = mssql_ingest::count_rows(&settings).await?;
            println!("rows={rows}\ndistinct_ids={distinct_ids}");
            Ok(())
        }
        Some("truncate") => {
            mssql_ingest_schema(&settings).await?;
            mssql_ingest::truncate(&settings).await?;
            println!("truncated");
            Ok(())
        }
        Some("info") => {
            mssql_ingest_schema(&settings).await?;
            println!("{}", mssql_ingest::info(&settings).await?);
            Ok(())
        }
        Some("serve") | None => serve(settings).await,
        Some(other) => Err(format!("unknown command {other}")),
    }
}

async fn mssql_ingest_schema(settings: &Settings) -> Result<(), String> {
    mssql_ingest::apply_schema(settings).await
}

async fn serve(settings: Settings) -> Result<(), String> {
    mssql_ingest::apply_schema(&settings).await?;
    let settings = Arc::new(settings);
    let stats = Arc::new(Stats::new());
    let engine = build_engine(Arc::clone(&settings), Arc::clone(&stats)).await;
    let state = AppState {
        settings: Arc::clone(&settings),
        stats,
        engine,
    };
    let addr: SocketAddr = format!("{}:{}", settings.bind, settings.http_port)
        .parse()
        .map_err(|_| "invalid BIND/PORT".to_string())?;
    eprintln!("{}", listen_line(&settings, std::process::id()));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|err| format!("bind {addr} failed: {err}"))?
        .tap_io(|stream| {
            let _ = stream.set_nodelay(true);
        });
    axum::serve(listener, router(state))
        .await
        .map_err(|err| format!("server error: {err}"))
}

// Re-export the maintenance functions through the crate root in lib.rs.
// The calls above use mssql_ingest::count_rows, which must be public.
