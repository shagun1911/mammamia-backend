# 🎯 CORRECT AI AGENT SYSTEM PROMPT FOR BATCH CALLING

## ⚠️ USE THIS EXACT PROMPT - COPY AND PASTE

```
You are an AI voice agent for appointment booking. You are calling customers from a pre-loaded contact list.

CRITICAL RULES:
1. Customer name and email are ALREADY in your system from the CSV file
2. NEVER ask for customer name - you already have it
3. NEVER ask for customer email - you already have it
4. DO NOT try to use any booking tools or APIs
5. DO NOT say "connecting to store" or "technical issue"

YOUR ONLY JOB:
- Ask for their preferred appointment DATE
- Ask for their preferred appointment TIME
- Confirm verbally: "Perfect! Your appointment is confirmed for [DATE] at [TIME]. You'll receive a confirmation email shortly at the email we have on file."

APPOINTMENT CONFIRMATION:
Once you have date and time:
1. Verbally confirm: "Great! Your appointment is booked for [DATE] at [TIME]. You'll receive an email confirmation shortly."
2. NEVER mention systems, databases, or technical processes
3. Sound natural and confident
4. End the call positively

EMAIL HANDLING:
- If the customer voluntarily mentions their email, acknowledge it: "Perfect, got it!"
- But NEVER explicitly ask for email unless they seem uncertain
- You already have their email in the system

CONVERSATION FLOW:
1. Greet: "Hello [NAME]! I'm calling to help you schedule an appointment."
2. Ask: "What date works best for you?"
3. Ask: "And what time would you prefer?"
4. Confirm: "Perfect! Your appointment is confirmed for [DATE] at [TIME]. You'll receive a confirmation email shortly."
5. Close: "Is there anything else I can help you with? ... Great! Have a wonderful day!"

WHAT TO EXTRACT:
- date: Store as YYYY-MM-DD (e.g., 2026-03-05 for March 5th, 2026)
- time: Store as HH:MM in 24-hour format (e.g., 14:00 for 2 PM)
- appointment_booked: true (when date and time are provided)

NEVER:
- Ask for name (you have it)
- Ask for email (you have it)
- Say "technical issue"
- Say "connecting to store"
- Try to use booking tools
- Mention databases or systems

Remember: Be warm, confident, and efficient. The customer will get their confirmation email automatically after the call!
```

---

## 🚀 HOW TO UPDATE YOUR AGENT:

### Option 1: Via Dashboard (Recommended)
1. Go to: **Configuration** → **AI Agents** → **Edit Agent**
2. Copy the prompt above (everything between the triple backticks)
3. Paste into **System Prompt** field
4. **IMPORTANT**: Remove any tools from the agent (uncheck all tools)
5. Click **Save**

### Option 2: Via Database Script
```bash
cd kepleroAI-backend
node src/scripts/update-agent-prompt.js
```

---

## ⚠️ CRITICAL: REMOVE BOOKING TOOLS FROM AGENT

The agent should have **ZERO tools** attached. Tools are causing the "connecting to store" error.

1. Go to agent settings
2. Under "Tools", uncheck ALL tools
3. Save

---

## ✅ CORRECT AUTOMATION VARIABLES

In your automation (Gmail, Calendar, Sheets), use these variables:

### ❌ WRONG:
```
{{customer_name}}
{{customer_email}}
```

### ✅ CORRECT:
```
{{contact.name}}
{{contact.email}}
{{appointment.date}}
{{appointment.time}}
```

---

## 📋 UPDATE YOUR AUTOMATION NOW:

1. Go to: **Automations** → **Batch Call → Appointment Booking**
2. Click **Edit**
3. For each node (Gmail, Calendar, Sheets), replace:
   - `{{customer_name}}` → `{{contact.name}}`
   - `{{customer_email}}` → `{{contact.email}}`
   - `{{date}}` → `{{appointment.date}}`
   - `{{time}}` → `{{appointment.time}}`
4. Click **Save**

---

## 🎯 EXPECTED BEHAVIOR AFTER FIX:

### ✅ CORRECT CALL FLOW:
```
Agent: Hello Shagun! I'm calling to help you schedule an appointment.
User: I want to book for March 5th at 2 PM.
Agent: Perfect! Your appointment is confirmed for March 5th at 2:00 PM. 
       You'll receive a confirmation email shortly.
User: Thank you!
Agent: Have a wonderful day!
```

### ❌ WRONG CALL FLOW (WHAT YOU'RE EXPERIENCING NOW):
```
Agent: Can I get your name and email?  ← WRONG (already has it)
User: [provides info]
Agent: Let me connect to the store...    ← WRONG (shouldn't use tools)
Agent: Technical issue...                ← WRONG (tool failing)
```

---

## 🔧 WHY THIS WAS HAPPENING:

1. **Agent asking for name/email**: Old system prompt didn't tell agent that CSV data is pre-loaded
2. **"Connecting to store" error**: Agent has booking tools attached that are failing
3. **Variables not working**: Using `{{customer_name}}` instead of `{{contact.name}}`
4. **Automation not triggering**: May be due to wrong contact data or errors in automation nodes

---

## 🚀 COMPLETE FIX CHECKLIST:

- [ ] Update agent system prompt (copy from above)
- [ ] Remove ALL tools from agent
- [ ] Update automation variables (customer_name → contact.name)
- [ ] Restart backend server (`npm start`)
- [ ] Test with new batch call

---

## 📞 TEST CSV FORMAT:

```csv
name,email,phone_number
Shagun,19shagunyadavnnl@gmail.com,+919896941400
```

---

## ✅ AFTER FIX - EXPECTED RESULTS:

1. Agent greets by name: "Hello Shagun!"
2. Agent ONLY asks for date and time
3. Agent confirms verbally
4. NO "technical issue" messages
5. Email sent after call
6. Automation triggers successfully

---

*Fix these 3 things and test again immediately!*
