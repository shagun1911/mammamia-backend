import Customer from '../models/Customer';
import ContactList from '../models/ContactList';
import ContactListMember from '../models/ContactListMember';
import CustomProperty from '../models/CustomProperty';
import Conversation from '../models/Conversation';
import { AppError } from '../middleware/error.middleware';
import { automationEngine } from './automationEngine.service';
import Papa from 'papaparse';

export class ContactService {
  // ===== Contacts =====

  async findAll(organizationId: string, filters: any = {}, page = 1, limit = 20) {
    const query: any = { organizationId };

    // Filter by list
    if (filters.listId && filters.listId !== 'list_all') {
      const members = await ContactListMember.find({ listId: filters.listId });
      const contactIds = members.map(m => m.contactId);
      query._id = { $in: contactIds };
    }

    // Search
    if (filters.search) {
      query.$or = [
        { name: { $regex: filters.search, $options: 'i' } },
        { email: { $regex: filters.search, $options: 'i' } },
        { phone: { $regex: filters.search, $options: 'i' } }
      ];
    }

    // Filter by tags
    if (filters.tags) {
      const tagsArray = filters.tags.split(',');
      query.tags = { $in: tagsArray };
    }

    const skip = (page - 1) * limit;
    const total = await Customer.countDocuments(query);

    const contacts = await Customer.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    // Get list memberships for each contact
    const contactsWithLists = await Promise.all(
      contacts.map(async (contact: any) => {
        const memberships = await ContactListMember.find({ contactId: contact._id })
          .populate('listId', 'name')
          .lean();

        const conversationCount = await Conversation.countDocuments({
          customerId: contact._id
        });

        return {
          ...contact,
          lists: memberships.map((m: any) => m.listId),
          conversationsCount: conversationCount
        };
      })
    );

    return {
      items: contactsWithLists,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1
      }
    };
  }

  async findById(contactId: string, organizationId: string) {
    const contact = await Customer.findById(contactId).lean();

    if (!contact) {
      throw new AppError(404, 'NOT_FOUND', 'Contact not found');
    }

    // CRITICAL: Verify ownership - contact must belong to user's organization
    const contactOrgId = (contact as any).organizationId?.toString();
    const userOrgId = organizationId.toString();
    
    if (contactOrgId !== userOrgId) {
      throw new AppError(403, 'FORBIDDEN', 'You do not have access to this contact');
    }

    // Get lists
    const memberships = await ContactListMember.find({ contactId })
      .populate('listId', 'name kanbanEnabled')
      .lean();

    // Get last conversation
    const lastConversation = await Conversation.findOne({ customerId: contactId })
      .sort({ updatedAt: -1 })
      .lean();

    const conversationsCount = await Conversation.countDocuments({ customerId: contactId });

    return {
      ...contact,
      lists: memberships.map((m: any) => ({
        id: m.listId._id,
        name: m.listId.name,
        statusId: m.statusId
      })),
      conversationsCount,
      lastConversation: lastConversation ? {
        id: lastConversation._id,
        date: lastConversation.updatedAt,
        status: lastConversation.status
      } : null
    };
  }

  async create(contactData: any) {
    const { lists, organizationId, ...customerData } = contactData;

    // Validate required fields
    if (!customerData.name) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Contact name is required');
    }

    if (!organizationId) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Organization ID is required');
    }

    // Check if contact already exists (by email and organizationId, or phone and organizationId)
    const duplicateQuery: any = { organizationId };
    if (contactData.email) {
      duplicateQuery.email = contactData.email.toLowerCase().trim();
    } else if (contactData.phone) {
      duplicateQuery.phone = contactData.phone;
    }

    if (contactData.email || contactData.phone) {
      const existing = await Customer.findOne(duplicateQuery);
      if (existing) {
        throw new AppError(409, 'DUPLICATE', 'Contact with this email or phone already exists in this organization');
      }
    }

    // Validate lists exist before creating contact (to prevent partial saves)
    if (lists && lists.length > 0) {
      const existingLists = await ContactList.find({ 
        _id: { $in: lists },
        organizationId 
      });
      if (existingLists.length !== lists.length) {
        throw new AppError(400, 'VALIDATION_ERROR', 'One or more contact lists not found');
      }
    }

    // Create contact with organizationId
    const contact = await Customer.create({
      ...customerData,
      organizationId,
      email: customerData.email ? customerData.email.toLowerCase().trim() : undefined
    });

    // Add to lists (only after contact is successfully created)
    if (lists && lists.length > 0) {
      try {
        await this.addToLists((contact._id as any).toString(), lists);
      } catch (listError: any) {
        // If adding to lists fails, delete the contact to maintain consistency
        await Customer.findByIdAndDelete(contact._id);
        throw new AppError(500, 'LIST_ERROR', `Failed to add contact to lists: ${listError.message}`);
      }
    }

    // Trigger automation for contact created (non-blocking)
    // Pass context with organizationId so automations can filter correctly
    // Note: userId will be resolved from organization ownerId in executeAutomation if not provided
    automationEngine.triggerByEvent('keplero_contact_created', {
      event: 'contact_created',
      contactId: contact._id,
      organizationId: organizationId,
      contact: {
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        tags: contact.tags
      }
    }, {
      organizationId: organizationId
      // userId will be resolved from organization ownerId if needed
    }).catch(err => console.error('Automation trigger error:', err));

    return contact;
  }

  async update(contactId: string, contactData: any, organizationId: string) {
    const { lists, ...updateData } = contactData;

    const contact = await Customer.findById(contactId);

    if (!contact) {
      throw new AppError(404, 'NOT_FOUND', 'Contact not found');
    }

    // CRITICAL: Verify ownership - contact must belong to user's organization
    const contactOrgId = contact.organizationId?.toString();
    const userOrgId = organizationId.toString();
    
    if (contactOrgId !== userOrgId) {
      throw new AppError(403, 'FORBIDDEN', 'You do not have access to this contact');
    }

    // Check for duplicate email/phone in the same organization (excluding current contact)
    const orgId = contact.organizationId || updateData.organizationId || organizationId;
    if (updateData.email || updateData.phone) {
      const duplicateQuery: any = { 
        organizationId: orgId,
        _id: { $ne: contactId }
      };
      
      if (updateData.email) {
        duplicateQuery.email = updateData.email.toLowerCase().trim();
      } else if (updateData.phone) {
        duplicateQuery.phone = updateData.phone;
      }

      const existing = await Customer.findOne(duplicateQuery);
      if (existing) {
        throw new AppError(409, 'DUPLICATE', 'Contact with this email or phone already exists in this organization');
      }
    }

    // Update fields
    if (updateData.email) {
      updateData.email = updateData.email.toLowerCase().trim();
    }
    Object.assign(contact, updateData);
    await contact.save();

    // Update lists if provided
    if (lists) {
      // Remove from all current lists
      await ContactListMember.deleteMany({ contactId });
      
      // Add to new lists
      if (lists.length > 0) {
        await this.addToLists(contactId, lists);
      }
    }

    return contact;
  }

  async delete(contactId: string, organizationId: string) {
    const contact = await Customer.findById(contactId);

    if (!contact) {
      throw new AppError(404, 'NOT_FOUND', 'Contact not found');
    }

    // CRITICAL: Verify ownership - contact must belong to user's organization
    const contactOrgId = contact.organizationId?.toString();
    const userOrgId = organizationId.toString();
    
    if (contactOrgId !== userOrgId) {
      throw new AppError(403, 'FORBIDDEN', 'You do not have access to this contact');
    }

    // Trigger automation for contact deleted (before deletion)
    // Use the organizationId we already have (contactOrgId is already a string)
    const contactOrgIdForAutomation = contact.organizationId;
    automationEngine.triggerByEvent('keplero_contact_deleted', {
      event: 'contact_deleted',
      contactId: contact._id,
      organizationId: contactOrgIdForAutomation,
      contact: {
        name: contact.name,
        email: contact.email,
        phone: contact.phone
      }
    }, {
      organizationId: contactOrgIdForAutomation
    }).catch(err => console.error('Automation trigger error:', err));

    // Delete the contact
    await Customer.findByIdAndDelete(contactId);

    // Remove from all lists
    await ContactListMember.deleteMany({ contactId });

    return { message: 'Contact deleted successfully' };
  }

  async bulkDelete(contactIds: string[]) {
    const result = await Customer.deleteMany({ _id: { $in: contactIds } });
    await ContactListMember.deleteMany({ contactId: { $in: contactIds } });

    return {
      deleted: result.deletedCount,
      failed: contactIds.length - (result.deletedCount || 0)
    };
  }

  async addToLists(contactId: string, listIds: string[]) {
    const members = listIds.map(listId => ({
      contactId,
      listId
    }));

    await ContactListMember.insertMany(members, { ordered: false })
      .catch(err => {
        // Ignore duplicate key errors
        if (err.code !== 11000) throw err;
      });
  }

  async bulkAddToList(contactIds: string[], listId: string) {
    const members = contactIds.map(contactId => ({
      contactId,
      listId
    }));

    await ContactListMember.insertMany(members, { ordered: false })
      .catch(err => {
        if (err.code !== 11000) throw err;
      });

    // Trigger automation for each contact moved to list
    for (const contactId of contactIds) {
      const contact = await Customer.findById(contactId);
      const contactOrgId = contact ? (contact as any).organizationId : null;
      automationEngine.triggerByEvent('keplero_contact_moved', {
        event: 'contact_moved',
        organizationId: contactOrgId,
        contactId,
        listId
      }, {
        organizationId: contactOrgId
      }).catch(err => console.error('Automation trigger error:', err));
    }

    return { added: contactIds.length };
  }

  async importFromCSV(listId: string, csvContent: string, defaultCountryCode: string) {
    console.log('[CSV Import Service] Starting import for list:', listId);
    console.log('[CSV Import Service] CSV content length:', csvContent.length);
    
    return new Promise((resolve, reject) => {
      const results: any[] = [];
      const errors: any[] = [];
      const duplicates: string[] = [];

      // Get organization ID from the list first (before processing rows)
      ContactList.findById(listId).then(list => {
        if (!list) {
          reject(new AppError(404, 'NOT_FOUND', 'List not found'));
          return;
        }

        const organizationId = list.organizationId;

        Papa.parse(csvContent, {
          header: true,
          skipEmptyLines: true,
          transformHeader: (header: string) => {
            // Normalize headers: trim whitespace, handle case variations
            return header.trim().toLowerCase();
          },
          transform: (value: string) => {
            // Clean and trim values
            return value ? value.trim() : '';
          },
          complete: async (parseResult: any) => {
            const rows = parseResult.data as any[];
            console.log('[CSV Import Service] Parsed rows:', rows.length);
            console.log('[CSV Import Service] First row:', rows[0]);
            console.log('[CSV Import Service] Headers:', parseResult.meta?.fields);

            for (let i = 0; i < rows.length; i++) {
              const row = rows[i];

              try {
                // Extract fields (headers are already normalized to lowercase by transformHeader)
                const name = (row.name || '').trim();
                const email = (row.email || '').trim().toLowerCase();
                let phone = (row.phone || '').trim();
                const company = (row.company || '').trim();
                const notes = (row.notes || '').trim();
                const tagsStr = (row.tags || '').trim();
                const tags = tagsStr ? tagsStr.split(',').map((t: string) => t.trim()).filter(Boolean) : [];

                // Validate required fields
                if (!name) {
                  errors.push({ row: i + 2, error: 'Name is required' }); // +2 because header is row 1
                  continue;
                }

                // Normalize phone number
                if (phone) {
                  // Remove all non-digit characters
                  phone = phone.replace(/\D/g, '');
                  // Add country code if not present
                  if (phone && !phone.startsWith('+')) {
                    const countryCode = defaultCountryCode.replace(/\D/g, '');
                    phone = `+${countryCode}${phone}`;
                  } else if (phone && !phone.startsWith('+')) {
                    phone = `+${phone}`;
                  }
                }

                // Build metadata object for company and notes
                const metadata: Record<string, any> = {};
                if (company) metadata.company = company;
                if (notes) metadata.notes = notes;

                // Check for duplicates WITHIN the same organization
                const duplicateQuery: any = {
                  organizationId: organizationId
                };

                const duplicateConditions: any[] = [];
                if (email) duplicateConditions.push({ email: email.toLowerCase() });
                if (phone) duplicateConditions.push({ phone: phone });

                if (duplicateConditions.length > 0) {
                  duplicateQuery.$or = duplicateConditions;
                  
                  const existing = await Customer.findOne(duplicateQuery);

                  if (existing) {
                    duplicates.push(email || phone || name);
                    
                    // Add to list even if duplicate
                    await ContactListMember.findOneAndUpdate(
                      { contactId: existing._id, listId },
                      { contactId: existing._id, listId },
                      { upsert: true, new: true }
                    ).catch(() => {});
                    
                    continue;
                  }
                }

                // Create contact with organization ID
                const contact = await Customer.create({
                  name,
                  email: email || undefined,
                  phone: phone || undefined,
                  organizationId: organizationId,
                  tags,
                  source: 'import',
                  metadata: Object.keys(metadata).length > 0 ? metadata : undefined
                });

                // Add to list
                await ContactListMember.create({
                  contactId: contact._id,
                  listId
                });

                results.push(contact);
                console.log('[CSV Import Service] Created contact:', contact._id, contact.name);

              } catch (error: any) {
                console.error(`[CSV Import Service] Error on row ${i + 2}:`, error.message);
                console.error(`[CSV Import Service] Row data:`, row);
                errors.push({ row: i + 2, error: error.message || 'Unknown error' });
              }
            }

            const summary = {
              imported: results.length,
              failed: errors.length,
              duplicates: duplicates.length,
              errors: errors.slice(0, 10) // Return max 10 errors
            };
            
            console.log('[CSV Import Service] Import complete:', summary);
            resolve(summary);
          },
          error: (error: any) => {
            console.error('[CSV Import Service] Parse error:', error);
            reject(new AppError(400, 'VALIDATION_ERROR', `CSV parsing error: ${error.message}`));
          }
        });
      }).catch(error => {
        console.error('[CSV Import Service] Error fetching list:', error);
        reject(new AppError(404, 'NOT_FOUND', 'List not found'));
      });
    });
  }

  async updateContactStatus(contactId: string, listId: string, statusId: string | null) {
    const member = await ContactListMember.findOne({ contactId, listId });

    if (!member) {
      throw new AppError(404, 'NOT_FOUND', 'Contact not in this list');
    }

    member.statusId = statusId as any;
    await member.save();

    return member;
  }

  // ===== Lists =====

  async findAllLists(organizationId: string) {
    const lists = await ContactList.find({ organizationId }).sort({ createdAt: -1 }).lean();

    const listsWithCount = await Promise.all(
      lists.map(async (list: any) => {
        const count = await ContactListMember.countDocuments({ listId: list._id });
        return {
          ...list,
          contactCount: count
        };
      })
    );

    return listsWithCount;
  }

  async createList(organizationId: string, listData: { name: string; kanbanEnabled?: boolean }) {
    const existing = await ContactList.findOne({ name: listData.name, organizationId });
    if (existing) {
      throw new AppError(409, 'DUPLICATE', 'List with this name already exists');
    }

    const list = await ContactList.create({ ...listData, organizationId });
    return list;
  }

  async updateList(listId: string, listData: any) {
    const list = await ContactList.findById(listId);

    if (!list) {
      throw new AppError(404, 'NOT_FOUND', 'List not found');
    }

    if (list.isSystem) {
      throw new AppError(403, 'FORBIDDEN', 'Cannot modify system lists');
    }

    Object.assign(list, listData);
    await list.save();

    return list;
  }

  async deleteList(listId: string) {
    const list = await ContactList.findById(listId);

    if (!list) {
      throw new AppError(404, 'NOT_FOUND', 'List not found');
    }

    if (list.isSystem) {
      throw new AppError(403, 'FORBIDDEN', 'Cannot delete system lists');
    }

    await list.deleteOne();
    await ContactListMember.deleteMany({ listId });

    return { message: 'List deleted successfully' };
  }

  // ===== Kanban Statuses =====

  async createStatus(listId: string, statusData: { name: string; color?: string; order: number }) {
    const list = await ContactList.findById(listId);

    if (!list) {
      throw new AppError(404, 'NOT_FOUND', 'List not found');
    }

    if (!list.kanbanEnabled) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Kanban is not enabled for this list');
    }

    list.kanbanStatuses.push({
      name: statusData.name,
      color: statusData.color || '#6366f1',
      order: statusData.order
    });

    await list.save();

    return list;
  }

  async updateStatus(listId: string, statusId: string, statusData: any) {
    const list = await ContactList.findById(listId);

    if (!list) {
      throw new AppError(404, 'NOT_FOUND', 'List not found');
    }

    const status = (list.kanbanStatuses as any).id(statusId);

    if (!status) {
      throw new AppError(404, 'NOT_FOUND', 'Status not found');
    }

    Object.assign(status, statusData);
    await list.save();

    return list;
  }

  async deleteStatus(listId: string, statusId: string) {
    const list = await ContactList.findById(listId);

    if (!list) {
      throw new AppError(404, 'NOT_FOUND', 'List not found');
    }

    list.kanbanStatuses = list.kanbanStatuses.filter(
      (s: any) => s._id.toString() !== statusId
    ) as any;

    await list.save();

    // Remove status from all members
    await ContactListMember.updateMany(
      { listId, statusId },
      { $unset: { statusId: "" } }
    );

    return { message: 'Status deleted successfully' };
  }

  // ===== Custom Properties =====

  async findAllCustomProperties(organizationId: string) {
    return await CustomProperty.find({ organizationId }).sort({ createdAt: -1 });
  }

  async createCustomProperty(propertyData: { name: string; dataType: 'string' | 'number' }) {
    const existing = await CustomProperty.findOne({ name: propertyData.name });
    if (existing) {
      throw new AppError(409, 'DUPLICATE', 'Property with this name already exists');
    }

    const property = await CustomProperty.create(propertyData);
    return property;
  }

  async deleteCustomProperty(propertyId: string) {
    const property = await CustomProperty.findByIdAndDelete(propertyId);

    if (!property) {
      throw new AppError(404, 'NOT_FOUND', 'Property not found');
    }

    // Remove property from all contacts
    await Customer.updateMany(
      {},
      { $unset: { [`customProperties.${property.name}`]: "" } }
    );

    return { message: 'Custom property deleted successfully' };
  }
}

export const contactService = new ContactService();

