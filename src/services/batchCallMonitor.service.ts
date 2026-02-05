import { batchCallingService } from '../services/batchCalling.service';
import mongoose from 'mongoose';

/**
 * Background monitor that checks for completed batch calls
 * and automatically syncs their conversations
 */
export class BatchCallMonitor {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private checkIntervalMs = 3000; // Check every 3 seconds for immediate automation triggering

  /**
   * Start the batch call monitor
   */
  start() {
    if (this.isRunning) {
      console.log('[Batch Call Monitor] Already running');
      return;
    }

    console.log('[Batch Call Monitor] 🚀 Starting automatic sync monitor');
    console.log(`[Batch Call Monitor] Check interval: ${this.checkIntervalMs / 1000}s`);

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
   * Check for completed batch calls and sync their conversations
   */
  private async checkAndSyncBatchCalls() {
    try {
      // Import BatchCall model
      const BatchCall = (await import('../models/BatchCall')).default;

      // Find completed but unsynced batch calls (from last 24 hours)
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      
      const unsyncedBatches = await BatchCall.find({
        status: 'completed',
        conversations_synced: { $ne: true },
        createdAt: { $gte: oneDayAgo }
      })
      .select('batch_call_id organizationId createdAt')
      .lean();

      if (unsyncedBatches.length === 0) {
        return; // Nothing to sync
      }

      console.log(`[Batch Call Monitor] 📋 Found ${unsyncedBatches.length} completed batch call(s) to sync`);

      // Sync each batch call
      for (const batch of unsyncedBatches) {
        const batchId = batch.batch_call_id;
        const orgId = batch.organizationId?.toString();

        if (!orgId) {
          console.log(`[Batch Call Monitor] ⚠️  Skipping ${batchId}: No organization ID`);
          continue;
        }

        try {
          console.log(`[Batch Call Monitor] 🔄 Syncing batch: ${batchId}`);
          
          // Sync conversations from Python API
          await batchCallingService.syncBatchCallConversations(batchId, orgId);
          
          console.log(`[Batch Call Monitor] ✅ Synced batch: ${batchId}`);
          
        } catch (error: any) {
          console.error(`[Batch Call Monitor] ❌ Failed to sync ${batchId}:`, error.message);
          // Continue with next batch even if this one fails
        }
      }

      console.log(`[Batch Call Monitor] ✅ Sync check complete`);
      
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
