# 🗣️ Full Conversation Brief - AI Outbound Booking System

## Overview
This document provides a complete conversation script for testing the AI-driven outbound booking system. Follow this guide step-by-step to test the full conversation flow.

---

## 🎯 **Scenario 1: Happy Path (Complete Booking)**

### Step 1: Initial Greeting
**AI Says:** "Hello! This is Alta calling. Is this a good time to talk?"

**You Say:** "Yes, this is a good time"

**Expected:** AI continues with recording consent

---

### Step 2: Recording Consent
**AI Says:** "Great! Thank you. For quality assurance, may I record this call? You can say yes or no."

**You Say:** "Yes, you can record"

**Expected:** AI continues to interest qualification

---

### Step 3: Interest & Meeting Invitation
**AI Says:** "Perfect! Thank you. We'd like to invite you to a brief discovery meeting where we can discuss how Alta can help address your needs. This would be a 30-minute conversation at a time that works for you. Would you be interested in scheduling this meeting?"

**You Say:** "Yes, I'm interested"

**Expected:** AI asks about time preferences

---

### Step 4: Time Preference
**AI Says:** "Excellent! When would be a good time for you?"

**You Say (choose one):**
- "Tomorrow at 2pm"
- "This afternoon"
- "Next week in the morning"
- "Today at 3pm"

**Expected:** AI confirms the time and asks for final confirmation

---

### Step 5: Confirmation
**AI Says:** "Perfect! I've noted [TIME] as your preferred time. Does that work for you?"

**You Say:** "Yes, that works"

**Expected:** AI confirms booking and ends call

---

### Step 6: Final Confirmation
**AI Says:** "Wonderful! I'll send you a calendar invitation right away. Thank you so much for your time, and have a great day!"

**Call Ends**

---

## 🚫 **Scenario 2: Opt-Out Path**

### Step 1: Initial Greeting
**AI Says:** "Hello! This is Alta calling. Is this a good time to talk?"

**You Say:** "Yes"

---

### Step 2: Recording Consent
**AI Says:** "Great! Thank you. For quality assurance, may I record this call? You can say yes or no."

**You Say:** "Yes"

---

### Step 3: Interest Question
**AI Says:** "Perfect! Thank you. We'd like to invite you to a brief discovery meeting..."

**You Say (any of these):**
- "Stop"
- "Remove me"
- "Opt out"
- "Don't call me"
- "Remove me from your list"

**Expected:** AI immediately acknowledges opt-out and ends call

---

### Step 4: Opt-Out Confirmation
**AI Says:** "I've noted your request. You will not receive further automated calls from Alta. Thank you for your time. Goodbye."

**Call Ends**

---

## ❌ **Scenario 3: Not Interested**

### Step 1: Initial Greeting
**AI Says:** "Hello! This is Alta calling. Is this a good time to talk?"

**You Say:** "Yes"

---

### Step 2: Recording Consent
**AI Says:** "Great! Thank you. For quality assurance, may I record this call? You can say yes or no."

**You Say:** "No, that's fine"

---

### Step 3: Interest Question
**AI Says:** "I understand. No problem. We'd like to invite you to a brief discovery meeting..."

**You Say (any of these):**
- "No, I'm not interested"
- "Not right now"
- "Maybe later"
- "I don't think so"

**Expected:** AI acknowledges and ends call politely

---

## 🕐 **Scenario 4: Bad Timing**

### Step 1: Initial Greeting
**AI Says:** "Hello! This is Alta calling. Is this a good time to talk?"

**You Say:** "No, not right now"

**Expected:** AI ends call politely

---

### Alternative Response
**AI Says:** "I understand. Perhaps another time would work better. Thank you for your time. Goodbye."

**Call Ends**

---

## 🎤 **Scenario 5: Recording Consent Denied**

### Step 1: Initial Greeting
**AI Says:** "Hello! This is Alta calling. Is this a good time to talk?"

**You Say:** "Yes"

---

### Step 2: Recording Consent
**AI Says:** "Great! Thank you. For quality assurance, may I record this call? You can say yes or no."

**You Say:** "No, I don't want to be recorded"

**Expected:** AI continues without recording, proceeds to interest question

---

### Step 3: Interest Question
**AI Says:** "I understand. No problem. We'd like to invite you to a brief discovery meeting..."

**Continue with Scenario 1 from here**

---

## 💬 **Scenario 6: Questions During Conversation**

At any point, you can ask questions:

**Example Questions:**
- "What is this about?"
- "Who are you?"
- "What does Alta do?"
- "How long will this take?"

**Expected:** AI should respond appropriately and continue the conversation flow

---

## 📝 **Key Phrases to Remember**

### Positive Responses:
- "Yes"
- "Sure"
- "Okay"
- "That works"
- "I'm interested"
- "Sounds good"
- "Absolutely"

### Negative Responses:
- "No"
- "Not interested"
- "Maybe later"
- "Not right now"

### Time Preferences:
- "Tomorrow at 2pm"
- "This afternoon"
- "Next week"
- "Today at 3pm"
- "Morning works"
- "Afternoon is better"

### Opt-Out Keywords:
- "Stop"
- "Remove me"
- "Opt out"
- "Don't call me"
- "Unsubscribe"

---

## 🧪 **Testing Checklist**

- [ ] Test happy path (complete booking)
- [ ] Test opt-out (say "stop" at any point)
- [ ] Test not interested response
- [ ] Test bad timing (say "no" to initial greeting)
- [ ] Test recording consent denied
- [ ] Test asking questions during conversation
- [ ] Test unclear responses (AI should ask for clarification)
- [ ] Test time preferences (various formats)

---

## 📞 **How to Make a Test Call**

```bash
curl -X POST http://localhost:3008/api/calls/outbound \
  -H "Content-Type: application/json" \
  -d '{"to": "+972545405337"}'
```

Then follow one of the scenarios above!

---

## 🎯 **Expected Conversation States**

1. **Greeting** → "Is this a good time?"
2. **Recording Consent** → "May I record this call?"
3. **Interest** → "Would you be interested in scheduling?"
4. **Qualify** → Captures name, company, needs
5. **Schedule** → "When would be a good time?"
6. **Confirm** → "Does [TIME] work for you?"
7. **End** → Final thank you and goodbye

---

## 💡 **Tips for Testing**

1. **Speak clearly** - The AI uses speech recognition
2. **Wait for prompts** - Don't interrupt the AI
3. **Use natural language** - You don't need exact phrases
4. **Test different paths** - Try various responses to see how the AI handles them
5. **Check logs** - Look at `/tmp/orchestrator.log` to see what's happening

---

## 🐛 **If Something Goes Wrong**

- **Call ends unexpectedly** → Check server logs for errors
- **AI doesn't understand** → Try rephrasing your response
- **No response** → Wait a few seconds, the AI might be processing
- **Wrong step** → The conversation state might have gotten confused - hang up and try again

---

**Happy Testing! 🚀**


