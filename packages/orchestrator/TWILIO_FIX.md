# ⚠️ Twilio Configuration Needs Update

## Current Issue

Looking at your Twilio configuration:

❌ **"A call comes in"** is set to: `https://demo.twilio.com/welcome/voice/`
✅ **"Primary handler fails"** is set to: `https://alvera-nontyrannic-mirian.ngrok-free.dev`

## What to Fix

### 1. Update "A call comes in" Webhook

**Change from:**
- URL: `https://demo.twilio.com/welcome/voice/`

**Change to:**
- Handler: `Webhook`
- URL: `https://alvera-nontyrannic-mirian.ngrok-free.dev/twilio/voice/incoming`
- HTTP Method: `HTTP POST`

### 2. Configure "Call status changes" (Status Callback)

**Set:**
- HTTP Method: `HTTP POST`
- URL: `https://alvera-nontyrannic-mirian.ngrok-free.dev/twilio/voice/status`

### 3. Keep "Primary handler fails" as is

- URL: `https://alvera-nontyrannic-mirian.ngrok-free.dev`
- HTTP Method: `HTTP POST`

## Steps to Fix

1. In the Twilio Console, click on your phone number: **+97233822291**

2. Scroll to **"Voice & Fax"** section

3. Under **"A CALL COMES IN"**:
   - Click to edit
   - Select **"Webhook"**
   - Enter: `https://alvera-nontyrannic-mirian.ngrok-free.dev/twilio/voice/incoming`
   - Method: `POST`

4. Under **"STATUS CALLBACK URL"** (Call Status Changes):
   - Enter: `https://alvera-nontyrannic-mirian.ngrok-free.dev/twilio/voice/status`
   - Method: `POST`

5. Click **"Save"**

## After Fixing

Once updated, test with:

```bash
curl -X POST http://localhost:3008/api/calls/outbound \
  -H "Content-Type: application/json" \
  -d '{"to": "+972XXXXXXXXX"}'
```

---

## Current Status

✅ Server running on port 3008
✅ ngrok configured
✅ Server ready
⚠️  Twilio webhook needs to point to your ngrok URL (not demo.twilio.com)


