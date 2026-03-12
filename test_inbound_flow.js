
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config();

const mongoUri = process.env.MONGODB_URI;

async function runTest() {
    if (!mongoUri) {
        console.error('MONGODB_URI not found in environment');
        process.exit(1);
    }

    console.log('Connecting to MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to DB');

    // Register models by requiring them
    // In our build system, models usually use export default, so we use .default
    const Conversation = require('./dist/models/Conversation').default;
    const Customer = require('./dist/models/Customer').default;
    const AutomationExecution = require('./dist/models/AutomationExecution').default;
    const Automation = require('./dist/models/Automation').default;
    const { automationService } = require('./dist/services/automation.service');

    const orgId = '6996f6cbe31f3e83072270df';
    const userId = '6996f6cbe31f3e83072270e2';
    const automationId = '69b2af0f02c6205569ed4682';

    // 0. Verify Automation exists and is active
    const auto = await Automation.findById(automationId);
    if (!auto) {
        console.error('❌ Automation not found:', automationId);
        process.exit(1);
    }
    console.log('Found Automation:', auto.name, '| Active:', auto.isActive);

    // 1. Create/Find a contact
    let contact = await Customer.findOne({ organizationId: orgId, phone: '+1234567890' });
    if (!contact) {
        contact = await Customer.create({
            organizationId: orgId,
            name: 'Test Inbound User',
            phone: '+1234567890',
            email: 'test@example.com'
        });
        console.log('✅ Created test contact');
    } else {
        console.log('✅ Using existing contact:', contact.name);
    }

    // 2. Create a conversation with a transcript for extraction
    // The transcript is designed to trigger the 'appointment' extraction
    const conversation = await Conversation.create({
        organizationId: orgId,
        userId: userId,
        customerId: contact._id,
        channel: 'phone',
        status: 'closed',
        transcript: [
            { role: 'user', message: 'Hello, I would like to book an appointment for March 15th at 3 PM.' },
            { role: 'ai', message: 'Sure, let me check. Yes, that time is available. Can I have your name?' },
            { role: 'user', message: 'Yes, my name is Test User.' },
            { role: 'ai', message: 'Great, I have booked it for you.' }
        ],
        metadata: {
            direction: 'inbound',
            start_time_unix_secs: Math.floor(Date.now() / 1000)
        }
    });
    console.log('✅ Created test conversation:', conversation._id);

    // 3. Trigger the automation
    console.log('\n🚀 Triggering inbound_call_completed event...');
    const triggerData = {
        event: 'inbound_call_completed',
        conversation_id: conversation._id.toString(),
        contactId: contact._id.toString(),
        organizationId: orgId,
        source: 'inbound_call',
        freshContactData: {
            name: contact.name,
            email: contact.email,
            phone: contact.phone
        }
    };

    try {
        await automationService.triggerByEvent('inbound_call_completed', triggerData, { organizationId: orgId });
        console.log('📡 Automation trigger initiated.');
    } catch (err) {
        console.error('❌ Trigger failed:', err.message);
    }

    console.log('\n⏳ Waiting 15 seconds for execution and extraction to complete...');
    console.log('(This involves OpenAI extraction, Google Sheets, etc.)');

    // Progress indicator
    let dots = 0;
    const interval = setInterval(() => {
        process.stdout.write('.');
        dots++;
        if (dots >= 15) clearInterval(interval);
    }, 1000);

    await new Promise(r => setTimeout(r, 15500));
    console.log('\n');

    // 4. Check results
    const executions = await AutomationExecution.find({
        automationId: automationId
    }).sort({ executedAt: -1 }).limit(1);

    if (executions.length > 0) {
        console.log('==========================================');
        console.log('📊 EXECUTION RESULT');
        console.log('==========================================');
        console.log('Status:', executions[0].status.toUpperCase());
        console.log('Timestamp:', executions[0].executedAt);
        if (executions[0].errorMessage) {
            console.log('❌ Error:', executions[0].errorMessage);
        }

        console.log('\n📝 Steps Log:');
        const logs = executions[0].actionData || {};
        Object.keys(logs).forEach(nodeId => {
            const step = logs[nodeId];
            console.log(`- Node ${nodeId}: ${step.status || (step.success ? 'Success' : 'Failed')}`);
            if (step.error) console.log(`  Error: ${step.error}`);
            if (step.appointment_booked !== undefined) console.log(`  Appointment Booked: ${step.appointment_booked}`);
            if (step.extracted_data) console.log(`  Extracted: ${JSON.stringify(step.extracted_data)}`);
        });
        console.log('==========================================');
    } else {
        console.log('❌ No execution logs found. The trigger might not have matched or execution is still pending.');
    }

    // Cleanup test data (optional)
    // await Conversation.deleteOne({ _id: conversation._id });

    process.exit(0);
}

runTest().catch(err => {
    console.error('❌ Script Error:', err);
    process.exit(1);
});
