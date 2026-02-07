import mongoose, { Schema, Document } from 'mongoose';

export interface IPaymentIntent extends Document {
  app_intent: string; // Payment intent ID from frontend
  woo_order_id?: number; // WooCommerce order ID
  userId: mongoose.Types.ObjectId; // SaaS user ID
  planId: string; // Plan slug or ID
  status: 'pending' | 'active' | 'failed' | 'refunded';
  createdAt: Date;
  updatedAt: Date;
}

const PaymentIntentSchema = new Schema<IPaymentIntent>(
  {
    app_intent: {
      type: String,
      required: true,
      index: true
    },
    woo_order_id: {
      type: Number,
      index: true
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    planId: {
      type: String,
      required: true
    },
    status: {
      type: String,
      enum: ['pending', 'active', 'failed', 'refunded'],
      default: 'pending',
      index: true
    }
  },
  {
    timestamps: true
  }
);

// Compound index to ensure idempotency: one active payment intent per app_intent
PaymentIntentSchema.index({ app_intent: 1, status: 1 });

export default mongoose.model<IPaymentIntent>('PaymentIntent', PaymentIntentSchema);

