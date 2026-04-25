import { Queue } from 'bullmq';
import Redis from 'ioredis';

const connection = new Redis((globalThis as any).process?.env?.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

export const ingestQueue = new Queue('ingest-jobs', { connection });
