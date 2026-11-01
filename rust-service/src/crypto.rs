//! AES-256-GCM with the wire layout in `bench/WIRE_FORMAT.md`.
//!
//! `aes-gcm` (RustCrypto) selects AES-NI at runtime on x86_64. The cipher is
//! cheap to construct and `encrypt`/`decrypt` take `&self`, so one instance is
//! shared across Tokio worker threads.

use aes_gcm::aead::rand_core::RngCore;
use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Nonce};

pub const KEY_LEN: usize = 32;
pub const NONCE_LEN: usize = 12;
pub const TAG_LEN: usize = 16;
pub const OVERHEAD: usize = NONCE_LEN + TAG_LEN;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CryptoError {
    Key,
    MissingNonce,
    Truncated,
    Decrypt,
    Encrypt,
}

pub fn parse_key(hex_str: &str) -> Result<[u8; KEY_LEN], CryptoError> {
    let s = hex_str.trim();
    let bytes = decode_hex(s).map_err(|_| CryptoError::Key)?;
    bytes.try_into().map_err(|_| CryptoError::Key)
}

pub fn cipher(key: &[u8; KEY_LEN]) -> Aes256Gcm {
    Aes256Gcm::new_from_slice(key).expect("32-byte AES-256 key")
}

mod aes_ni_probe {
    #![allow(deprecated)]
    cpufeatures::new!(aes_feature, "aes");

    pub fn get() -> bool {
        aes_feature::get()
    }
}

pub fn aes_ni_available() -> bool {
    aes_ni_probe::get()
}

pub fn seal(cipher: &Aes256Gcm, plaintext: &[u8]) -> Result<Vec<u8>, CryptoError> {
    let mut nonce = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce);
    seal_with_nonce(cipher, &nonce, plaintext)
}

pub fn seal_with_nonce(
    cipher: &Aes256Gcm,
    nonce: &[u8; NONCE_LEN],
    plaintext: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(nonce), plaintext)
        .map_err(|_| CryptoError::Encrypt)?;
    let mut out = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    out.extend_from_slice(nonce);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

pub fn open(cipher: &Aes256Gcm, wire: &[u8]) -> Result<Vec<u8>, CryptoError> {
    // The whole body is one frame. A short body is not a plaintext request.
    if wire.len() < NONCE_LEN {
        return Err(CryptoError::MissingNonce);
    }
    if wire.len() < OVERHEAD {
        return Err(CryptoError::Truncated);
    }
    let (nonce, ciphertext_and_tag) = wire.split_at(NONCE_LEN);
    cipher
        .decrypt(Nonce::from_slice(nonce), ciphertext_and_tag)
        .map_err(|_| CryptoError::Decrypt)
}

pub fn decode_hex(s: &str) -> Result<Vec<u8>, ()> {
    if s.len() % 2 != 0 {
        return Err(());
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).map_err(|_| ()))
        .collect()
}

pub fn encode_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct KatFile {
        key_hex: String,
        cases: Vec<KatCase>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct KatCase {
        name: String,
        nonce_hex: String,
        plaintext_hex: String,
        ciphertext_hex: String,
        tag_hex: String,
    }

    fn kat() -> (Aes256Gcm, KatFile) {
        let file: KatFile =
            serde_json::from_str(include_str!("../../bench/testdata/aes_gcm_kat.json")).unwrap();
        let key = parse_key(&file.key_hex).unwrap();
        (cipher(&key), file)
    }

    #[test]
    fn known_answers_match_python_cryptography() {
        let (cipher, file) = kat();
        for case in file.cases {
            let nonce_vec = decode_hex(&case.nonce_hex).unwrap();
            let nonce: [u8; NONCE_LEN] = nonce_vec.try_into().unwrap();
            let plaintext = decode_hex(&case.plaintext_hex).unwrap();
            let wire = seal_with_nonce(&cipher, &nonce, &plaintext).unwrap();
            let expected_ct = decode_hex(&case.ciphertext_hex).unwrap();
            let expected_tag = decode_hex(&case.tag_hex).unwrap();
            assert_eq!(&wire[..NONCE_LEN], &nonce, "{}", case.name);
            assert_eq!(
                &wire[NONCE_LEN..wire.len() - TAG_LEN],
                expected_ct,
                "{}",
                case.name
            );
            assert_eq!(&wire[wire.len() - TAG_LEN..], expected_tag, "{}", case.name);
            assert_eq!(open(&cipher, &wire).unwrap(), plaintext, "{}", case.name);
        }
    }

    #[test]
    fn random_nonce_roundtrip_and_tamper() {
        let key = parse_key(include_str!("../../bench/testdata/bench_key.hex")).unwrap();
        let cipher = cipher(&key);
        let wire = seal(&cipher, b"hello").unwrap();
        assert_eq!(open(&cipher, &wire).unwrap(), b"hello");
        let mut bad = wire.clone();
        let last = bad.len() - 1;
        bad[last] ^= 0x01;
        assert_eq!(open(&cipher, &bad), Err(CryptoError::Decrypt));
        assert_eq!(open(&cipher, &[]), Err(CryptoError::MissingNonce));
        assert_eq!(open(&cipher, &wire[..10]), Err(CryptoError::MissingNonce));
        assert_eq!(open(&cipher, &wire[..20]), Err(CryptoError::Truncated));
    }

    #[test]
    fn rejects_short_key() {
        assert_eq!(parse_key("abcd"), Err(CryptoError::Key));
    }
}
