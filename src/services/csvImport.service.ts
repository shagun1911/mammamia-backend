import { Readable } from 'stream';
import csvParser from 'csv-parser';
import Customer from '../models/Customer';
import ContactListMember from '../models/ContactListMember';
import { AppError } from '../middleware/error.middleware';

export interface CSVImportOptions {
  listId: string;
  defaultCountryCode: string;
  userId: string;
  organizationId: string;
  importBatchId?: string;
  onProgress?: (progress: {
    processedRows: number;
    importedCount: number;
    duplicateCount: number;
    failedCount: number;
  }) => void;
}

export interface CSVImportResult {
  imported: number;
  failed: number;
  duplicates: number;
  errors: Array<{ row: number; error: string }>;
}

/**
 * Streaming CSV Import Service
 * Processes CSV row-by-row without loading full file into memory
 */
export class CSVImportService {
  private readonly BATCH_SIZE = 5000;
  private readonly PROGRESS_UPDATE_INTERVAL = 100; // Update progress every 100 rows (for UI updates)

  /**
   * Import contacts from CSV stream
   * Uses streaming parser to avoid loading full file into memory
   */
  async importFromStream(
    csvBuffer: Buffer,
    options: CSVImportOptions
  ): Promise<CSVImportResult> {
    const {
      listId,
      defaultCountryCode,
      userId,
      organizationId,
      importBatchId,
      onProgress
    } = options;

    const results: CSVImportResult = {
      imported: 0,
      failed: 0,
      duplicates: 0,
      errors: []
    };

    let processedRows = 0;
    let batch: any[] = [];
    let lastProgressUpdate = 0;
    const errors: Array<{ row: number; error: string }> = [];
    const pendingBatches: Array<Promise<void>> = [];

    return new Promise((resolve, reject) => {
      const stream = Readable.from(csvBuffer);

      const processBatchAsync = async (currentBatch: any[], startRow: number) => {
        try {
          const batchResult = await this.processBatch(
            currentBatch,
            listId,
            defaultCountryCode,
            organizationId,
            importBatchId,
            startRow
          );

          results.imported += batchResult.imported;
          results.duplicates += batchResult.duplicates;
          results.failed += batchResult.failed;
          errors.push(...batchResult.errors);

          // Update progress (throttled)
          if (onProgress && processedRows - lastProgressUpdate >= this.PROGRESS_UPDATE_INTERVAL) {
            onProgress({
              processedRows,
              importedCount: results.imported,
              duplicateCount: results.duplicates,
              failedCount: results.failed
            });
            lastProgressUpdate = processedRows;
          }
        } catch (error: any) {
          console.error('[CSV Import Service] Batch processing error:', error);
          errors.push({ row: startRow, error: error.message || 'Batch processing failed' });
          results.failed += currentBatch.length;
        }
      };

      stream
        .pipe(csvParser({
          mapHeaders: ({ header }) => header.trim().toLowerCase(),
          mapValues: ({ value }) => value ? value.trim() : ''
        }))
        .on('data', (row: any) => {
          batch.push(row);
          processedRows++;

          // Process batch when it reaches BATCH_SIZE
          if (batch.length >= this.BATCH_SIZE) {
            const currentBatch = [...batch];
            const startRow = processedRows - batch.length + 1;
            batch = []; // Clear batch immediately

            // Process batch asynchronously (stream continues)
            const batchPromise = processBatchAsync(currentBatch, startRow);
            pendingBatches.push(batchPromise);
          }
        })
        .on('end', async () => {
          try {
            // Process remaining batch
            if (batch.length > 0) {
              await processBatchAsync(batch, processedRows - batch.length + 1);
            }

            // Wait for all pending batches to complete
            await Promise.all(pendingBatches);

            // Final progress update
            if (onProgress) {
              onProgress({
                processedRows,
                importedCount: results.imported,
                duplicateCount: results.duplicates,
                failedCount: results.failed
              });
            }

            results.errors = errors.slice(0, 100); // Limit to 100 errors
            resolve(results);
          } catch (error: any) {
            reject(error);
          }
        })
        .on('error', (error: Error) => {
          console.error('[CSV Import Service] Stream error:', error);
          reject(new AppError(400, 'VALIDATION_ERROR', `CSV parsing error: ${error.message}`));
        });
    });
  }

  /** Known CSV column names (lowercase) that map to core contact fields. Extra columns go to metadata. */
  private static readonly CORE_FIELDS = new Set([
    'name', 'email', 'phone', 'tags',
    'company', 'notes',
    'full name', 'fullname', 'contact name',
    'first name', 'firstname', 'first_name', 'fname',
    'last name', 'lastname', 'last_name', 'lname', 'surname',
    'email address', 'e-mail',
    'phone number', 'phonenumber', 'mobile', 'telephone', 'cell',
    'company name', 'company_name', 'organization', 'org',
    'note', 'comments', 'remarks'
  ]);

  /** Aliases: header key (lowercase) -> canonical key for value lookup */
  private static readonly COLUMN_ALIASES: Record<string, string> = {
    'full name': 'name',
    'fullname': 'name',
    'contact name': 'name',
    'first name': 'first_name',
    'firstname': 'first_name',
    'fname': 'first_name',
    'last name': 'last_name',
    'lastname': 'last_name',
    'lname': 'last_name',
    'surname': 'last_name',
    'email address': 'email',
    'e-mail': 'email',
    'phone number': 'phone',
    'phonenumber': 'phone',
    'mobile': 'phone',
    'telephone': 'phone',
    'cell': 'phone',
    'company name': 'company',
    'company_name': 'company',
    'organization': 'company',
    'org': 'company',
    'note': 'notes',
    'comments': 'notes',
    'remarks': 'notes'
  };

  /** Get first non-empty value from row using canonical key or aliases */
  private static getCell(row: Record<string, string>, ...keys: string[]): string {
    for (const key of keys) {
      const v = (row[key] ?? '').trim();
      if (v) return v;
    }
    return '';
  }

  /**
   * Process a batch of contacts
   * Optimized for speed: single DB queries, bulk operations.
   * All CSV columns are supported: name, email, phone, tags, company, notes, and any extra columns (e.g. "Company name", "Job title") are stored in metadata with readable labels.
   */
  private async processBatch(
    batch: any[],
    listId: string,
    defaultCountryCode: string,
    organizationId: string,
    importBatchId: string | undefined,
    startRowNumber: number
  ): Promise<{
    imported: number;
    duplicates: number;
    failed: number;
    errors: Array<{ row: number; error: string }>;
  }> {
    const contactsToCreate: any[] = [];
    const listMembersToCreate: any[] = [];
    const duplicateEmails: string[] = [];
    const duplicatePhones: string[] = [];
    const errors: Array<{ row: number; error: string }> = [];
    const emailToRowMap = new Map<string, number>();
    const phoneToRowMap = new Map<string, number>();

    // First pass: validate and prepare data
    for (let i = 0; i < batch.length; i++) {
      const row = batch[i];
      const rowNumber = startRowNumber + i;

      try {
        // Name: use full "name" if present, otherwise build from first name + last name
        const fullName = CSVImportService.getCell(row, 'name', 'full name', 'fullname', 'contact name').trim();
        const firstName = CSVImportService.getCell(row, 'first name', 'firstname', 'first_name', 'fname').trim();
        const lastName = CSVImportService.getCell(row, 'last name', 'lastname', 'last_name', 'lname', 'surname').trim();
        const name = fullName || [firstName, lastName].filter(Boolean).join(' ').trim();
        const email = CSVImportService.getCell(row, 'email', 'email address', 'e-mail').trim().toLowerCase();
        let phone = CSVImportService.getCell(row, 'phone', 'phone number', 'phonenumber', 'mobile', 'telephone', 'cell').trim();
        const company = CSVImportService.getCell(row, 'company', 'company name', 'company_name', 'organization', 'org');
        const notes = CSVImportService.getCell(row, 'notes', 'note', 'comments', 'remarks');
        const tagsStr = (row.tags || '').trim();
        const tags = tagsStr ? tagsStr.split(',').map((t: string) => t.trim()).filter(Boolean) : [];

        // Validate required fields
        if (!name) {
          errors.push({ row: rowNumber, error: 'Name is required' });
          continue;
        }

        // Normalize phone number
        if (phone) {
          phone = phone.replace(/\D/g, '');
          if (phone && !phone.startsWith('+')) {
            const countryCode = defaultCountryCode.replace(/\D/g, '');
            phone = `+${countryCode}${phone}`;
          } else if (phone && !phone.startsWith('+')) {
            phone = `+${phone}`;
          }
        }

        // Build metadata: known extras (company, notes) + any other CSV columns with readable labels
        const metadata: Record<string, any> = {};
        if (company) metadata['Company name'] = company;
        if (notes) metadata['Notes'] = notes;

        for (const [header, value] of Object.entries(row)) {
          const key = (header || '').trim().toLowerCase();
          const val = typeof value === 'string' ? value.trim() : value;
          if (!key || val === undefined || val === '') continue;
          const canonical = CSVImportService.COLUMN_ALIASES[key];
          if (canonical) {
            // Already handled above (company, notes, etc.)
            if (canonical === 'company' && !metadata['Company name']) metadata['Company name'] = val;
            else if (canonical === 'notes' && !metadata['Notes']) metadata['Notes'] = val;
            continue;
          }
          if (CSVImportService.CORE_FIELDS.has(key)) continue; // name, email, phone, tags
          // Human-readable label: "job title" -> "Job title"
          const label = key.replace(/\b\w/g, c => c.toUpperCase()).replace(/_/g, ' ');
          metadata[label] = val;
        }

        // Track for duplicate checking
        if (email) {
          duplicateEmails.push(email);
          emailToRowMap.set(email, rowNumber);
        }
        if (phone) {
          duplicatePhones.push(phone);
          phoneToRowMap.set(phone, rowNumber);
        }

        // Prepare contact document
        contactsToCreate.push({
          name,
          email: email || undefined,
          phone: phone || undefined,
          organizationId,
          tags,
          source: 'import',
          metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
          ...(importBatchId ? { importBatchId } : {})
        });
      } catch (error: any) {
        errors.push({ row: rowNumber, error: error.message || 'Unknown error' });
      }
    }

    // Bulk check for duplicates (single query)
    const existingContacts = await Customer.find({
      organizationId,
      $or: [
        ...(duplicateEmails.length > 0 ? [{ email: { $in: duplicateEmails } }] : []),
        ...(duplicatePhones.length > 0 ? [{ phone: { $in: duplicatePhones } }] : [])
      ]
    }).lean();

    // Create lookup maps
    const emailMap = new Map(existingContacts.filter(c => c.email).map(c => [c.email!.toLowerCase(), c._id]));
    const phoneMap = new Map(existingContacts.filter(c => c.phone).map(c => [c.phone!, c._id]));

    // Filter out duplicates and prepare list members for existing contacts
    const contactsToInsert: any[] = [];
    let duplicateCount = 0;

    for (let i = 0; i < contactsToCreate.length; i++) {
      const contact = contactsToCreate[i];
      let isDuplicate = false;
      let existingId: any = null;

      if (contact.email && emailMap.has(contact.email.toLowerCase())) {
        existingId = emailMap.get(contact.email.toLowerCase());
        isDuplicate = true;
      } else if (contact.phone && phoneMap.has(contact.phone)) {
        existingId = phoneMap.get(contact.phone);
        isDuplicate = true;
      }

      if (isDuplicate && existingId) {
        // Add to list even if duplicate
        listMembersToCreate.push({
          contactId: existingId,
          listId
        });
        duplicateCount++;
      } else {
        contactsToInsert.push(contact);
      }
    }

    // Bulk insert new contacts
    let importedCount = 0;
    if (contactsToInsert.length > 0) {
      try {
        const insertedContacts = await Customer.insertMany(contactsToInsert, { ordered: false });
        importedCount = insertedContacts.length;

        // Prepare list members for new contacts
        const newListMembers = insertedContacts.map(contact => ({
          contactId: contact._id,
          listId
        }));

        listMembersToCreate.push(...newListMembers);
      } catch (error: any) {
        // Handle partial insert failures
        console.error('[CSV Import Service] Batch insert error:', error);
        if (error.writeErrors) {
          importedCount = contactsToInsert.length - error.writeErrors.length;
          error.writeErrors.forEach((writeError: any) => {
            const index = writeError.index;
            errors.push({ row: startRowNumber + index, error: writeError.errmsg || 'Insert failed' });
          });
        }
      }
    }

    // Bulk upsert list members
    if (listMembersToCreate.length > 0) {
      const bulkOps = listMembersToCreate.map(member => ({
        updateOne: {
          filter: { contactId: member.contactId, listId: member.listId },
          update: { $set: member },
          upsert: true
        }
      }));

      await ContactListMember.bulkWrite(bulkOps, { ordered: false }).catch((err) => {
        console.warn('[CSV Import Service] Some list members failed to upsert:', err.message);
      });
    }

    return {
      imported: importedCount,
      duplicates: duplicateCount,
      failed: errors.length,
      errors
    };
  }
}

export const csvImportService = new CSVImportService();
