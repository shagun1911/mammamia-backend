import mongoose, { Schema, Document } from 'mongoose';

export interface IContactListMember extends Document {
  contactId: mongoose.Types.ObjectId;
  listId: mongoose.Types.ObjectId;
  statusId?: mongoose.Types.ObjectId;
  addedAt: Date;
}

const ContactListMemberSchema = new Schema<IContactListMember>({
  contactId: {
    type: Schema.Types.ObjectId,
    ref: 'Customer',
    required: true
  },
  listId: {
    type: Schema.Types.ObjectId,
    ref: 'ContactList',
    required: true
  },
  statusId: {
    type: Schema.Types.ObjectId
  },
  addedAt: {
    type: Date,
    default: Date.now
  }
});

ContactListMemberSchema.index({ contactId: 1, listId: 1 }, { unique: true });

export default mongoose.model<IContactListMember>('ContactListMember', ContactListMemberSchema);

