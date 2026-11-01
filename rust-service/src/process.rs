//! Deterministic JSON step shared with the .NET service. See `bench/WIRE_FORMAT.md`.

use serde::{Deserialize, Serialize};

pub const MAX_ID_BYTES: usize = 256;
pub const MAX_DATA_BYTES: usize = 2_000_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProcessError {
    InvalidJson,
    InvalidRequest,
}

impl ProcessError {
    pub fn code(self) -> &'static str {
        match self {
            Self::InvalidJson => "invalid_json",
            Self::InvalidRequest => "invalid_request",
        }
    }
}

#[derive(Debug, Deserialize)]
struct RequestDoc {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    data: Option<String>,
    #[serde(default)]
    multiplier: Option<u32>,
}

#[derive(Debug, Serialize)]
struct ResponseDoc {
    id: String,
    checksum: u32,
    length: u32,
    tag: u32,
}

/// FNV-1a 32-bit. Offset basis 2166136261, prime 16777619.
pub fn fnv1a32(bytes: &[u8]) -> u32 {
    let mut hash: u32 = 2_166_136_261;
    for &byte in bytes {
        hash ^= u32::from(byte);
        hash = hash.wrapping_mul(16_777_619);
    }
    hash
}

pub fn process_plaintext(plaintext: &[u8]) -> Result<Vec<u8>, ProcessError> {
    let request: RequestDoc =
        serde_json::from_slice(plaintext).map_err(|_| ProcessError::InvalidJson)?;
    let Some(id) = request.id else {
        return Err(ProcessError::InvalidRequest);
    };
    let Some(data) = request.data else {
        return Err(ProcessError::InvalidRequest);
    };
    let Some(multiplier) = request.multiplier else {
        return Err(ProcessError::InvalidRequest);
    };
    let id_len = id.len();
    if id_len == 0 || id_len > MAX_ID_BYTES {
        return Err(ProcessError::InvalidRequest);
    }
    let data_bytes = data.as_bytes();
    if data_bytes.len() > MAX_DATA_BYTES {
        return Err(ProcessError::InvalidRequest);
    }
    let length = data_bytes.len() as u32;
    let checksum = fnv1a32(data_bytes);
    let tag = checksum ^ multiplier ^ length;
    let response = ResponseDoc {
        id,
        checksum,
        length,
        tag,
    };
    serde_json::to_vec(&response).map_err(|_| ProcessError::InvalidJson)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct VectorFile {
        cases: Vec<VectorCase>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct VectorCase {
        name: String,
        request_json: String,
        response_json: String,
    }

    #[test]
    fn matches_shared_vectors() {
        let file: VectorFile =
            serde_json::from_str(include_str!("../../bench/testdata/process_vectors.json"))
                .unwrap();
        assert!(!file.cases.is_empty());
        for case in file.cases {
            let actual = process_plaintext(case.request_json.as_bytes()).unwrap();
            assert_eq!(
                std::str::from_utf8(&actual).unwrap(),
                case.response_json,
                "{}",
                case.name
            );
        }
    }

    #[test]
    fn rejects_bad_input() {
        assert_eq!(
            process_plaintext(b"not-json").unwrap_err(),
            ProcessError::InvalidJson
        );
        assert_eq!(
            process_plaintext(br#"{"id":"a","multiplier":1}"#).unwrap_err(),
            ProcessError::InvalidRequest
        );
        assert_eq!(
            process_plaintext(br#"{"id":"","data":"x","multiplier":1}"#).unwrap_err(),
            ProcessError::InvalidRequest
        );
        assert_eq!(
            process_plaintext(br#"{"id":"a","data":"x","multiplier":1.5}"#).unwrap_err(),
            ProcessError::InvalidJson
        );
    }

    #[test]
    fn empty_data_offset_basis() {
        assert_eq!(fnv1a32(b""), 2_166_136_261);
    }
}
