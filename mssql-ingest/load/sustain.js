import { ingest, handleSummary } from './client.js';

const rate = Number(__ENV.RATE || 1000);
const duration = __ENV.DURATION || '60s';
const warmup = __ENV.WARMUP || '15s';
const warmupRate = Number(__ENV.WARMUP_RATE || Math.min(200, rate));
const preAllocated = Number(__ENV.PRE_ALLOCATED_VUS || 400);
const maxVUs = Number(__ENV.MAX_VUS || 2000);

export const options = {
  scenarios: {
    warmup: {
      executor: 'constant-arrival-rate',
      exec: 'ingest',
      rate: warmupRate,
      timeUnit: '1s',
      duration: warmup,
      preAllocatedVUs: Math.min(preAllocated, 100),
      maxVUs: maxVUs,
      tags: { phase: 'warmup' },
      gracefulStop: '30s',
    },
    sustain: {
      executor: 'constant-arrival-rate',
      exec: 'ingest',
      rate: rate,
      timeUnit: '1s',
      duration: duration,
      preAllocatedVUs: preAllocated,
      maxVUs: maxVUs,
      startTime: warmup,
      tags: { phase: 'sustain' },
      gracefulStop: '30s',
    },
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export { ingest, handleSummary };
