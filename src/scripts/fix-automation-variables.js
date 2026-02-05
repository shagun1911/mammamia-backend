// Script to fix automation variable names
const mongoose = require('mongoose');
require('dotenv').config();

const AutomationSchema = new mongoose.Schema({}, { strict: false });
const Automation = mongoose.model('Automation', AutomationSchema);

async function fixAutomationVariables() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Find batch call automation
    const automation = await Automation.findOne({
      name: /Batch Call.*Appointment Booking/i
    });

    if (!automation) {
      console.log('❌ Automation not found');
      process.exit(1);
    }

    console.log('📋 Automation:', automation.name);
    console.log('   ID:', automation._id);
    console.log('');

    let updated = false;

    // Update each node's config
    automation.nodes.forEach((node, index) => {
      if (node.config) {
        let configStr = JSON.stringify(node.config);
        const originalStr = configStr;

        // Replace variable names
        configStr = configStr.replace(/\{\{customer_name\}\}/g, '{{contact.name}}');
        configStr = configStr.replace(/\{\{customer_email\}\}/g, '{{contact.email}}');
        configStr = configStr.replace(/\{\{customer_phone_number\}\}/g, '{{contact.phone_number}}');
        
        // Fix date/time if they're using bare {{date}} instead of {{appointment.date}}
        configStr = configStr.replace(/\{\{date\}\}/g, '{{appointment.date}}');
        configStr = configStr.replace(/\{\{time\}\}/g, '{{appointment.time}}');

        if (configStr !== originalStr) {
          node.config = JSON.parse(configStr);
          updated = true;
          console.log(`✅ Updated node ${index + 1}: ${node.service}`);
          console.log('   Old variables: customer_name, customer_email, date, time');
          console.log('   New variables: contact.name, contact.email, appointment.date, appointment.time');
          console.log('');
        }
      }
    });

    if (updated) {
      await automation.save();
      console.log('\n🎉 Automation variables updated successfully!\n');
      console.log('Updated variables:');
      console.log('  {{customer_name}} → {{contact.name}}');
      console.log('  {{customer_email}} → {{contact.email}}');
      console.log('  {{date}} → {{appointment.date}}');
      console.log('  {{time}} → {{appointment.time}}');
    } else {
      console.log('\n✅ No variables needed updating (already using correct format)');
    }

    console.log('\n📋 Current automation structure:');
    automation.nodes.forEach((node, i) => {
      console.log(`${i + 1}. [${node.type}] ${node.service}`);
    });

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

fixAutomationVariables();
