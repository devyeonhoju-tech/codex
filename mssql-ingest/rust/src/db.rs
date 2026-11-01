use std::time::Duration;

use chrono::{DateTime, Utc};
use tiberius::{AuthMethod, Client, Config, IntoRow, Query};
use tokio::net::TcpStream;
use tokio_util::compat::{Compat, TokioAsyncWriteCompatExt};

use crate::event::IngestEvent;
use crate::writer::Pending;

pub type SqlConn = Client<Compat<TcpStream>>;

pub const THROWAWAY_PASSWORD: &str = "Ingest_Local_Dev1!";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WriteMode {
    Batch,
    Single,
}

#[derive(Clone, Debug)]
pub struct Settings {
    pub host: String,
    pub port: u16,
    pub database: String,
    pub user: String,
    pub password: String,
    pub password_is_throwaway: bool,
    pub mode: WriteMode,
    pub batch_size: usize,
    pub flush_ms: u64,
    pub writers: usize,
    pub queue_capacity: usize,
    pub max_pool_size: usize,
    pub bind: String,
    pub http_port: u16,
    pub worker_threads: usize,
}

impl Settings {
    pub fn from_env() -> Result<Self, String> {
        let password = env_string("MSSQL_PASSWORD", THROWAWAY_PASSWORD);
        let mode = match env_string("INGEST_WRITE_MODE", "batch").to_ascii_lowercase().as_str() {
            "batch" => WriteMode::Batch,
            "single" => WriteMode::Single,
            other => return Err(format!("INGEST_WRITE_MODE must be batch or single, got {other}")),
        };
        Ok(Self {
            host: env_string("MSSQL_HOST", "127.0.0.1"),
            port: env_u16("MSSQL_PORT", 1433)?,
            database: env_string("MSSQL_DATABASE", "ingest"),
            user: env_string("MSSQL_USER", "sa"),
            password: password.clone(),
            password_is_throwaway: password == THROWAWAY_PASSWORD,
            mode,
            batch_size: env_usize("INGEST_BATCH_SIZE", 128)?.clamp(1, 1000),
            flush_ms: env_u64("INGEST_FLUSH_MS", 10)?.clamp(1, 5000),
            writers: env_usize("INGEST_WRITERS", 2)?.clamp(1, 16),
            queue_capacity: env_usize("INGEST_QUEUE_CAPACITY", 16384)?.clamp(1, 1_000_000),
            max_pool_size: env_usize("INGEST_MAX_POOL_SIZE", 128)?.clamp(1, 512),
            bind: env_string("BIND", "127.0.0.1"),
            http_port: env_u16("PORT", 8080)?,
            worker_threads: env_usize("TOKIO_WORKER_THREADS", default_workers())?,
        })
    }
}

fn default_workers() -> usize {
    std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1)
}

fn env_string(name: &str, fallback: &str) -> String {
    match std::env::var(name) {
        Ok(value) if !value.trim().is_empty() => value.trim().to_string(),
        _ => fallback.to_string(),
    }
}

fn env_u16(name: &str, fallback: u16) -> Result<u16, String> {
    match std::env::var(name) {
        Ok(value) if !value.trim().is_empty() => value
            .trim()
            .parse()
            .map_err(|_| format!("{name} must be an integer")),
        _ => Ok(fallback),
    }
}

fn env_u64(name: &str, fallback: u64) -> Result<u64, String> {
    match std::env::var(name) {
        Ok(value) if !value.trim().is_empty() => value
            .trim()
            .parse()
            .map_err(|_| format!("{name} must be an integer")),
        _ => Ok(fallback),
    }
}

fn env_usize(name: &str, fallback: usize) -> Result<usize, String> {
    match std::env::var(name) {
        Ok(value) if !value.trim().is_empty() => value
            .trim()
            .parse()
            .map_err(|_| format!("{name} must be an integer")),
        _ => Ok(fallback),
    }
}

pub async fn connect(settings: &Settings, database: &str) -> Result<SqlConn, tiberius::error::Error> {
    let mut config = Config::new();
    config.host(&settings.host);
    config.port(settings.port);
    config.database(database);
    config.authentication(AuthMethod::sql_server(&settings.user, &settings.password));
    // The Developer container presents a self-signed certificate.
    config.trust_cert();
    let tcp = TcpStream::connect(config.get_addr()).await?;
    tcp.set_nodelay(true)?;
    Client::connect(config, tcp.compat_write()).await
}

pub async fn apply_schema(settings: &Settings) -> Result<(), String> {
    let database_sql = include_str!("../../sql/001_database.sql");
    let table_sql = include_str!("../../sql/002_events.sql");
    let mut last = String::from("schema apply failed");
    for _ in 0..30 {
        match apply_once(settings, database_sql, table_sql).await {
            Ok(()) => return Ok(()),
            Err(err) => {
                last = err;
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        }
    }
    Err(last)
}

async fn apply_once(settings: &Settings, database_sql: &str, table_sql: &str) -> Result<(), String> {
    let mut master = connect(settings, "master").await.map_err(|err| err.to_string())?;
    for batch in split_batches(database_sql) {
        let stream = master.simple_query(batch).await.map_err(|err| err.to_string())?;
        stream.into_results().await.map_err(|err| err.to_string())?;
    }
    drop(master);
    let mut db = connect(settings, &settings.database).await.map_err(|err| err.to_string())?;
    for batch in split_batches(table_sql) {
        let stream = db.simple_query(batch).await.map_err(|err| err.to_string())?;
        stream.into_results().await.map_err(|err| err.to_string())?;
    }
    Ok(())
}

pub fn split_batches(sql: &str) -> Vec<String> {
    let mut batches = Vec::new();
    let mut current = String::new();
    for line in sql.lines() {
        if line.trim().eq_ignore_ascii_case("GO") {
            push_batch(&mut batches, &mut current);
        } else {
            current.push_str(line);
            current.push('\n');
        }
    }
    push_batch(&mut batches, &mut current);
    batches
}

fn push_batch(batches: &mut Vec<String>, current: &mut String) {
    let batch = current.trim().to_string();
    if !batch.is_empty() {
        batches.push(batch);
    }
    current.clear();
}

pub async fn count_rows(settings: &Settings) -> Result<(i64, i64), String> {
    let mut client = connect(settings, &settings.database).await.map_err(|err| err.to_string())?;
    let stream = client
        .simple_query(
            "SELECT COUNT_BIG(*) AS row_count, COUNT_BIG(DISTINCT id) AS distinct_ids FROM dbo.ingest_events",
        )
        .await
        .map_err(|err| err.to_string())?;
    let row = stream
        .into_row()
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "count returned no row".to_string())?;
    let rows: i64 = row
        .try_get(0)
        .map_err(|err| err.to_string())?
        .unwrap_or(0);
    let distinct_ids: i64 = row
        .try_get(1)
        .map_err(|err| err.to_string())?
        .unwrap_or(0);
    Ok((rows, distinct_ids))
}

pub async fn truncate(settings: &Settings) -> Result<(), String> {
    let mut client = connect(settings, &settings.database).await.map_err(|err| err.to_string())?;
    let stream = client
        .simple_query("TRUNCATE TABLE dbo.ingest_events")
        .await
        .map_err(|err| err.to_string())?;
    stream.into_results().await.map_err(|err| err.to_string())?;
    Ok(())
}

pub async fn info(settings: &Settings) -> Result<String, String> {
    let mut client = connect(settings, "master").await.map_err(|err| err.to_string())?;
    let mut query = Query::new(
        "SELECT d.recovery_model_desc, d.delayed_durability_desc, d.is_read_committed_snapshot_on, \
         CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128)), \
         CAST(SERVERPROPERTY('Edition') AS nvarchar(128)) \
         FROM sys.databases AS d WHERE d.name = @P1",
    );
    query.bind(settings.database.as_str());
    let row = query
        .query(&mut client)
        .await
        .map_err(|err| err.to_string())?
        .into_row()
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "ingest database is missing".to_string())?;
    let recovery: &str = row.try_get(0).map_err(|err| err.to_string())?.unwrap_or("");
    let delayed: &str = row.try_get(1).map_err(|err| err.to_string())?.unwrap_or("");
    let snapshot: bool = row.try_get(2).map_err(|err| err.to_string())?.unwrap_or(false);
    let version: &str = row.try_get(3).map_err(|err| err.to_string())?.unwrap_or("");
    let edition: &str = row.try_get(4).map_err(|err| err.to_string())?.unwrap_or("");
    Ok(format!(
        "recovery_model={recovery}\ndelayed_durability={delayed}\nread_committed_snapshot={snapshot}\nproduct_version={version}\nedition={edition}"
    ))
}

pub async fn bulk_insert(client: &mut SqlConn, rows: &[Pending]) -> Result<(), tiberius::error::Error> {
    let columns = [
        "id",
        "source_id",
        "event_timestamp",
        "payload",
        "received_at",
    ];
    let mut request = client
        .bulk_insert_columns("dbo.ingest_events", &columns)
        .await?;
    for row in rows {
        let token = (
            row.event.id,
            row.event.source_id.as_str(),
            row.event.timestamp,
            row.event.payload.as_str(),
            row.received_at,
        )
            .into_row();
        request.send(token).await?;
    }
    request.finalize().await?;
    Ok(())
}

pub async fn insert_one(
    client: &mut SqlConn,
    event: &IngestEvent,
    received_at: DateTime<Utc>,
) -> Result<(), tiberius::error::Error> {
    let mut query = Query::new(
        "INSERT INTO dbo.ingest_events (id, source_id, event_timestamp, payload, received_at) \
         VALUES (@P1, @P2, @P3, @P4, @P5)",
    );
    query.bind(event.id);
    query.bind(event.source_id.as_str());
    query.bind(event.timestamp);
    query.bind(event.payload.as_str());
    query.bind(received_at);
    query.execute(client).await?;
    Ok(())
}

pub fn is_duplicate(err: &tiberius::error::Error) -> bool {
    matches!(err.code(), Some(2627 | 2601))
}

#[cfg(test)]
mod tests {
    use super::split_batches;

    #[test]
    fn go_splits_batches() {
        let batches = split_batches("SELECT 1\nGO\nSELECT 2\n");
        assert_eq!(batches, vec!["SELECT 1".to_string(), "SELECT 2".to_string()]);
    }
}
