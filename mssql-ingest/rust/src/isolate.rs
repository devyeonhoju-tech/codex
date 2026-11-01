use std::future::Future;
use std::pin::Pin;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RowResult {
    Committed,
    Failed,
}

/// Same rules as the .NET BatchIsolator. `insert_range` must not fail merely
/// because a vantr is already committed. A data error splits the range. A
/// single failed row is committed when `is_committed` says the vantr is already
/// stored. Fatal errors fail the range so a dead database is not probed row by row.
#[cfg_attr(not(test), allow(dead_code))]
pub async fn isolate<E, I, C, FutI, FutC>(
    count: usize,
    insert_range: I,
    is_committed: C,
    is_fatal: impl Fn(&E) -> bool,
) -> Vec<RowResult>
where
    I: Fn(usize, usize) -> FutI,
    FutI: Future<Output = Result<(), E>>,
    C: Fn(usize) -> FutC,
    FutC: Future<Output = bool>,
{
    let mut results = vec![RowResult::Failed; count];
    if count == 0 {
        return results;
    }
    let fatal = is_fatal;
    isolate_range(0, count, &mut results, &insert_range, &is_committed, &fatal).await;
    results
}

#[cfg_attr(not(test), allow(dead_code))]
fn isolate_range<'a, E, I, C, FutI, FutC>(
    start: usize,
    count: usize,
    results: &'a mut [RowResult],
    insert_range: &'a I,
    is_committed: &'a C,
    is_fatal: &'a impl Fn(&E) -> bool,
) -> Pin<Box<dyn Future<Output = ()> + 'a>>
where
    I: Fn(usize, usize) -> FutI,
    FutI: Future<Output = Result<(), E>>,
    C: Fn(usize) -> FutC,
    FutC: Future<Output = bool>,
{
    Box::pin(async move {
        match insert_range(start, count).await {
            Ok(()) => {
                for slot in &mut results[start..start + count] {
                    *slot = RowResult::Committed;
                }
            }
            Err(err) if is_fatal(&err) => {}
            Err(_) if count == 1 => {
                if is_committed(start).await {
                    results[start] = RowResult::Committed;
                }
            }
            Err(_) => {
                let mid = count / 2;
                isolate_range(start, mid, results, insert_range, is_committed, is_fatal).await;
                isolate_range(
                    start + mid,
                    count - mid,
                    results,
                    insert_range,
                    is_committed,
                    is_fatal,
                )
                .await;
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[tokio::test]
    async fn batch_keeps_good_rows_when_it_contains_a_duplicate_and_an_invalid_row() {
        let stored = Mutex::new(vec!["dup".to_string()]);
        let keys = ["ok", "dup", "bad"];
        let results = isolate(
            keys.len(),
            |start, count| {
                let slice = keys[start..start + count].to_vec();
                let stored = &stored;
                async move {
                    if slice.contains(&"bad") {
                        return Err(());
                    }
                    let mut guard = stored.lock().expect("store lock");
                    for key in slice {
                        if !guard.iter().any(|existing| existing == key) {
                            guard.push(key.to_string());
                        }
                    }
                    Ok(())
                }
            },
            |index| {
                let stored = &stored;
                async move {
                    let guard = stored.lock().expect("store lock");
                    guard.iter().any(|existing| existing == keys[index])
                }
            },
            |_: &()| false,
        )
        .await;

        assert_eq!(
            results,
            vec![RowResult::Committed, RowResult::Committed, RowResult::Failed]
        );
        let guard = stored.lock().expect("store lock");
        assert!(guard.iter().any(|key| key == "ok"));
        assert!(guard.iter().any(|key| key == "dup"));
        assert!(!guard.iter().any(|key| key == "bad"));
        assert_eq!(guard.iter().filter(|key| key.as_str() == "dup").count(), 1);
    }
}
