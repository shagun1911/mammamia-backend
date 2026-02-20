import Bull from 'bull';
import { batchCallingService } from '../services/batchCalling.service';
import { isRedisAvailable } from '../config/redis';

/**
 * Batch Call Sync Queue
 * 
 * Two job types:
 * 1. 'poll' - Lightweight job that polls Python API for batch status every 1-2s
 * 2. 'sync' - Heavy job that syncs conversations and triggers automations
 * 
 * Flow:
 * - On batch submit → enqueue 'poll' job with 5-10s delay
 * - Poll job runs → check status → if not completed, re-enqueue poll with 2s delay
 * - When completed → enqueue 'sync' job once and stop polling
 * - Sync job runs → creates conversations → triggers batch_call_completed automations
 */

// Create batch call sync queue (will fail gracefully if Redis is unavailable)
let batchCallSyncQueue: Bull.Queue | null = null;

// Initialize queue function - called after Redis connection attempt
const createQueueIfAvailable = () => {
  // Check if Redis is actually available
  if (!isRedisAvailable()) {
    console.log('[Batch Call Sync Queue] ⚠️  Redis not available - queue not created (will rely on BatchCallMonitor fallback)');
    batchCallSyncQueue = null;
    return;
  }

  if (!process.env.REDIS_URL) {
    console.log('[Batch Call Sync Queue] ⚠️  REDIS_URL not set - queue not created');
    batchCallSyncQueue = null;
    return;
  }

  try {
    batchCallSyncQueue = new Bull('batch-call-sync', process.env.REDIS_URL, {
      settings: {
        maxStalledCount: 1,
        retryProcessDelay: 5000,
        lockDuration: 300000, // 5 minutes for sync jobs (can take long)
        lockRenewTime: 60000  // Renew lock every 60s
      },
      defaultJobOptions: {
        removeOnComplete: 100, // Keep last 100 completed jobs for debugging
        removeOnFail: 200      // Keep last 200 failed jobs for debugging
      }
    });

    // Handle connection errors gracefully
    batchCallSyncQueue.on('error', (error) => {
      console.error('[Batch Call Sync Queue] ❌ Queue connection error:', error.message);
    });

    console.log('[Batch Call Sync Queue] ✅ Queue created successfully');
    
    // Set up processors after queue is created
    setupQueueProcessors();
  } catch (error: any) {
    console.log('[Batch Call Sync Queue] ⚠️  Queue creation failed:', error.message);
    batchCallSyncQueue = null;
  }
};

// Try to create queue after a delay (to allow Redis connection to complete)
setTimeout(() => {
  createQueueIfAvailable();
}, 3000);

/**
 * Setup queue processors (poll and sync)
 */
const setupQueueProcessors = () => {
  if (!batchCallSyncQueue) {
    console.log('[Batch Call Sync Queue] ⚠️  Queue not available - processors not set up');
    return;
  }

  // ============================================================
  // POLL JOB PROCESSOR (Lightweight, High Concurrency)
  // ============================================================
  // Polls Python API for batch status and re-enqueues itself until completed
  batchCallSyncQueue.process('poll', 50, async (job: Bull.Job) => {
    const { batch_call_id, organizationId, pollCount = 0 } = job.data;

    try {
      const BatchCall = (await import('../models/BatchCall')).default;
      const status = await batchCallingService.getBatchJobStatus(batch_call_id);

      // Update DB with latest status (silent - no log every 10s)
      await BatchCall.updateOne(
        { batch_call_id },
        {
          $set: {
            status: status.status,
            total_calls_dispatched: status.total_calls_dispatched,
            total_calls_scheduled: status.total_calls_scheduled,
            total_calls_finished: status.total_calls_finished,
            last_updated_at_unix: status.last_updated_at_unix || Math.floor(Date.now() / 1000)
          }
        }
      );

      if (status.status === 'completed') {
        console.log(`[Batch Call Sync Queue] ✅ Batch completed: ${batch_call_id} (${status.total_calls_finished}/${status.total_calls_scheduled} calls)`);

        // Check if transcripts are ready before triggering sync
        try {
          const results = await batchCallingService.getBatchJobResults(batch_call_id, true);
          const hasTranscripts = results.results &&
            Array.isArray(results.results) &&
            results.results.length > 0 &&
            results.results.some((r: any) => r.transcript && r.transcript.length > 0);

          if (!hasTranscripts) {
            const transcriptPollCount = (job.data.transcriptPollCount || 0) + 1;
            if (transcriptPollCount < 30) {
              if (batchCallSyncQueue) {
                await batchCallSyncQueue.add('poll', {
                  batch_call_id, organizationId,
                  pollCount: pollCount + 1,
                  transcriptPollCount
                }, { delay: 10000, attempts: 3, backoff: { type: 'fixed', delay: 5000 } });
              }
              return { completed: true, waitingForTranscripts: true, transcriptPollCount };
            }
            console.warn(`[Batch Call Sync Queue] ⚠️ Max transcript checks reached for ${batch_call_id}, syncing anyway`);
          }
        } catch (transcriptCheckError: any) {
          console.warn(`[Batch Call Sync Queue] ⚠️ Could not check transcripts for ${batch_call_id}:`, transcriptCheckError.message);
        }

        if (batchCallSyncQueue) {
          await batchCallSyncQueue.add('sync', { batch_call_id, organizationId }, {
            delay: 5000,
            attempts: 3,
            backoff: { type: 'exponential', delay: 300000 },
            timeout: 3600000
          });
          // Fallback sync in-process
          setTimeout(async () => {
            try {
              await batchCallingService.syncBatchCallConversations(batch_call_id, organizationId);
            } catch (fallbackErr: any) {
              console.error(`[Batch Call Sync Queue] ⚠️ Fallback sync failed: ${batch_call_id}:`, fallbackErr.message);
            }
          }, 10000);
        }

        return { completed: true, batch_call_id, finalStatus: status.status };

      } else if (status.status === 'cancelled' || status.status === 'failed') {
        console.log(`[Batch Call Sync Queue] 🛑 Batch terminal (${status.status}): ${batch_call_id}`);
        return { completed: false, batch_call_id, finalStatus: status.status, reason: 'terminal_status' };
      } else {
        // Still running – re-enqueue silently
        const maxPolls = 8640; // 24 hours at 10s intervals
        if (pollCount >= maxPolls) {
          console.warn(`[Batch Call Sync Queue] ⚠️ Max polls reached for ${batch_call_id}`);
          return { completed: false, batch_call_id, reason: 'max_polls_reached' };
        }

        if (batchCallSyncQueue) {
          await batchCallSyncQueue.add('poll', {
            batch_call_id, organizationId, pollCount: pollCount + 1
          }, { delay: 10000, attempts: 3, backoff: { type: 'fixed', delay: 5000 } });
        }

        return { completed: false, batch_call_id, currentStatus: status.status, pollCount: pollCount + 1 };
      }

    } catch (error: any) {
      console.error(`[Batch Call Sync Queue] ❌ Poll error for ${batch_call_id}:`, error.message);
      if (pollCount < 10 && batchCallSyncQueue) {
        await batchCallSyncQueue.add('poll', {
          batch_call_id, organizationId, pollCount: pollCount + 1
        }, { delay: 5000, attempts: 3 });
      }
      throw error;
    }
  });

  // ============================================================
  // SYNC JOB PROCESSOR (Heavy, Low Concurrency)
  // ============================================================
  // Syncs conversations and triggers batch_call_completed automations
  // NOTE: Poll job already verified transcripts exist before enqueueing this
  batchCallSyncQueue.process('sync', 2, async (job: Bull.Job) => {
    const { batch_call_id, organizationId } = job.data;

    try {
      const BatchCall = (await import('../models/BatchCall')).default;
      const batchCall = await BatchCall.findOne({ batch_call_id }).lean();
      if (batchCall?.status === 'cancelled') {
        return { skipped: true, reason: 'cancelled', batch_call_id };
      }

      console.log(`[Batch Call Sync Queue] Syncing conversations for batch: ${batch_call_id}`);
      await batchCallingService.syncBatchCallConversations(batch_call_id, organizationId);
      console.log(`[Batch Call Sync Queue] ✅ Sync complete: ${batch_call_id}`);

      return { success: true, batch_call_id, organizationId };

    } catch (error: any) {
      console.error(`[Batch Call Sync Queue] ❌ Sync error for ${batch_call_id}:`, error.message);
      throw error;
    }
  });

  batchCallSyncQueue.on('failed', (job: Bull.Job | undefined, err: Error) => {
    // Only log sync job failures (poll failures are normal and retried automatically)
    if (job?.name === 'sync') {
      console.error(`[Batch Call Sync Queue] ❌ Sync job failed for ${job?.data?.batch_call_id}:`, err.message);
    }
  });
};

/**
 * Enqueue the first poll job for a batch
 * Called right after batch submission
 */
export const enqueueBatchPoll = async (batch_call_id: string, organizationId: string): Promise<boolean> => {
  if (!batchCallSyncQueue) {
    console.warn(`[Batch Call Sync Queue] ⚠️ Queue not available - batch ${batch_call_id} will use BatchCallMonitor fallback`);
    return false;
  }

  try {
    await batchCallSyncQueue.add('poll', {
      batch_call_id, organizationId, pollCount: 0
    }, { delay: 10000, attempts: 3, backoff: { type: 'fixed', delay: 5000 } });

    console.log(`[Batch Call Sync Queue] Polling started for batch: ${batch_call_id}`);
    return true;
  } catch (error: any) {
    console.error(`[Batch Call Sync Queue] ❌ Failed to enqueue poll for ${batch_call_id}:`, error.message);
    return false;
  }
};

/**
 * Check if queue is available
 */
export const isBatchCallSyncQueueAvailable = (): boolean => {
  return batchCallSyncQueue !== null;
};

/**
 * Get queue instance (for debugging/monitoring)
 */
export const getBatchCallSyncQueue = (): Bull.Queue | null => {
  return batchCallSyncQueue;
};

// Export queue instance
export { batchCallSyncQueue };
