import { batchCallingService } from '../services/batchCalling.service';
import mongoose from 'mongoose';

/**
 * Background monitor that checks for completed batch calls
 * and automatically syncs their conversations
 */
export class BatchCallMonitor {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private checkIntervalMs = 30000; // Check every 30 seconds

  /**
   * Start the batch call monitor
   */
  start() {
    if (this.isRunning) {
      console.log('[Batch Call Monitor] Already running');
      return;
    }

    console.log(`[Batch Call Monitor] ✅ Started – checking every ${this.checkIntervalMs / 1000}s`);

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

      if (activeBatches.length === 0) {
        // Uncomment below line if you want heartbeat logs even when idle:
        // console.log(`[Batch Call Monitor] 💤 No active batches – next check in ${this.checkIntervalMs / 1000}s`);
        return;
      }

      console.log(`[Batch Call Monitor] 🔄 Found ${activeBatches.length} active batch(es) – syncing now`);

      for (const batch of activeBatches) {
        const batchId = batch.batch_call_id;
        const orgId = (batch as any).organizationId?.toString();
        if (!orgId) {
          console.warn(`[Batch Call Monitor] ⚠️ Batch ${batchId} has no organizationId – skipping`);
          continue;
        }

        console.log(`[Batch Call Monitor] 🔍 Syncing batch ${batchId} (status: ${(batch as any).status})`);
        try {
          await batchCallingService.syncBatchCallConversations(batchId, orgId);
          console.log(`[Batch Call Monitor] ✅ Sync cycle done for ${batchId} – next check in ${this.checkIntervalMs / 1000}s`);
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
