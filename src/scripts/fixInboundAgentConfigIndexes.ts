import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://LOVJEET:LOVJEETMONGO@cluster0.zpzj90m.mongodb.net/IslandAI';

async function fixIndexes() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected successfully');

    const db = mongoose.connection.db;
    const collection = db?.collection('inbound-agent-config');

    if (!collection) {
      throw new Error('Collection not found');
    }

    // List current indexes
    console.log('\n=== Current Indexes ===');
    const indexes = await collection.indexes();
    console.log(JSON.stringify(indexes, null, 2));

    // Drop the old userId_1 index if it exists
    try {
      console.log('\n=== Dropping old userId_1 index ===');
      await collection.dropIndex('userId_1');
      console.log('✅ Successfully dropped userId_1 index');
    } catch (error: any) {
      if (error.code === 27 || error.message.includes('index not found')) {
        console.log('⚠️ userId_1 index does not exist (already dropped)');
      } else {
        throw error;
      }
    }

    // Ensure compound index exists
    console.log('\n=== Creating compound index ===');
    await collection.createIndex(
      { userId: 1, calledNumber: 1 },
      { unique: true, name: 'userId_1_calledNumber_1' }
    );
    console.log('✅ Successfully created compound index { userId: 1, calledNumber: 1 }');

    // List indexes after fix
    console.log('\n=== Indexes After Fix ===');
    const newIndexes = await collection.indexes();
    console.log(JSON.stringify(newIndexes, null, 2));

    console.log('\n✅ Index fix completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error fixing indexes:', error);
    process.exit(1);
  }
}

fixIndexes();

