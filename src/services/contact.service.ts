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

  async findAll(organizationId: string, filters: any = {}, page = 1, limit = 30) {
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

  async bulkDelete(contactIds: string[], organizationId: string) {
    if (!contactIds || contactIds.length === 0) {
      return {
        deleted: 0,
        failed: 0
      };
    }

    // Convert string IDs to ObjectIds for proper querying
    const mongoose = (await import('mongoose')).default;
    const objectIds = contactIds
      .filter(id => id && mongoose.Types.ObjectId.isValid(id))
      .map(id => new mongoose.Types.ObjectId(id));

    if (objectIds.length === 0) {
      console.warn('[Contact Service] No valid contact IDs provided for bulk delete');
      return {
        deleted: 0,
        failed: contactIds.length
      };
    }

    // Verify all contacts belong to this organization before deleting
    const contacts = await Customer.find({
      _id: { $in: objectIds },
      organizationId
    }).select('_id').lean();

    const validContactIds = contacts.map(c => c._id);
    
    if (validContactIds.length === 0) {
      console.warn('[Contact Service] No contacts found for deletion (may not belong to organization)');
      return {
        deleted: 0,
        failed: contactIds.length
      };
    }

    console.log(`[Contact Service] Deleting ${validContactIds.length} contacts for organization ${organizationId}`);

    // Delete contacts and their list memberships
    const result = await Customer.deleteMany({ 
      _id: { $in: validContactIds },
      organizationId 
    });
    
    await ContactListMember.deleteMany({ 
      contactId: { $in: validContactIds } 
    });

    console.log(`[Contact Service] Successfully deleted ${result.deletedCount} contacts`);

    return {
      deleted: result.deletedCount || 0,
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

  async importFromCSV(listId: string, csvContent: string, defaultCountryCode: string, userId: string, organizationId: string) {
    console.log('[CSV Import Service] Starting optimized import for list:', listId);
    console.log('[CSV Import Service] CSV content length:', csvContent.length);

    // Verify list exists
    const list = await ContactList.findById(listId);
    if (!list) {
      throw new AppError(404, 'NOT_FOUND', 'List not found');
    }

    // Use streaming CSV import service for better performance
    const { csvImportService } = await import('./csvImport.service');
    const csvBuffer = Buffer.from(csvContent, 'utf-8');

    const result = await csvImportService.importFromStream(csvBuffer, {
      listId,
      defaultCountryCode,
      userId,
      organizationId
    });

    console.log('[CSV Import Service] Import complete:', result);

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
        // Get imported contact IDs (recent imports without importBatchId for backward compatibility)
        const recentContacts = await Customer.find({
          organizationId,
          source: 'import',
          createdAt: { $gte: new Date(Date.now() - 60000) } // Last minute
        })
        .sort({ createdAt: -1 })
        .limit(result.imported)
        .select('_id')
        .lean();

        if (recentContacts.length > 0) {
          const contactIds = recentContacts.map(c => (c._id as any).toString());
          
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
            }).catch(err => console.error('[CSV Import Service] Automation trigger error:', err));
            
            // Rate limit: wait 1 second between automation batches
            if (i + automationBatchSize < contactIds.length) {
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }
        }
      } else {
        console.log('[CSV Import Service] No active automations found, skipping trigger');
      }
    }

    return {
      imported: result.imported,
      failed: result.failed,
      duplicates: result.duplicates,
      errors: result.errors
    };
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

  async deleteAllContactsFromList(listId: string, organizationId: string) {
    const list = await ContactList.findById(listId);

    if (!list) {
      throw new AppError(404, 'NOT_FOUND', 'List not found');
    }

    // Verify organization ownership
    if (list.organizationId?.toString() !== organizationId) {
      throw new AppError(403, 'FORBIDDEN', 'Access denied');
    }

    // Get all contact IDs in this list
    const members = await ContactListMember.find({ listId });
    const contactIds = members.map(m => m.contactId);

    // Delete all list members
    await ContactListMember.deleteMany({ listId });

    // Delete contacts that are ONLY in this list (not in other lists)
    if (contactIds.length > 0) {
      const contactsInOtherLists = await ContactListMember.find({
        contactId: { $in: contactIds },
        listId: { $ne: listId }
      }).distinct('contactId');

      const contactsToDelete = contactIds.filter(
        id => !contactsInOtherLists.some(otherId => otherId.toString() === id.toString())
      );

      if (contactsToDelete.length > 0) {
        await Customer.deleteMany({
          _id: { $in: contactsToDelete },
          organizationId
        });
      }
    }

    return { 
      message: 'All contacts deleted from list',
      deletedCount: contactIds.length
    };
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

