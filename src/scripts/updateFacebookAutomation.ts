import mongoose from 'mongoose';
import Automation from '../models/Automation';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/**
 * Script to update Facebook Lead Generation automation:
 * 1. Change trigger from facebook_lead to facebook_message
 * 2. Remove outbound call step
 * 3. Update trigger config
 */
async function updateFacebookAutomation() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/chatbot';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    // Find the automation by name
    const automation = await Automation.findOne({
      name: /Lead Generation.*Facebook.*Lead Form.*Copy/i
    });

    if (!automation) {
      console.log('❌ Automation not found. Looking for any Facebook automation...');
      
      // Try to find any facebook_lead automation
      const fbAutomation = await Automation.findOne({
        'nodes.service': 'facebook_lead'
      });

      if (fbAutomation) {
        console.log(`✅ Found automation: ${fbAutomation.name}`);
        await updateAutomationNodes(fbAutomation);
      } else {
        console.log('❌ No Facebook automation found');
      }
      
      return;
    }

    console.log(`✅ Found automation: ${automation.name}`);
    console.log(`Current trigger: ${automation.nodes[0]?.service}`);
    console.log(`Total nodes: ${automation.nodes.length}`);

    await updateAutomationNodes(automation);

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 MongoDB connection closed');
  }
}

async function updateAutomationNodes(automation: any) {
  console.log('\n📝 Updating automation...');

  // Step 1: Update trigger node
  const triggerNode = automation.nodes.find((n: any) => n.type === 'trigger');
  if (triggerNode) {
    console.log(`\n🔄 Updating trigger from "${triggerNode.service}" to "facebook_message"`);
    triggerNode.service = 'facebook_message';
    
    // Update config - remove formId, keep pageId if exists
    const oldConfig = triggerNode.config || {};
    triggerNode.config = {
      pageId: oldConfig.get?.('pageId') || oldConfig.pageId || '' // Keep pageId if exists, otherwise empty (triggers on all pages)
    };
    console.log(`✅ Trigger updated. Config:`, triggerNode.config);
  }

  // Step 2: Remove outbound call node
  const outboundCallIndex = automation.nodes.findIndex((n: any) => 
    n.service === 'keplero_outbound_call' || 
    n.service === 'outbound_call'
  );

  if (outboundCallIndex !== -1) {
    const removedNode = automation.nodes.splice(outboundCallIndex, 1);
    console.log(`\n🗑️  Removed outbound call node:`, removedNode[0].service);
  } else {
    console.log('\n⚠️  No outbound call node found (might already be removed)');
  }

  // Step 3: Update position numbers for remaining nodes
  automation.nodes.forEach((node: any, index: number) => {
    node.position = index;
  });

  // Step 4: Save automation
  await automation.save();
  console.log('\n✅ Automation updated successfully!');

  // Display updated structure
  console.log('\n📋 Updated automation structure:');
  automation.nodes.forEach((node: any, index: number) => {
    console.log(`  ${index + 1}. [${node.type}] ${node.service}`);
  });

  console.log(`\n🎯 Automation name: ${automation.name}`);
  console.log(`🔔 Active: ${automation.isActive}`);
  console.log(`👤 User ID: ${automation.userId}`);
}

// Run the script
updateFacebookAutomation();
