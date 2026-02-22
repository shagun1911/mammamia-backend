import { batchCallingService } from '../services/batchCalling.service';
import mongoose from 'mongoose';

/**
 * Background monitor that checks for completed batch calls
 * and automatically syncs their conversations
 */
export class BatchCallMonitor {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private checkIntervalMs = 60000; // Check every 60 seconds (poll queue handles real-time detection)

  /**
   * Start the batch call monitor
   */
  start() {
    if (this.isRunning) {
      console.log('[Batch Call Monitor] Already running');
      return;
    }

    console.log(`[Batch Call Monitor] Started (fallback check every ${this.checkIntervalMs / 1000}s)`);

    this.isRunning = true;
    
    // Run immediately on start
    this.checkAndSyncBatchCalls();

    // Then run on interval
    this.intervalId = setInterval(() => {
      this.checkAndSyncBatchCalls();
    }, this.checkIntervalMs);
  }

  /**
   * Stop the batch call monitor
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log('[Batch Call Monitor] ⏹️  Stopped');
  }

  /**
   * Check for active/completed batch calls and run an incremental sync pass.
   * Handles both in_progress batches (partial transcripts arriving) and
   * completed batches that still have pending transcripts.
   */
  private async checkAndSyncBatchCalls() {
    try {
      const BatchCall = (await import('../models/BatchCall')).default;

      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      // Pick up any batch that is either still running OR completed but not yet fully synced.
      // The incremental sync is idempotent – already-processed calls (in processed_call_ids) are skipped.
      const activeBatches = await BatchCall.find({
        conversations_synced: { $ne: true },
        status: { $nin: ['cancelled', 'canceled', 'failed'] },
        createdAt: { $gte: oneDayAgo },
        $or: [
          { syncErrorCount: { $exists: false } },
          { syncErrorCount: { $lt: 5 } }
        ]
      })
      .select('batch_call_id organizationId status createdAt')
      .lean();

      if (activeBatches.length === 0) return;

      console.log(`[Batch Call Monitor] 🔄 Running incremental sync for ${activeBatches.length} active batch(es)`);

      for (const batch of activeBatches) {
        const batchId = batch.batch_call_id;
        const orgId = (batch as any).organizationId?.toString();
        if (!orgId) continue;

        try {
          // For in_progress batches: also refresh status from Python API first
          if ((batch as any).status !== 'completed') {
            try {
              const status = await batchCallingService.getBatchJobStatus(batchId);
              await BatchCall.updateOne(
                { batch_call_id: batchId },
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
              if (status.status === 'cancelled' || status.status === 'failed') {
                console.log(`[Batch Call Monitor] 🛑 Batch ${batchId} is ${status.status} – skipping sync`);
                continue;
              }
            } catch (statusErr: any) {
              console.warn(`[Batch Call Monitor] ⚠️ Could not refresh status for ${batchId}:`, statusErr.message);
            }
          }

          await batchCallingService.syncBatchCallConversations(batchId, orgId);
          console.log(`[Batch Call Monitor] ✅ Incremental sync done: ${batchId}`);
        } catch (error: any) {
          console.error(`[Batch Call Monitor] ❌ Failed to sync ${batchId}:`, error.message);
        }
      }

    } catch (error: any) {
      console.error('[Batch Call Monitor] ❌ Error during sync check:', error.message);
    }
  }

  /**
   * Manually trigger a sync check (for testing)
   */
  async triggerSync() {
    console.log('[Batch Call Monitor] 🔄 Manual sync triggered');
    await this.checkAndSyncBatchCalls();
  }

  /**
   * Update check interval
   */
  setCheckInterval(intervalMs: number) {
    this.checkIntervalMs = intervalMs;
    
    // Restart with new interval if already running
    if (this.isRunning) {
      this.stop();
      this.start();
    }
  }

  /**
   * Get monitor status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      checkIntervalMs: this.checkIntervalMs,
      checkIntervalSeconds: this.checkIntervalMs / 1000
    };
  }
}

// Export singleton instance
export const batchCallMonitor = new BatchCallMonitor();
