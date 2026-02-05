// Check latest automation execution details
const mongoose = require('mongoose');
require('dotenv').config();

const AutomationExecutionSchema = new mongoose.Schema({}, { strict: false });
const AutomationExecution = mongoose.model('AutomationExecution', AutomationExecutionSchema);

async function checkAutomationExecution() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const organizationId = '698372de423bec058d58024a';

    // Find latest executions
    const executions = await AutomationExecution.find({
      organizationId: new mongoose.Types.ObjectId(organizationId)
    })
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();

    console.log(`📊 Latest ${executions.length} Automation Executions:\n`);

    executions.forEach((exec, i) => {
      console.log(`${i + 1}. Execution ID: ${exec._id}`);
      console.log(`   Automation: ${exec.automationId}`);
      console.log(`   Status: ${exec.status}`);
      console.log(`   Created: ${exec.createdAt}`);
      
      if (exec.errorMessage) {
        console.log(`   ❌ Error: ${exec.errorMessage}`);
      }
      
      if (exec.result) {
        console.log(`   Result:`, JSON.stringify(exec.result, null, 4));
      }
      
      console.log('');
    });

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkAutomationExecution();
