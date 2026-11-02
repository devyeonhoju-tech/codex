import http from 'k6/http';
import { Counter } from 'k6/metrics';

export const accepted = new Counter('accepted');
export const rejected = new Counter('rejected');
export const otherStatus = new Counter('other_status');

const payloadBytes = Number(__ENV.PAYLOAD_BYTES || 512);
const payload = 'x'.repeat(payloadBytes);
const base = __ENV.BASE_URL || 'http://127.0.0.1:8081';
const resendRatio = Number(__ENV.RESEND_RATIO || 0);
const retryAttempts = Number(__ENV.RETRY_ATTEMPTS || 0);
const timeout = __ENV.HTTP_TIMEOUT || '30s';

let previousVantr = '';

function newVantr() {
  const vu = __VU.toString(16).padStart(4, '0');
  const iter = __ITER.toString(16).padStart(12, '0');
  const now = Date.now().toString(16).padStart(12, '0');
  const extra = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
  return `V${vu}${iter}${now}${extra}`.slice(0, 128);
}

function chooseVantr() {
  if (previousVantr && Math.random() < resendRatio) {
    return previousVantr;
  }
  previousVantr = newVantr();
  return previousVantr;
}

function post(vantr) {
  const body = JSON.stringify({
    vantr: vantr,
    sourceId: 'van-terminal-1',
    timestamp: new Date().toISOString(),
    payload: payload,
  });
  return http.post(`${base}/v1/ingest`, body, {
    headers: { 'Content-Type': 'application/json' },
    timeout: timeout,
    tags: { name: 'ingest' },
  });
}

export function ingest() {
  const vantr = chooseVantr();
  let res = post(vantr);
  let attempt = 0;
  while (res.status !== 202 && attempt < retryAttempts) {
    attempt += 1;
    res = post(vantr);
  }
  if (res.status === 202) {
    accepted.add(1);
  } else if (res.status === 429 || res.status === 503) {
    rejected.add(1);
  } else {
    otherStatus.add(1);
  }
}

export function handleSummary(data) {
  const path = __ENV.SUMMARY_PATH || 'summary.json';
  return { [path]: JSON.stringify(data) };
}
