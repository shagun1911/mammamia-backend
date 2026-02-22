import Bull from 'bull';
import { batchCallingService } from '../services/batchCalling.service';
import { isRedisAvailable, bullCreateClient } from '../config/redis';

/**
 * Batch Call Sync Queue
 *
 * Two job types:
 * 1. 'poll' - Runs every 30s; calls incremental sync on every tick regardless of batch status
 * 2. 'sync' - One-shot final sync after batch is completed (belt-and-suspenders safety net)
 *
 * Incremental flow (production-ready for 500–1000 call batches):
 *  1. Batch submitted → enqueueBatchPoll → first 'poll' runs after 30s
 *  2. Each poll tick:
 *       a. Fetch batch status from Python API, update DB
 *       b. Call syncBatchCallConversations (incremental):
 *            → for each call whose transcript just arrived → create conversation + trigger automation
 *            → already-processed calls (in processed_call_ids) are skipped in O(1)
 *            → calls still awaiting transcript are skipped and retried next tick
 *       c. If batch still in_progress → re-enqueue poll with 30s delay
 *       d. If batch completed + conversations_synced=true → stop polling (done)
 *       e. If batch completed + conversations_synced=false → re-enqueue poll to catch
 *          remaining calls whose transcripts haven't arrived yet
 *  3. When batch completes, also enqueue one explicit 'sync' job as a safety net
 *  4. If Redis unavailable → BatchCallMonitor fallback checks every 60s
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
    batchCallSyncQueue = new Bull('batch-call-sync', {
      createClient: bullCreateClient,
      settings: {
        maxStalledCount: 1,
        retryProcessDelay: 5000,
        lockDuration: 300000,
        lockRenewTime: 60000
      },
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 200
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

      // 1. Fetch latest status from Python API and persist to DB
      const status = await batchCallingService.getBatchJobStatus(batch_call_id);
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

      // 2. Incremental sync – process any call whose transcript has just arrived.
      //    This fires automations per-call as they complete, not after the whole batch.
      //    syncBatchCallConversations is fully idempotent via processed_call_ids.
      try {
        await batchCallingService.syncBatchCallConversations(batch_call_id, organizationId);
      } catch (syncErr: any) {
        // Log but don't stop polling – next tick will retry unprocessed calls
        console.error(`[Batch Call Sync Queue] ⚠️ Incremental sync error for ${batch_call_id}:`, syncErr.message);
      }

      // 3. Decide whether to keep polling
      if (status.status === 'cancelled' || status.status === 'failed') {
        console.log(`[Batch Call Sync Queue] 🛑 Batch terminal (${status.status}): ${batch_call_id}`);
        return { done: true, batch_call_id, finalStatus: status.status };
      }

      if (status.status === 'completed') {
        // Re-check DB record to see if all calls have been processed
        const fresh = await BatchCall.findOne({ batch_call_id }).lean() as any;

        if (fresh?.conversations_synced) {
          console.log(`[Batch Call Sync Queue] ✅ Batch ${batch_call_id} fully processed – stopping poll`);
          return { done: true, batch_call_id, finalStatus: 'completed' };
        }

        // Still have calls awaiting transcripts – keep polling at same cadence
        const pendingPollCount = (job.data.pendingPollCount || 0) + 1;
        const maxPendingPolls = 60; // 30 min of retries after completion
        if (pendingPollCount >= maxPendingPolls) {
          console.warn(`[Batch Call Sync Queue] ⚠️ Max post-completion polls (${maxPendingPolls}) reached for ${batch_call_id} – forcing conversations_synced=true`);
          await BatchCall.updateOne({ batch_call_id }, { $set: { conversations_synced: true } });
          return { done: true, batch_call_id, reason: 'max_pending_polls' };
        }

        console.log(`[Batch Call Sync Queue] ⏳ Batch ${batch_call_id} completed but transcripts still pending – re-poll #${pendingPollCount}/${maxPendingPolls}`);
        if (batchCallSyncQueue) {
          await batchCallSyncQueue.add('poll', {
            batch_call_id, organizationId, pollCount: pollCount + 1, pendingPollCount
          }, { delay: 30000, attempts: 3, backoff: { type: 'fixed', delay: 10000 } });
        }
        return { done: false, batch_call_id, currentStatus: 'completed', pendingPollCount };
      }

      // Batch still in_progress – re-enqueue next tick
      const maxPolls = 2880; // 24 hours at 30s intervals
      if (pollCount >= maxPolls) {
        console.warn(`[Batch Call Sync Queue] ⚠️ Max polls reached for ${batch_call_id}`);
        return { done: false, batch_call_id, reason: 'max_polls_reached' };
      }

      const finished = status.total_calls_finished ?? 0;
      const scheduled = status.total_calls_scheduled ?? 1;
      const pct = Math.round((finished / scheduled) * 100);
      if (pollCount % 10 === 0) {
        // Log progress every ~5 min to avoid log spam
        console.log(`[Batch Call Sync Queue] 📊 Batch ${batch_call_id} progress: ${finished}/${scheduled} (${pct}%) – poll #${pollCount}`);
      }

      if (batchCallSyncQueue) {
        await batchCallSyncQueue.add('poll', {
          batch_call_id, organizationId, pollCount: pollCount + 1
        }, { delay: 30000, attempts: 3, backoff: { type: 'fixed', delay: 10000 } });
      }

      return { done: false, batch_call_id, currentStatus: status.status, pollCount: pollCount + 1, progress: `${pct}%` };

    } catch (error: any) {
      console.error(`[Batch Call Sync Queue] ❌ Poll error for ${batch_call_id}:`, error.message);
      if (pollCount < 10 && batchCallSyncQueue) {
        await batchCallSyncQueue.add('poll', {
          batch_call_id, organizationId, pollCount: pollCount + 1
        }, { delay: 30000, attempts: 3 });
      }
      throw error;
    }
  });

  // ============================================================
  // SYNC JOB PROCESSOR – safety-net final pass
  // ============================================================
  // The poll job handles all incremental processing.
  // This job is enqueued only as a belt-and-suspenders final sync after batch completion,
  // so any call that was missed by the poll cycle gets picked up.
  // syncBatchCallConversations is idempotent – already-processed calls are no-ops.
  batchCallSyncQueue.process('sync', 2, async (job: Bull.Job) => {
    const { batch_call_id, organizationId } = job.data;

    try {
      const BatchCall = (await import('../models/BatchCall')).default;
      const batchCall = await BatchCall.findOne({ batch_call_id }).lean() as any;
      if (batchCall?.status === 'cancelled') {
        return { skipped: true, reason: 'cancelled', batch_call_id };
      }
      if (batchCall?.conversations_synced) {
        return { skipped: true, reason: 'already_synced', batch_call_id };
      }

      console.log(`[Batch Call Sync Queue] 🔄 Safety-net final sync for batch: ${batch_call_id}`);
      await batchCallingService.syncBatchCallConversations(batch_call_id, organizationId);
      console.log(`[Batch Call Sync Queue] ✅ Final sync complete: ${batch_call_id}`);

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
    }, { delay: 30000, attempts: 3, backoff: { type: 'fixed', delay: 10000 } });

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
