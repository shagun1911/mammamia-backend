import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../../.env') });

const MONGODB_URI = process.env.MONGODB_URI || '';

/**
 * Migration script to replace all "keplero_" prefixes with "aistein_" in automations
 * This ensures existing automations continue to work after the rebranding
 */

async function migrateKepleroToAistein() {
  try {
    console.log('🔄 Starting Keplero -> Aistein migration...');
    console.log('📡 Connecting to MongoDB...');
    
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const db = mongoose.connection.db;
    if (!db) {
      throw new Error('Database connection not established');
    }

    const automationsCollection = db.collection('automations');

    // Find all automations with keplero_ prefixes
    const automationsWithKeplero = await automationsCollection.find({
      'nodes.service': { $regex: /^keplero_/ }
    }).toArray();

    console.log(`\n📊 Found ${automationsWithKeplero.length} automations with keplero_ services\n`);

    if (automationsWithKeplero.length === 0) {
      console.log('✅ No automations to migrate');
      return;
    }

    let updatedCount = 0;

    // Update each automation
    for (const automation of automationsWithKeplero) {
      console.log(`📝 Migrating automation: ${automation.name} (${automation._id})`);
      
      // Update nodes with keplero_ services
      const updatedNodes = automation.nodes.map((node: any) => {
        if (node.service && node.service.startsWith('keplero_')) {
          const oldService = node.service;
          const newService = node.service.replace(/^keplero_/, 'aistein_');
          console.log(`   ├─ ${oldService} → ${newService}`);
          return {
            ...node,
            service: newService
          };
        }
        return node;
      });

      // Update the automation in the database
      await automationsCollection.updateOne(
        { _id: automation._id },
        { $set: { nodes: updatedNodes } }
      );

      updatedCount++;
      console.log(`   └─ ✅ Updated\n`);
    }

    console.log(`\n✅ Migration complete!`);
    console.log(`📊 Summary:`);
    console.log(`   - Total automations found: ${automationsWithKeplero.length}`);
    console.log(`   - Successfully migrated: ${updatedCount}`);

  } catch (error: any) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  } finally {
    await mongoose.connection.close();
    console.log('\n👋 Database connection closed');
  }
}

// Run the migration
migrateKepleroToAistein()
  .then(() => {
    console.log('\n🎉 Migration script completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Migration script failed:', error);
    process.exit(1);
  });
