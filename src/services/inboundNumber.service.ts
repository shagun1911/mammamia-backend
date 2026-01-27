import mongoose from 'mongoose';
import InboundNumber, { IInboundNumber } from '../models/InboundNumber';
import { AppError } from '../middleware/error.middleware';

export interface CreateInboundNumberData {
  phoneNumber: string;
  trunkId: string;
  provider?: string;
}

export class InboundNumberService {
  /**
   * Get all inbound numbers for a user
   */
  async getAll(userId: string): Promise<IInboundNumber[]> {
    try {
      console.log(`📞 [InboundNumber Service] Fetching all inbound numbers for User: ${userId}`);
      const numbers = await InboundNumber.find({ userId: new mongoose.Types.ObjectId(userId) }).sort({ createdAt: -1 });
      console.log(`✅ [InboundNumber Service] Found ${numbers.length} inbound number(s) in DB`);
      return numbers;
    } catch (error) {
      console.error('[InboundNumber Service] Get all error:', error);
      throw error;
    }
  }

  /**
   * Get inbound numbers as phone number strings array
   */
  async getPhoneNumbers(userId: string): Promise<string[]> {
    try {
      const numbers = await this.getAll(userId);
      return numbers.map(n => n.phoneNumber);
    } catch (error) {
      console.error('[InboundNumber Service] Get phone numbers error:', error);
      throw error;
    }
  }

  /**
   * Get inbound number by phone number
   */
  async getByPhoneNumber(userId: string, phoneNumber: string): Promise<IInboundNumber | null> {
    try {
      const number = await InboundNumber.findOne({ 
        userId: new mongoose.Types.ObjectId(userId), 
        phoneNumber 
      });
      return number;
    } catch (error) {
      console.error('[InboundNumber Service] Get by phone number error:', error);
      throw error;
    }
  }

  /**
   * Create or get existing inbound number
   * If exists, returns existing record (reuses trunkId)
   * If not, creates new record
   */
  async createOrGet(
    userId: string,
    data: CreateInboundNumberData
  ): Promise<{ inboundNumber: IInboundNumber; isNew: boolean }> {
    try {
      // Check if number already exists
      const existing = await this.getByPhoneNumber(userId, data.phoneNumber);
      
      if (existing) {
        console.log(`✅ [InboundNumber Service] Reusing inbound trunk for ${data.phoneNumber}. TrunkId: ${existing.trunkId}`);
        return { inboundNumber: existing, isNew: false };
      }

      // Create new record
      console.log(`🆕 [InboundNumber Service] Creating new inbound number record for ${data.phoneNumber}. TrunkId: ${data.trunkId}`);
      const inboundNumber = new InboundNumber({
        userId: new mongoose.Types.ObjectId(userId),
        phoneNumber: data.phoneNumber,
        trunkId: data.trunkId,
        provider: data.provider || 'livekit'
      });

      await inboundNumber.save();
      return { inboundNumber, isNew: true };
    } catch (error: any) {
      if (error.code === 11000) {
        // Duplicate key error - race condition, fetch existing
        console.log(`⚠️ [InboundNumber Service] Duplicate detected, fetching existing record for ${data.phoneNumber}`);
        const existing = await this.getByPhoneNumber(userId, data.phoneNumber);
        if (existing) {
          return { inboundNumber: existing, isNew: false };
        }
      }
      console.error('[InboundNumber Service] Create or get error:', error);
      throw error;
    }
  }

  /**
   * Create multiple inbound numbers
   * Returns array of created/existing records
   */
  async createMultiple(
    userId: string,
    phoneNumbers: string[],
    trunkId: string,
    provider?: string
  ): Promise<{ inboundNumbers: IInboundNumber[]; created: number; reused: number }> {
    try {
      const results = await Promise.all(
        phoneNumbers.map(phoneNumber =>
          this.createOrGet(userId, { phoneNumber, trunkId, provider })
        )
      );

      const created = results.filter(r => r.isNew).length;
      const reused = results.filter(r => !r.isNew).length;

      console.log(`📊 [InboundNumber Service] Created ${created} new, reused ${reused} existing inbound numbers`);

      return {
        inboundNumbers: results.map(r => r.inboundNumber),
        created,
        reused
      };
    } catch (error) {
      console.error('[InboundNumber Service] Create multiple error:', error);
      throw error;
    }
  }

  /**
   * Delete inbound number
   */
  async delete(userId: string, phoneNumber: string): Promise<void> {
    try {
      const result = await InboundNumber.deleteOne({ 
        userId: new mongoose.Types.ObjectId(userId), 
        phoneNumber 
      });
      if (result.deletedCount === 0) {
        throw new AppError(404, 'NOT_FOUND', `Inbound number ${phoneNumber} not found`);
      }
      console.log(`🗑️ [InboundNumber Service] Deleted inbound number ${phoneNumber}`);
    } catch (error) {
      console.error('[InboundNumber Service] Delete error:', error);
      throw error;
    }
  }

  /**
   * Delete all inbound numbers for a user
   */
  async deleteAll(userId: string): Promise<void> {
    try {
      await InboundNumber.deleteMany({ userId: new mongoose.Types.ObjectId(userId) });
      console.log(`🗑️ [InboundNumber Service] Deleted all inbound numbers for user`);
    } catch (error) {
      console.error('[InboundNumber Service] Delete all error:', error);
      throw error;
    }
  }
}

export const inboundNumberService = new InboundNumberService();
