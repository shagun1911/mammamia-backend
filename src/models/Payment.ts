import mongoose, { Schema, Document } from 'mongoose';

/**
 * Payment Model - Single Source of Truth for Payment Activation Status
 * 
 * This model acts as the bridge between WooCommerce webhook and frontend UI.
 * The webhook writes activation status here, and the frontend polls this to
 * determine when a plan has been activated.
 * 
 * IMPORTANT: Plans are NEVER activated from redirect URLs.
 * Plans are ONLY activated inside the WooCommerce webhook handler.
 */
export interface IPayment extends Document {
  intent: string; // Payment intent ID (e.g., "wc_xxx")
  userId: mongoose.Types.ObjectId; // SaaS user ID
  plan: string; // Plan slug (normalized, e.g., "mileva", "pro")
  status: 'pending' | 'active' | 'failed'; // Payment activation status
  wooOrderId?: number; // WooCommerce order ID
  activatedAt?: Date; // When the plan was activated
  createdAt: Date;
  updatedAt: Date;
}

const PaymentSchema = new Schema<IPayment>(
  {
    intent: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    plan: {
      type: String,
      required: true
    },
    status: {
      type: String,
      enum: ['pending', 'active', 'failed'],
      default: 'pending',
      index: true
    },
    wooOrderId: {
      type: Number,
      index: true
    },
    activatedAt: {
      type: Date
    }
  },
  {
    timestamps: true
  }
);

// Compound index for efficient lookups
PaymentSchema.index({ intent: 1, status: 1 });

export default mongoose.model<IPayment>('Payment', PaymentSchema);

