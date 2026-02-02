// Script to fix batch call automation trigger
const mongoose = require('mongoose');
require('dotenv').config();

const AutomationSchema = new mongoose.Schema({
  name: String,
  description: String,
  isActive: Boolean,
  nodes: [{
    id: String,
    type: String,
    service: String,
    config: mongoose.Schema.Types.Mixed,
    position: Number
  }],
  userId: mongoose.Schema.Types.ObjectId,
  organizationId: mongoose.Schema.Types.ObjectId
});

const Automation = mongoose.model('Automation', AutomationSchema);

async function fixBatchAutomation() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Find automations with "Batch Call" in name that have wrong trigger
    const automations = await Automation.find({
      name: /Batch Call.*Appointment/i
    });

    console.log(`Found ${automations.length} batch call automations`);

    for (const automation of automations) {
      console.log(`\nAutomation: ${automation.name}`);
      console.log(`Active: ${automation.isActive}`);
      console.log(`Nodes: ${automation.nodes ? automation.nodes.length : 'null/undefined'}`);
      
      if (!automation.nodes || !Array.isArray(automation.nodes)) {
        console.log('⚠️ No nodes array found, skipping...');
        continue;
      }

      const triggerNode = automation.nodes.find(n => n.type === 'trigger');
      
      if (!triggerNode) {
        console.log(`⚠️ No trigger node found, skipping...`);
        continue;
      }

      console.log(`Current trigger service: ${triggerNode.service}`);
      console.log(`Current trigger config:`, JSON.stringify(triggerNode.config, null, 2));
      
      if (triggerNode.service !== 'batch_call_completed') {
        console.log('🔧 Fixing trigger...');
        
        // Update trigger node
        triggerNode.service = 'batch_call_completed';
        triggerNode.config = {
          event: 'batch_call_completed'
        };

        // Save
        await automation.save();
        console.log('✅ Fixed trigger to batch_call_completed');
      } else {
        console.log('✅ Trigger already correct');
        
        // Still check if config is minimal
        const configKeys = Object.keys(triggerNode.config || {});
        if (configKeys.length > 1 || (configKeys.length === 1 && configKeys[0] !== 'event')) {
          console.log('🔧 Simplifying trigger config...');
          triggerNode.config = {
            event: 'batch_call_completed'
          };
          await automation.save();
          console.log('✅ Simplified trigger config');
        }
      }
    }

    console.log('\n✅ All automations fixed!');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

fixBatchAutomation();
