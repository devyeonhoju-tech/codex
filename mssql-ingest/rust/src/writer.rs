use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc};
use tokio::sync::{mpsc, Mutex, Semaphore};
use tokio::time::Instant;

use crate::db::{self, Settings, SqlConn, WriteMode};
use crate::event::IngestEvent;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteOutcome {
    Committed,
    Duplicate,
    Rejected,
    Failed,
}

pub struct Pending {
    pub event: IngestEvent,
    pub received_at: DateTime<Utc>,
    pub done: mpsc::Sender<WriteOutcome>,
}

pub struct Stats {
    pub accepted: AtomicU64,
    pub rejected: AtomicU64,
    pub committed: AtomicU64,
    pub duplicates: AtomicU64,
    pub failed: AtomicU64,
    pub batches: AtomicU64,
}

impl Stats {
    pub fn new() -> Self {
        Self {
            accepted: AtomicU64::new(0),
            rejected: AtomicU64::new(0),
            committed: AtomicU64::new(0),
            duplicates: AtomicU64::new(0),
            failed: AtomicU64::new(0),
            batches: AtomicU64::new(0),
        }
    }
}

#[derive(Clone)]
pub struct SubmitHandle {
    tx: mpsc::Sender<Pending>,
    capacity: usize,
}

impl SubmitHandle {
    pub fn queue_depth(&self) -> usize {
        self.capacity.saturating_sub(self.tx.capacity())
    }

    pub fn try_submit(
        &self,
        event: IngestEvent,
        stats: &Stats,
    ) -> Result<mpsc::Receiver<WriteOutcome>, WriteOutcome> {
        let (done, rx) = mpsc::channel(1);
        let pending = Pending {
            event,
            received_at: Utc::now(),
            done,
        };
        match self.tx.try_send(pending) {
            Ok(()) => {
                stats.accepted.fetch_add(1, Ordering::Relaxed);
                Ok(rx)
            }
            Err(mpsc::error::TrySendError::Full(_)) => {
                stats.rejected.fetch_add(1, Ordering::Relaxed);
                Err(WriteOutcome::Rejected)
            }
            Err(mpsc::error::TrySendError::Closed(_)) => {
                stats.rejected.fetch_add(1, Ordering::Relaxed);
                Err(WriteOutcome::Failed)
            }
        }
    }
}

pub fn batch_channel(capacity: usize) -> (SubmitHandle, mpsc::Receiver<Pending>) {
    let (tx, rx) = mpsc::channel(capacity);
    (SubmitHandle { tx, capacity }, rx)
}

pub async fn run_batch(settings: Arc<Settings>, stats: Arc<Stats>, mut rx: mpsc::Receiver<Pending>) {
    let (batch_tx, batch_rx) = mpsc::channel::<Vec<Pending>>(settings.writers.saturating_mul(2).max(1));
    let batch_rx = Arc::new(Mutex::new(batch_rx));
    let mut workers = Vec::with_capacity(settings.writers);
    for _ in 0..settings.writers {
        let settings = Arc::clone(&settings);
        let stats = Arc::clone(&stats);
        let batch_rx = Arc::clone(&batch_rx);
        workers.push(tokio::spawn(async move {
            let mut conn = db::connect(&settings, &settings.database).await.ok();
            loop {
                let batch = {
                    let mut guard = batch_rx.lock().await;
                    guard.recv().await
                };
                let Some(batch) = batch else { break };
                flush_batch(&settings, &stats, &mut conn, batch).await;
            }
        }));
    }

    let batch_size = settings.batch_size;
    let flush = Duration::from_millis(settings.flush_ms);
    let mut closed = false;
    while !closed {
        let Some(first) = rx.recv().await else { break };
        let mut batch = Vec::with_capacity(batch_size);
        batch.push(first);
        let start = Instant::now();
        while batch.len() < batch_size {
            let elapsed = start.elapsed();
            if elapsed >= flush {
                break;
            }
            match tokio::time::timeout(flush.saturating_sub(elapsed), rx.recv()).await {
                Ok(Some(item)) => batch.push(item),
                Ok(None) => {
                    closed = true;
                    break;
                }
                Err(_) => break,
            }
        }
        if batch_tx.send(batch).await.is_err() {
            break;
        }
    }
    drop(batch_tx);
    for worker in workers {
        let _ = worker.await;
    }
}

async fn flush_batch(
    settings: &Settings,
    stats: &Stats,
    conn: &mut Option<SqlConn>,
    batch: Vec<Pending>,
) {
    if conn.is_none() {
        *conn = db::connect(settings, &settings.database).await.ok();
    }
    let outcome = match conn.as_mut() {
        Some(client) => match db::bulk_insert(client, &batch).await {
            Ok(()) => WriteOutcome::Committed,
            Err(err) if db::is_duplicate(&err) => {
                *conn = None;
                WriteOutcome::Duplicate
            }
            Err(err) => {
                eprintln!("batch flush failed rows={} error={err}", batch.len());
                *conn = None;
                WriteOutcome::Failed
            }
        },
        None => WriteOutcome::Failed,
    };
    match outcome {
        WriteOutcome::Committed => {
            stats.batches.fetch_add(1, Ordering::Relaxed);
            stats.committed.fetch_add(batch.len() as u64, Ordering::Relaxed);
        }
        WriteOutcome::Duplicate => {
            stats.duplicates.fetch_add(batch.len() as u64, Ordering::Relaxed);
        }
        WriteOutcome::Failed => {
            stats.failed.fetch_add(batch.len() as u64, Ordering::Relaxed);
        }
        WriteOutcome::Rejected => {}
    }
    for pending in batch {
        let _ = pending.done.try_send(outcome);
    }
}

pub struct SinglePool {
    settings: Arc<Settings>,
    stats: Arc<Stats>,
    permits: Semaphore,
    idle: Mutex<Vec<SqlConn>>,
}

impl SinglePool {
    pub fn new(settings: Arc<Settings>, stats: Arc<Stats>) -> Self {
        let permits = Semaphore::new(settings.max_pool_size);
        Self {
            settings,
            stats,
            permits,
            idle: Mutex::new(Vec::new()),
        }
    }

    pub fn queue_depth(&self) -> usize {
        self.settings
            .max_pool_size
            .saturating_sub(self.permits.available_permits())
    }

    pub async fn insert(&self, event: IngestEvent) -> WriteOutcome {
        let Ok(_permit) = self.permits.try_acquire() else {
            self.stats.rejected.fetch_add(1, Ordering::Relaxed);
            return WriteOutcome::Rejected;
        };
        self.stats.accepted.fetch_add(1, Ordering::Relaxed);
        let mut conn = self.idle.lock().await.pop();
        if conn.is_none() {
            conn = db::connect(&self.settings, &self.settings.database).await.ok();
        }
        let Some(client) = conn.as_mut() else {
            self.stats.failed.fetch_add(1, Ordering::Relaxed);
            return WriteOutcome::Failed;
        };
        let received_at = Utc::now();
        match db::insert_one(client, &event, received_at).await {
            Ok(()) => {
                self.stats.committed.fetch_add(1, Ordering::Relaxed);
                self.idle.lock().await.push(conn.expect("connection still present"));
                WriteOutcome::Committed
            }
            Err(err) if db::is_duplicate(&err) => {
                self.stats.duplicates.fetch_add(1, Ordering::Relaxed);
                WriteOutcome::Duplicate
            }
            Err(err) => {
                eprintln!("single insert failed error={err}");
                self.stats.failed.fetch_add(1, Ordering::Relaxed);
                WriteOutcome::Failed
            }
        }
    }
}

pub fn mode_name(mode: WriteMode) -> &'static str {
    match mode {
        WriteMode::Batch => "batch",
        WriteMode::Single => "single",
    }
}
