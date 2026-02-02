// Script to create proper batch call automation
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
  organizationId: mongoose.Schema.Types.ObjectId,
  createdAt: Date,
  updatedAt: Date
});

const Automation = mongoose.model('Automation', AutomationSchema);

async function createBatchAutomation() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Find and delete old broken automation
    const oldAutomation = await Automation.findOne({
      name: 'Batch Call → Appointment Booking (Copy)'
    });

    if (oldAutomation) {
      console.log('Found old automation, deleting...');
      await Automation.deleteOne({ _id: oldAutomation._id });
      console.log('✅ Deleted old automation');
    }

    // Get userId and organizationId from existing automation
    const anyAutomation = await Automation.findOne();
    if (!anyAutomation) {
      console.error('❌ No existing automations found. Cannot determine userId/organizationId');
      process.exit(1);
    }

    const userId = anyAutomation.userId;
    const organizationId = anyAutomation.organizationId;

    console.log(`Using userId: ${userId}, organizationId: ${organizationId}`);

    // Create new automation with proper structure
    const newAutomation = new Automation({
      name: 'Batch Call → Appointment Booking',
      description: 'When batch calling completes, extract appointments from conversations, create calendar events, and log to Google Sheets',
      isActive: true,
      userId: userId,
      organizationId: organizationId,
      nodes: [
        {
          id: 'node_1',
          type: 'trigger',
          service: 'batch_call_completed',
          config: {
            event: 'batch_call_completed'
          },
          position: 0
        },
        {
          id: 'node_2',
          type: 'action',
          service: 'keplero_extract_appointment',
          config: {
            conversation_id: '{{conversation_id}}',
            extraction_type: 'appointment'
          },
          position: 1
        },
        {
          id: 'node_3',
          type: 'condition',
          service: 'condition',
          config: {
            field: 'appointment.booked',
            operator: 'equals',
            value: true
          },
          position: 2
        },
        {
          id: 'node_4',
          type: 'action',
          service: 'keplero_google_calendar_create_event',
          config: {
            summary: 'Appointment - {{contact.name}}',
            description: 'Booked via AI batch call\nConversation ID: {{conversation_id}}\nPhone: {{contact.phone}}',
            startTime: '{{appointment.date}}T{{appointment.time}}:00Z',
            endTime: '{{appointment.date}}T{{appointment.time_plus_30}}:00Z',
            timeZone: 'UTC',
            attendees: [{ email: '{{contact.email}}' }]
          },
          position: 3
        },
        {
          id: 'node_5',
          type: 'action',
          service: 'keplero_google_sheet_append_row',
          config: {
            spreadsheetId: '',
            range: 'Sheet1!A1',
            values: [
              '{{contact.name}}',
              '{{contact.phone}}',
              '{{contact.email}}',
              '{{appointment.date}}',
              '{{appointment.time}}',
              'Booked',
              '{{batch_id}}',
              '{{conversation_id}}',
              '{{now}}'
            ]
          },
          position: 4
        },
        {
          id: 'node_6',
          type: 'action',
          service: 'keplero_google_gmail_send',
          config: {
            to: '{{contact.email}}',
            subject: 'Appointment Confirmed - {{contact.name}}',
            body: 'Hi {{contact.name}},\n\nYour appointment has been confirmed for {{appointment.date}} at {{appointment.time}}.\n\nWe\'ll call you at the scheduled time.\n\nThank you!',
            isHtml: false
          },
          position: 5
        }
      ],
      createdAt: new Date(),
      updatedAt: new Date()
    });

    await newAutomation.save();
    console.log('\n✅ Created new batch call automation successfully!');
    console.log(`Automation ID: ${newAutomation._id}`);
    console.log(`Active: ${newAutomation.isActive}`);
    console.log(`Nodes: ${newAutomation.nodes.length}`);
    console.log('\n⚠️  IMPORTANT: Configure the spreadsheetId in node 5 (Google Sheets)');

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

createBatchAutomation();
