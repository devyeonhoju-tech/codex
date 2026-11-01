import { ingest, handleSummary } from './client.js';

const preAllocated = Number(__ENV.PRE_ALLOCATED_VUS || 600);
const maxVUs = Number(__ENV.MAX_VUS || 3000);

export const options = {
  scenarios: {
    step: {
      executor: 'ramping-arrival-rate',
      exec: 'ingest',
      startRate: 200,
      timeUnit: '1s',
      preAllocatedVUs: preAllocated,
      maxVUs: maxVUs,
      stages: [
        { target: 200, duration: '15s' },
        { target: 500, duration: '15s' },
        { target: 1000, duration: '20s' },
        { target: 1500, duration: '20s' },
        { target: 2000, duration: '20s' },
        { target: 3000, duration: '20s' },
      ],
      tags: { phase: 'step' },
      gracefulStop: '30s',
    },
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export { ingest, handleSummary };
