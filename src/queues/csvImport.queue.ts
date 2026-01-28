import Bull from 'bull';
import ContactList from '../models/ContactList';
import CSVImport from '../models/CSVImport';
import { automationEngine } from '../services/automationEngine.service';
import { isRedisAvailable } from '../config/redis';
import { csvImportService } from '../services/csvImport.service';

// Create CSV import queue (will fail gracefully if Redis is unavailable)
let csvImportQueue: Bull.Queue | null = null;

// Initialize queue function - called after Redis connection attempt
const createQueueIfAvailable = () => {
  // Check if Redis is actually available
  if (!isRedisAvailable()) {
    console.log('[CSV Import Queue] ⚠️  Redis not available - queue not created (will use synchronous import)');
    csvImportQueue = null;
    return;
  }

  if (!process.env.REDIS_URL) {
    console.log('[CSV Import Queue] ⚠️  REDIS_URL not set - queue not created');
    csvImportQueue = null;
    return;
  }

  try {
    csvImportQueue = new Bull('csv-import', process.env.REDIS_URL, {
      settings: {
        maxStalledCount: 1,
        retryProcessDelay: 5000,
        lockDuration: 30000,
        lockRenewTime: 15000
      }
    });

    // Handle connection errors gracefully
    csvImportQueue.on('error', (error) => {
      console.error('[CSV Import Queue] ❌ Queue connection error:', error.message);
    });

    console.log('[CSV Import Queue] ✅ Queue created successfully');
    
    // Set up processor after queue is created
    setupQueueProcessor();
  } catch (error: any) {
    console.log('[CSV Import Queue] ⚠️  Queue creation failed:', error.message);
    csvImportQueue = null;
  }
};

// Try to create queue after a delay (to allow Redis connection to complete)
// This will be called from server.ts after Redis connection attempt
setTimeout(() => {
  createQueueIfAvailable();
}, 3000);

export { csvImportQueue };

// Process CSV import (only if queue is available)
const setupQueueProcessor = () => {
  if (!csvImportQueue) {
    console.log('[CSV Import Queue] ⚠️  Queue not available - processor not initialized');
    return;
  }

  console.log('[CSV Import Queue] ✅ Queue processor initialized');
  
  csvImportQueue.process('import-csv', async (job: Bull.Job) => {
    console.log('[CSV Import Queue] 🚀 Starting job:', job.id);
    console.log('[CSV Import Queue] Job data:', {
      importId: job.data.importId,
      listId: job.data.listId,
      totalRows: job.data.csvContent?.split('\n').length || 'unknown'
    });

    const { importId, csvContent, listId, defaultCountryCode, userId, organizationId } = job.data;

    const importRecord = await CSVImport.findById(importId);
    if (!importRecord) {
      console.error('[CSV Import Queue] ❌ Import record not found:', importId);
      throw new Error('Import record not found');
    }

    console.log('[CSV Import Queue] Found import record:', importRecord._id.toString());

    try {
      // Update status to processing
      importRecord.status = 'processing';
      importRecord.startedAt = new Date();
      await importRecord.save();
      console.log('[CSV Import Queue] ✅ Status updated to processing');

      // Verify list exists
      const list = await ContactList.findById(listId);
      if (!list) {
        throw new Error('List not found');
      }

      // Convert CSV string to buffer for streaming
      const csvBuffer = Buffer.from(csvContent, 'utf-8');
      const importBatchId = importRecord._id.toString();

      console.log(`[CSV Import Queue] Starting streaming import for ${importRecord.totalRows} rows`);

      // Use streaming CSV import service
      const result = await csvImportService.importFromStream(csvBuffer, {
        listId,
        defaultCountryCode,
        userId,
        organizationId,
        importBatchId,
        onProgress: async (progress) => {
          // Update import record with progress
          importRecord.processedRows = progress.processedRows;
          importRecord.importedCount = progress.importedCount;
          importRecord.duplicateCount = progress.duplicateCount;
          importRecord.failedCount = progress.failedCount;
          
          // Save progress (onProgress is already throttled to every 100 rows)
          await importRecord.save();
          
          // Update job progress
          const progressPercent = importRecord.totalRows > 0 
            ? Math.round((progress.processedRows / importRecord.totalRows) * 100)
            : 0;
          job.progress(progressPercent);
          
          // Log every 500 rows to avoid spam
          if (progress.processedRows % 500 === 0) {
            console.log(`[CSV Import Queue] Progress: ${progress.processedRows}/${importRecord.totalRows} (${progressPercent}%) - ${progress.importedCount} imported, ${progress.duplicateCount} duplicates`);
          }
        }
      });

      // Update final import record
      importRecord.status = 'completed';
      importRecord.completedAt = new Date();
      importRecord.processedRows = importRecord.totalRows; // Ensure it's complete
      importRecord.importedCount = result.imported;
      importRecord.duplicateCount = result.duplicates;
      importRecord.failedCount = result.failed;
      importRecord.importErrors = result.errors;
      await importRecord.save();
      
      // Final progress update
      job.progress(100);

      // Trigger batch automation ONLY if automations exist and contacts were imported
      if (result.imported > 0) {
        // Check if there are any active automations for this organization first
        const Automation = (await import('../models/Automation')).default;
        const hasAutomations = await Automation.exists({
          organizationId,
          isActive: true,
          'nodes.type': 'trigger',
          'nodes.config.event': 'batch_call'
        });

        // Only trigger if automations exist
        if (hasAutomations) {
          // Get imported contact IDs by importBatchId
          const Customer = (await import('../models/Customer')).default;
          const importedContacts = await Customer.find({
            organizationId,
            importBatchId
          }).select('_id').lean();

          if (importedContacts.length > 0) {
            const contactIds = importedContacts.map(c => (c._id as any).toString());
            
            // Trigger automation in batches to avoid overwhelming the system
            const automationBatchSize = 100;
            for (let i = 0; i < contactIds.length; i += automationBatchSize) {
              const batch = contactIds.slice(i, i + automationBatchSize);
              automationEngine.triggerByEvent('batch_call', {
                event: 'batch_call',
                source: 'csv',
                listId,
                contactIds: batch,
                userId,
                organizationId
              }).catch(err => console.error('[CSV Import Queue] Automation trigger error:', err));
              
              // Rate limit: wait 1 second between automation batches
              if (i + automationBatchSize < contactIds.length) {
                await new Promise(resolve => setTimeout(resolve, 1000));
              }
            }
          }
        } else {
          console.log('[CSV Import Queue] No active automations found, skipping trigger');
        }
      }

      console.log(`[CSV Import Queue] ✅ Import completed: ${result.imported} imported, ${result.failed} failed, ${result.duplicates} duplicates`);

    } catch (error: any) {
      console.error('[CSV Import Queue] ❌ Import error:', error);
      console.error('[CSV Import Queue] Error stack:', error.stack);
      
      if (importRecord) {
        importRecord.status = 'failed';
        importRecord.completedAt = new Date();
        importRecord.importErrors.push({ row: 0, error: error.message || 'Unknown error' });
        await importRecord.save();
        console.log('[CSV Import Queue] ✅ Updated import record status to failed');
      }
      
      throw error;
    }
  });

  // Log queue events for debugging
  csvImportQueue.on('completed', (job: Bull.Job) => {
    console.log('[CSV Import Queue] ✅ Job completed:', job.id);
  });

  csvImportQueue.on('failed', (job: Bull.Job | undefined, err: Error) => {
    console.error('[CSV Import Queue] ❌ Job failed:', job?.id, err.message);
  });

  csvImportQueue.on('error', (error: Error) => {
    console.error('[CSV Import Queue] ❌ Queue error:', error.message);
  });
};
