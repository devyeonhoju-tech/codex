//! AES-256-GCM request/response service. See `bench/WIRE_FORMAT.md`.

pub mod crypto;
pub mod downstream;
pub mod http;
pub mod process;

pub use crypto::{
    aes_ni_available, open, parse_key, seal, seal_with_nonce, CryptoError, KEY_LEN, NONCE_LEN,
    TAG_LEN,
};
pub use http::{router, router_with, MAX_BODY};
pub use process::{
    mock_downstream_body, process_plaintext, process_with_downstream, DownstreamReply, ProcessError,
};
