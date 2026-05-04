import path from 'path';
import dotenv from 'dotenv';
import Bull from 'bull';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  throw new Error('REDIS_URL is required to clean Bull jobs');
}
const redisUrlRequired: string = redisUrl;

const defaultQueues = ['batch-call', 'csv-import', 'batch-call-sync', 'campaign'];
const queueNames = (process.env.BULL_CLEAN_QUEUES || '')
  .split(',')
  .map((q) => q.trim())
  .filter(Boolean);

const selectedQueues = queueNames.length > 0 ? queueNames : defaultQueues;
const graceDays = Number(process.env.BULL_CLEAN_GRACE_DAYS || 5);
const graceMs = Math.max(0, graceDays) * 24 * 60 * 60 * 1000;

async function cleanQueue(queueName: string): Promise<void> {
  const queue = new Bull(queueName, redisUrlRequired);
  try {
    const completedDeleted = await queue.clean(graceMs, 'completed');
    const failedDeleted = await queue.clean(graceMs, 'failed');
    console.log(
      `[Bull Cleanup] ${queueName}: removed completed=${completedDeleted.length}, failed=${failedDeleted.length}, graceDays=${graceDays}`
    );
  } finally {
    await queue.close();
  }
}

async function main() {
  console.log(`[Bull Cleanup] Starting for queues: ${selectedQueues.join(', ')}`);
  for (const queueName of selectedQueues) {
    await cleanQueue(queueName);
  }
  console.log('[Bull Cleanup] Done');
}

main().catch((error) => {
  console.error('[Bull Cleanup] Failed:', error);
  process.exit(1);
});
