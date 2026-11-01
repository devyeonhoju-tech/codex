//! Five outbound REST calls. See `bench/WIRE_FORMAT.md`.

use std::time::Duration;

use crate::process::DownstreamReply;

#[derive(Clone)]
pub struct DownstreamClient {
    http: reqwest::Client,
    urls: Vec<String>,
    sequential: bool,
    timeout: Duration,
}

impl DownstreamClient {
    pub fn new(urls: Vec<String>, sequential: bool, timeout: Duration) -> Result<Self, String> {
        if urls.len() != 5 {
            return Err(format!(
                "BENCH_DOWNSTREAM_URLS must list exactly 5 endpoints, got {}",
                urls.len()
            ));
        }
        let http = reqwest::Client::builder()
            .pool_idle_timeout(Duration::from_secs(30))
            .pool_max_idle_per_host(512)
            .tcp_nodelay(true)
            .connect_timeout(Duration::from_secs(2))
            .build()
            .map_err(|err| err.to_string())?;
        Ok(Self {
            http,
            urls,
            sequential,
            timeout,
        })
    }

    pub async fn call_all(&self, body: Vec<u8>) -> Result<Vec<DownstreamReply>, ()> {
        if self.sequential {
            let mut out = Vec::with_capacity(5);
            for url in &self.urls {
                out.push(one(&self.http, url, body.clone(), self.timeout).await?);
            }
            return Ok(out);
        }
        let (a, b, c, d, e) = tokio::join!(
            one(&self.http, &self.urls[0], body.clone(), self.timeout),
            one(&self.http, &self.urls[1], body.clone(), self.timeout),
            one(&self.http, &self.urls[2], body.clone(), self.timeout),
            one(&self.http, &self.urls[3], body.clone(), self.timeout),
            one(&self.http, &self.urls[4], body, self.timeout),
        );
        Ok(vec![a?, b?, c?, d?, e?])
    }
}

async fn one(
    http: &reqwest::Client,
    url: &str,
    body: Vec<u8>,
    timeout: Duration,
) -> Result<DownstreamReply, ()> {
    let name = endpoint_name(url);
    let response = tokio::time::timeout(
        timeout,
        http.post(url)
            .header("content-type", "application/json")
            .body(body)
            .send(),
    )
    .await
    .map_err(|_| ())?
    .map_err(|_| ())?;
    let status = response.status();
    if !status.is_success() {
        return Err(());
    }
    let text = response.text().await.map_err(|_| ())?;
    Ok(DownstreamReply {
        name,
        status: status.as_u16(),
        body: text,
    })
}

pub fn endpoint_name(url: &str) -> String {
    url.trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or("")
        .to_string()
}
