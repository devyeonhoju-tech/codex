import http from 'k6/http';
import { Counter } from 'k6/metrics';

export const accepted = new Counter('accepted');
export const rejected = new Counter('rejected');
export const otherStatus = new Counter('other_status');

const payloadBytes = Number(__ENV.PAYLOAD_BYTES || 512);
const payload = 'x'.repeat(payloadBytes);
const base = __ENV.BASE_URL || 'http://127.0.0.1:8081';

function uuidv4() {
  const vu = __VU.toString(16).padStart(4, '0');
  const iter = __ITER.toString(16).padStart(12, '0');
  const now = Date.now().toString(16).padStart(12, '0');
  const extra = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
  const hex = (vu + iter + now + extra).slice(0, 32).padEnd(32, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function ingest() {
  const body = JSON.stringify({
    id: uuidv4(),
    sourceId: 'device-1',
    timestamp: new Date().toISOString(),
    payload: payload,
  });
  const res = http.post(`${base}/v1/ingest`, body, {
    headers: { 'Content-Type': 'application/json' },
    timeout: '30s',
    tags: { name: 'ingest' },
  });
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
