# 🚀 QUICK START GUIDE - Batch Calling with Automation

## ✅ ALL FIXES HAVE BEEN APPLIED!

The following issues have been **FIXED**:
- ✅ Contact email mapping (supports both `email` and `customer_email`)
- ✅ Existing contacts updated with missing emails
- ✅ Automation engine handles missing date/time gracefully
- ✅ Enhanced logging for debugging
- ✅ Gmail integration verified (connected)

---

## 🎯 WHAT YOU NEED TO DO NOW

### **CRITICAL - Step 1: Restart Backend Server**

```bash
cd kepleroAI-backend
npm run dev
# OR
npm start
```

**Why**: The fixes won't take effect until you restart the server.

---

### **CRITICAL - Step 2: Update AI Agent System Prompt**

1. Open: `AGENT_SYSTEM_PROMPT_TEMPLATE.md` (in this folder)
2. Copy the entire system prompt
3. Go to your dashboard: **Configuration** → **AI Agents** → **Edit Agent**
4. Paste the prompt into the **System Prompt** field
5. Click **Save**

**Why**: This makes the AI agent verbally confirm appointments during calls.

---

### Step 3: Test with a New Batch Call

**Test CSV**:
```csv
name,email,phone_number
Test User,your-email@gmail.com,+1234567890
```

**Expected Results**:
1. ✅ AI agent confirms appointment verbally on the call
2. ✅ You receive confirmation email
3. ✅ Calendar event is created
4. ✅ Google Sheet is updated

---

## 📋 VERIFICATION CHECKLIST

Before running batch call:
- [ ] Backend server restarted
- [ ] Agent system prompt updated
- [ ] Gmail integration connected (Configuration → Integrations → Gmail)
- [ ] Google Calendar connected (Configuration → Integrations → Google)
- [ ] Google Sheets connected (Configuration → Integrations → Google)
- [ ] CSV has `name`, `email`, and `phone_number` columns

After batch call:
- [ ] Check conversation transcript shows appointment details
- [ ] Check your email inbox for confirmation
- [ ] Check Google Calendar for new event
- [ ] Check Google Sheet for new row
- [ ] Listen to call recording to verify verbal confirmation

---

## 🐛 TROUBLESHOOTING

### Issue: Emails still not sending

**Check 1**: Gmail integration
```bash
node src/scripts/check-gmail-integration.js
```

**Check 2**: Contact email
```bash
node src/scripts/check-contact-email.js
```

**Check 3**: Backend logs
```bash
# Look for email sending logs
grep "Gmail send" ~/.cursor/projects/*/terminals/*.txt | tail -20
```

---

### Issue: Agent not confirming verbally

**Solution**: Make sure you updated the agent system prompt (Step 2 above)

---

### Issue: Appointment extraction returns null date/time

**Possible Causes**:
1. User didn't provide clear date/time in conversation
2. Transcript is empty or incomplete
3. AI extraction model didn't detect appointment

**Solution**: 
- Check conversation transcript
- Ensure agent asks clearly for date and time
- Test with explicit date/time (e.g., "March 5th at 1 PM")

---

## 📚 DOCUMENTATION FILES

- `BATCH_CALLING_FIX_SUMMARY.md` - Complete technical details of all fixes
- `AGENT_SYSTEM_PROMPT_TEMPLATE.md` - Recommended agent prompt
- `QUICK_START_GUIDE.md` - This file

---

## 🎓 HOW IT WORKS NOW

```
┌─────────────────────────────────────────────────────┐
│  1. Upload CSV with name, email, phone_number       │
└───────────────────┬─────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│  2. Batch Call Service                              │
│     - Reads CSV                                     │
│     - Creates contacts with emails                  │
│     - Initiates calls                               │
└───────────────────┬─────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│  3. AI Agent on Call                                │
│     - Asks for appointment date                     │
│     - Asks for appointment time                     │
│     - ✅ CONFIRMS VERBALLY: "Your appointment is   │
│       confirmed for [DATE] at [TIME]"               │
└───────────────────┬─────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│  4. Call Completes - Automation Triggers            │
│     - Extracts appointment from transcript          │
│     - Checks if appointment.booked == true          │
│     - Validates date/time exist                     │
└───────────────────┬─────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│  5. Integration Actions (if date/time valid)        │
│     - ✅ Create Google Calendar event               │
│     - ✅ Add row to Google Sheet                    │
│     - ✅ Send confirmation email via Gmail          │
└─────────────────────────────────────────────────────┘
```

---

## 🎉 SUCCESS INDICATORS

You'll know everything is working when:

1. **During Call**: User hears "Your appointment is confirmed for [DATE] at [TIME]"
2. **After Call**: User receives email confirmation
3. **Calendar**: Event appears in Google Calendar
4. **Sheets**: New row appears with appointment details
5. **Dashboard**: Automation execution shows "Success" status

---

## 💪 YOU'RE READY!

1. Restart backend → `npm run dev`
2. Update agent prompt (copy from `AGENT_SYSTEM_PROMPT_TEMPLATE.md`)
3. Run a test batch call
4. Enjoy automated appointment booking! 🎉

---

*Questions? Check BATCH_CALLING_FIX_SUMMARY.md for technical details.*
