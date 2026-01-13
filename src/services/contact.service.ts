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

  async findById(contactId: string) {
    const contact = await Customer.findById(contactId).lean();

    if (!contact) {
      throw new AppError(404, 'NOT_FOUND', 'Contact not found');
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
    const { lists, ...customerData } = contactData;

    // Check if contact already exists
    if (contactData.email) {
      const existing = await Customer.findOne({ email: contactData.email });
      if (existing) {
        throw new AppError(409, 'DUPLICATE', 'Contact with this email already exists');
      }
    }

    const contact = await Customer.create(customerData);

    // Add to lists
    if (lists && lists.length > 0) {
      await this.addToLists((contact._id as any).toString(), lists);
    }

    // Trigger automation for contact created
    automationEngine.triggerByEvent('contact_created', {
      event: 'contact_created',
      contactId: contact._id,
      contact: {
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        tags: contact.tags
      }
    }).catch(err => console.error('Automation trigger error:', err));

    return contact;
  }

  async update(contactId: string, contactData: any) {
    const { lists, ...updateData } = contactData;

    const contact = await Customer.findById(contactId);

    if (!contact) {
      throw new AppError(404, 'NOT_FOUND', 'Contact not found');
    }

    // Update fields
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

  async delete(contactId: string) {
    const contact = await Customer.findById(contactId);

    if (!contact) {
      throw new AppError(404, 'NOT_FOUND', 'Contact not found');
    }

    // Trigger automation for contact deleted (before deletion)
    automationEngine.triggerByEvent('contact_deleted', {
      event: 'contact_deleted',
      contactId: contact._id,
      contact: {
        name: contact.name,
        email: contact.email,
        phone: contact.phone
      }
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
      automationEngine.triggerByEvent('contact_moved', {
        event: 'contact_moved',
        contactId,
        listId
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

      Papa.parse(csvContent, {
        header: true,
        skipEmptyLines: true,
        complete: async (parseResult) => {
          const rows = parseResult.data as any[];
          console.log('[CSV Import Service] Parsed rows:', rows.length);
          console.log('[CSV Import Service] First row:', rows[0]);

          for (let i = 0; i < rows.length; i++) {
            const row = rows[i];

            try {
              const name = row.name || row.Name || '';
              const email = row.email || row.Email || '';
              let phone = row.phone || row.Phone || '';
              const tags = row.tags ? row.tags.split(',').map((t: string) => t.trim()) : [];

              if (!name) {
                errors.push({ row: i + 1, error: 'Name is required' });
                continue;
              }

              // Normalize phone number
              if (phone && !phone.startsWith('+')) {
                phone = defaultCountryCode + phone.replace(/\D/g, '');
              }

              // Check for duplicates
              const existing = await Customer.findOne({
                $or: [
                  { email: email || undefined },
                  { phone: phone || undefined }
                ].filter(Boolean)
              });

              if (existing) {
                duplicates.push(email || phone || name);
                
                // Add to list even if duplicate
                await ContactListMember.create({
                  contactId: existing._id,
                  listId
                }).catch(() => {});
                
                continue;
              }

              // Get organization ID from the list
              const list = await ContactList.findById(listId);
              if (!list) {
                errors.push({ row: i + 1, error: 'List not found' });
                continue;
              }

              // Create contact with organization ID (if list has one)
              const contact = await Customer.create({
                name,
                email: email || undefined,
                phone: phone || undefined,
                organizationId: list.organizationId || undefined,
                tags,
                source: 'csv_import',
                company: row.company || row.Company || undefined,
                notes: row.notes || row.Notes || undefined
              });

              // Add to list
              await ContactListMember.create({
                contactId: contact._id,
                listId
              });

              results.push(contact);
              console.log('[CSV Import Service] Created contact:', contact._id, contact.name);

            } catch (error: any) {
              console.error(`[CSV Import Service] Error on row ${i + 1}:`, error.message);
              errors.push({ row: i + 1, error: error.message });
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

