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

    console.log(`[Batch Call Sync Queue] 🔍 POLL JOB START - Batch: ${batch_call_id}, Poll #${pollCount + 1}`);

    try {
      // Import BatchCall model
      const BatchCall = (await import('../models/BatchCall')).default;

      // Step 1: Call Python API to get current status
      const status = await batchCallingService.getBatchJobStatus(batch_call_id);

      console.log(`[Batch Call Sync Queue] 📊 Status from Python: ${status.status}`);
      console.log(`[Batch Call Sync Queue] 📈 Progress: ${status.total_calls_finished}/${status.total_calls_scheduled}`);

      // Step 2: Update BatchCall in DB with latest status
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

      // Step 3: Check if completed
      if (status.status === 'completed') {
        console.log(`[Batch Call Sync Queue] ✅ BATCH COMPLETED - Batch: ${batch_call_id}`);
        console.log(`[Batch Call Sync Queue] 🚀 Enqueueing SYNC job for batch: ${batch_call_id}`);

        // Enqueue sync job (will create conversations and trigger automations)
        if (batchCallSyncQueue) {
          await batchCallSyncQueue.add('sync', {
            batch_call_id,
            organizationId
          }, {
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 300000 // 5 minutes between retries
            },
            timeout: 3600000 // 60 minutes timeout for large batches
          });

          console.log(`[Batch Call Sync Queue] ✅ SYNC job enqueued for batch: ${batch_call_id}`);
        }

        // DO NOT re-enqueue poll job - we're done!
        console.log(`[Batch Call Sync Queue] 🏁 POLL JOB COMPLETE - Batch: ${batch_call_id} (stopped polling)`);
        return { completed: true, batch_call_id, finalStatus: status.status };

      } else {
        // Not completed yet - re-enqueue poll job with 2s delay
        console.log(`[Batch Call Sync Queue] ⏳ Batch not completed yet (status: ${status.status})`);
        
        // Safety: Stop polling after 24 hours (43200 polls at 2s = 24h)
        const maxPolls = 43200;
        if (pollCount >= maxPolls) {
          console.warn(`[Batch Call Sync Queue] ⚠️  Max polls reached (${maxPolls}), stopping poll for batch: ${batch_call_id}`);
          return { completed: false, batch_call_id, reason: 'max_polls_reached' };
        }

        if (batchCallSyncQueue) {
          await batchCallSyncQueue.add('poll', {
            batch_call_id,
            organizationId,
            pollCount: pollCount + 1
          }, {
            delay: 2000, // Re-poll every 2 seconds
            attempts: 3,
            backoff: {
              type: 'fixed',
              delay: 5000
            }
          });

          console.log(`[Batch Call Sync Queue] 🔄 Re-enqueued POLL job for batch: ${batch_call_id} (next poll in 2s)`);
        }

        return { completed: false, batch_call_id, currentStatus: status.status, pollCount: pollCount + 1 };
      }

    } catch (error: any) {
      console.error(`[Batch Call Sync Queue] ❌ POLL JOB ERROR - Batch: ${batch_call_id}:`, error.message);
      
      // On error, still try to re-enqueue if not max retries
      if (pollCount < 10) { // Retry up to 10 times on error
        if (batchCallSyncQueue) {
          await batchCallSyncQueue.add('poll', {
            batch_call_id,
            organizationId,
            pollCount: pollCount + 1
          }, {
            delay: 5000, // Wait 5s before retry on error
            attempts: 3
          });
        }
      }

      throw error; // Let Bull handle retry logic
    }
  });

  // ============================================================
  // SYNC JOB PROCESSOR (Heavy, Low Concurrency)
  // ============================================================
  // Syncs conversations and triggers batch_call_completed automations
  batchCallSyncQueue.process('sync', 2, async (job: Bull.Job) => {
    const { batch_call_id, organizationId } = job.data;

    console.log(`[Batch Call Sync Queue] 🔄 SYNC JOB START - Batch: ${batch_call_id}`);
    console.log(`[Batch Call Sync Queue] 📋 Organization: ${organizationId}`);

    try {
      // Call existing sync service (this creates conversations and triggers automations)
      await batchCallingService.syncBatchCallConversations(batch_call_id, organizationId);

      console.log(`[Batch Call Sync Queue] ✅ SYNC JOB COMPLETE - Batch: ${batch_call_id}`);
      console.log(`[Batch Call Sync Queue] 🎯 Automations triggered for batch: ${batch_call_id}`);

      return { success: true, batch_call_id, organizationId };

    } catch (error: any) {
      console.error(`[Batch Call Sync Queue] ❌ SYNC JOB ERROR - Batch: ${batch_call_id}:`, error.message);
      console.error(`[Batch Call Sync Queue] Stack trace:`, error.stack);
      
      throw error; // Let Bull handle retry logic
    }
  });

  // ============================================================
  // QUEUE EVENT HANDLERS (Logging & Debugging)
  // ============================================================

  batchCallSyncQueue.on('completed', (job: Bull.Job, result: any) => {
    console.log(`[Batch Call Sync Queue] ✅ Job completed:`, {
      type: job.name,
      batch_call_id: job.data.batch_call_id,
      result
    });
  });

  batchCallSyncQueue.on('failed', (job: Bull.Job | undefined, err: Error) => {
    console.error(`[Batch Call Sync Queue] ❌ Job failed:`, {
      type: job?.name,
      batch_call_id: job?.data?.batch_call_id,
      error: err.message,
      attempts: job?.attemptsMade,
      maxAttempts: job?.opts?.attempts
    });
  });

  batchCallSyncQueue.on('stalled', (job: Bull.Job) => {
    console.warn(`[Batch Call Sync Queue] ⚠️  Job stalled:`, {
      type: job.name,
      batch_call_id: job.data.batch_call_id
    });
  });

  console.log('[Batch Call Sync Queue] ✅ Processors set up successfully');
  console.log('[Batch Call Sync Queue] 📊 Poll processor: 50 concurrent jobs');
  console.log('[Batch Call Sync Queue] 📊 Sync processor: 2 concurrent jobs');
};

/**
 * Enqueue the first poll job for a batch
 * Called right after batch submission
 */
export const enqueueBatchPoll = async (batch_call_id: string, organizationId: string): Promise<boolean> => {
  if (!batchCallSyncQueue) {
    console.log(`[Batch Call Sync Queue] ⚠️  Queue not available - cannot enqueue poll for batch: ${batch_call_id}`);
    console.log(`[Batch Call Sync Queue] ℹ️  Batch will rely on BatchCallMonitor fallback or user-triggered sync`);
    return false;
  }

  try {
    await batchCallSyncQueue.add('poll', {
      batch_call_id,
      organizationId,
      pollCount: 0
    }, {
      delay: 10000, // Start polling after 10 seconds (give Python time to initialize)
      attempts: 3,
      backoff: {
        type: 'fixed',
        delay: 5000
      }
    });

    console.log(`[Batch Call Sync Queue] ✅ Initial POLL job enqueued for batch: ${batch_call_id}`);
    console.log(`[Batch Call Sync Queue] ⏰ First poll will run in 10 seconds`);
    
    return true;
  } catch (error: any) {
    console.error(`[Batch Call Sync Queue] ❌ Failed to enqueue poll for batch: ${batch_call_id}:`, error.message);
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
