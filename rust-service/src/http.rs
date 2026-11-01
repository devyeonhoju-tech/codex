//! Axum HTTP surface. Per-request logging is intentionally absent so it does
//! not dominate a throughput run.

use std::sync::Arc;

use aes_gcm::Aes256Gcm;
use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Router;

use crate::crypto::{self, CryptoError};
use crate::process::{self, ProcessError};

pub const MAX_BODY: usize = 8 * 1024 * 1024;

#[derive(Clone)]
pub struct AppState {
    cipher: Arc<Aes256Gcm>,
}

pub fn router(key: &[u8; crypto::KEY_LEN]) -> Router {
    let state = AppState {
        cipher: Arc::new(crypto::cipher(key)),
    };
    Router::new()
        .route("/health", get(health))
        .route("/v1/process", post(process_request))
        .layer(DefaultBodyLimit::max(MAX_BODY))
        .with_state(state)
}

async fn health() -> &'static str {
    "ok"
}

async fn process_request(State(state): State<AppState>, body: Bytes) -> Response {
    if body.len() > MAX_BODY {
        return error(StatusCode::PAYLOAD_TOO_LARGE, "body_too_large");
    }
    let plaintext = match crypto::open(&state.cipher, &body) {
        Ok(plaintext) => plaintext,
        Err(CryptoError::MissingNonce) => return error(StatusCode::BAD_REQUEST, "missing_nonce"),
        Err(CryptoError::Truncated) => return error(StatusCode::BAD_REQUEST, "truncated_message"),
        Err(_) => return error(StatusCode::BAD_REQUEST, "decrypt_failed"),
    };
    let response_plain = match process::process_plaintext(&plaintext) {
        Ok(body) => body,
        Err(ProcessError::InvalidJson) => return error(StatusCode::BAD_REQUEST, "invalid_json"),
        Err(ProcessError::InvalidRequest) => {
            return error(StatusCode::BAD_REQUEST, "invalid_request")
        }
    };
    match crypto::seal(&state.cipher, &response_plain) {
        Ok(wire) => (
            StatusCode::OK,
            [(header::CONTENT_TYPE, "application/octet-stream")],
            wire,
        )
            .into_response(),
        Err(_) => error(StatusCode::INTERNAL_SERVER_ERROR, "encrypt_failed"),
    }
}

fn error(status: StatusCode, code: &'static str) -> Response {
    let body = format!(r#"{{"error":"{code}"}}"#);
    (status, [(header::CONTENT_TYPE, "application/json")], body).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request;
    use tower::ServiceExt;

    use crate::crypto::{self, parse_key};

    fn key() -> [u8; 32] {
        parse_key(include_str!("../../bench/testdata/bench_key.hex")).unwrap()
    }

    async fn call(app: Router, body: Vec<u8>) -> (StatusCode, String, Vec<u8>) {
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/process")
                    .header("content-type", "application/octet-stream")
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = response.status();
        let content_type = response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();
        let bytes = axum::body::to_bytes(response.into_body(), MAX_BODY)
            .await
            .unwrap()
            .to_vec();
        (status, content_type, bytes)
    }

    #[tokio::test]
    async fn round_trip_matches_vector() {
        let key = key();
        let app = router(&key);
        let cipher = crypto::cipher(&key);
        let request = br#"{"id":"hello","data":"hello","multiplier":3}"#;
        let wire = crypto::seal(&cipher, request).unwrap();
        let (status, content_type, body) = call(app, wire).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(content_type, "application/octet-stream");
        let plain = crypto::open(&cipher, &body).unwrap();
        let expected = crate::process::process_plaintext(request).unwrap();
        assert_eq!(plain, expected);
        assert!(plain.len() > request.len());
    }

    #[tokio::test]
    async fn rejects_plaintext_and_incomplete_frames() {
        let app = router(&key());
        let plaintext = br#"{"id":"hello","data":"hello","multiplier":3}"#;
        let (status, _, body) = call(app.clone(), plaintext.to_vec()).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body, br#"{"error":"decrypt_failed"}"#);

        let (status, _, body) = call(app.clone(), vec![0; 11]).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body, br#"{"error":"missing_nonce"}"#);

        let (status, _, body) = call(app.clone(), vec![0; 20]).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body, br#"{"error":"truncated_message"}"#);

        let other = crypto::cipher(&[0x11; 32]);
        let wire = crypto::seal(&other, plaintext).unwrap();
        let (status, _, body) = call(app, wire).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body, br#"{"error":"decrypt_failed"}"#);
    }

    #[tokio::test]
    async fn tamper_is_decrypt_failed() {
        let key = key();
        let app = router(&key);
        let cipher = crypto::cipher(&key);
        let mut wire =
            crypto::seal(&cipher, br#"{"id":"hello","data":"hello","multiplier":3}"#).unwrap();
        let last = wire.len() - 1;
        wire[last] ^= 0xff;
        let (status, content_type, body) = call(app, wire).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(content_type, "application/json");
        assert_eq!(body, br#"{"error":"decrypt_failed"}"#);
    }

    #[tokio::test]
    async fn health_ok() {
        let app = router(&key());
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), 16)
            .await
            .unwrap();
        assert_eq!(&body[..], b"ok");
    }
}
