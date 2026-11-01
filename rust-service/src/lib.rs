//! AES-256-GCM request/response service. See `bench/WIRE_FORMAT.md`.

pub mod crypto;
pub mod http;
pub mod process;

pub use crypto::{
    aes_ni_available, open, parse_key, seal, seal_with_nonce, CryptoError, KEY_LEN, NONCE_LEN,
    TAG_LEN,
};
pub use http::{router, MAX_BODY};
pub use process::{process_plaintext, ProcessError};
