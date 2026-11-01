use chrono::{DateTime, Utc};
use serde::Deserialize;

pub const MAX_PAYLOAD_UNITS: usize = 1024;
pub const MAX_SOURCE_UNITS: usize = 128;
/// Assumption until the VAN publishes the real maximum for `vantr`.
pub const MAX_VANTR_UNITS: usize = 128;

#[derive(Debug, Clone)]
pub struct IngestEvent {
    pub vantr: String,
    pub source_id: String,
    pub timestamp: DateTime<Utc>,
    pub payload: String,
}

#[derive(Debug, Deserialize)]
struct RawEvent {
    vantr: Option<String>,
    #[serde(rename = "sourceId")]
    source_id: Option<String>,
    timestamp: Option<DateTime<Utc>>,
    payload: Option<String>,
}

pub fn parse_event(bytes: &[u8]) -> Result<IngestEvent, &'static str> {
    let raw: RawEvent = serde_json::from_slice(bytes).map_err(|_| "invalid_json")?;
    let vantr = raw.vantr.ok_or("invalid_vantr")?;
    let vantr = vantr.trim().to_string();
    if vantr.is_empty() || utf16_len(&vantr) > MAX_VANTR_UNITS || vantr.contains('\0') {
        return Err("invalid_vantr");
    }
    let source = raw.source_id.ok_or("invalid_source")?;
    let source = source.trim().to_string();
    if source.is_empty() || utf16_len(&source) > MAX_SOURCE_UNITS || source.contains('\0') {
        return Err("invalid_source");
    }
    let timestamp = raw.timestamp.ok_or("invalid_timestamp")?;
    if timestamp.timestamp() < 0 {
        return Err("invalid_timestamp");
    }
    let payload = raw.payload.ok_or("missing_payload")?;
    if utf16_len(&payload) > MAX_PAYLOAD_UNITS {
        return Err("payload_too_large");
    }
    Ok(IngestEvent {
        vantr,
        source_id: source,
        timestamp,
        payload,
    })
}

pub fn utf16_len(value: &str) -> usize {
    value.encode_utf16().count()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body(payload: &str) -> String {
        format!(
            r#"{{"vantr":"VAN202611010001","sourceId":"device-1","timestamp":"2026-11-01T15:34:00Z","payload":"{payload}"}}"#
        )
    }

    #[test]
    fn accepts_a_small_event() {
        let event = parse_event(body("hello").as_bytes()).unwrap();
        assert_eq!(event.source_id, "device-1");
        assert_eq!(event.payload, "hello");
    }

    #[test]
    fn rejects_a_payload_over_1024_utf16_units() {
        let payload = "a".repeat(1025);
        let err = parse_event(body(&payload).as_bytes()).unwrap_err();
        assert_eq!(err, "payload_too_large");
    }

    #[test]
    fn rejects_an_empty_vantr() {
        let raw = br#"{"vantr":"  ","sourceId":"device-1","timestamp":"2026-11-01T15:34:00Z","payload":"x"}"#;
        assert_eq!(parse_event(raw).unwrap_err(), "invalid_vantr");
    }

    #[test]
    fn counts_emoji_as_two_utf16_units() {
        assert_eq!(utf16_len("a😀"), 3);
    }
}
