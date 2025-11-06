# Quick Start Guide - Twilio Integration

## Automated Setup (Recommended)

Run the setup script:

```bash
cd packages/orchestrator
./setup-twilio.sh
```

This script will guide you through:
1. ✅ Checking if server is running
2. 📡 Starting ngrok (you'll need to do this manually in a new terminal)
3. 🔗 Updating your .env file with the ngrok URL
4. ⚙️  Configuring Twilio webhooks (instructions provided)
5. ✅ Testing the setup

---

## Manual Setup (Alternative)

### Step 1: Start the Server

The server should already be running. Verify:

```bash
curl http://localhost:3000/health
```

Expected: `{"ok": true}`

If not running, start it:
```bash
cd packages/orchestrator
pnpm dev
```

### Step 2: Start ngrok

**Open a NEW terminal window** and run:

```bash
ngrok http 3000
```

You'll see output like:
```
Forwarding  https://abc123.ngrok.io -> http://localhost:3000
```

**Copy the HTTPS URL** (e.g., `https://abc123.ngrok.io`)

### Step 3: Update .env File

Edit `packages/orchestrator/.env` and update:

```env
PUBLIC_BASE_URL=https://abc123.ngrok.io
```

Replace `abc123.ngrok.io` with your actual ngrok URL.

### Step 4: Configure Twilio Webhooks

1. Go to [Twilio Console - Phone Numbers](https://console.twilio.com/us1/develop/phone-numbers/manage/incoming)

2. Click on your phone number: **+97233822291**

3. Scroll to **Voice & Fax** section

4. Set **A CALL COMES IN**:
   - **Webhook**: `POST https://your-ngrok-url/twilio/voice/incoming`
   - **Method**: `POST`

5. Set **STATUS CALLBACK URL**:
   - **URL**: `POST https://your-ngrok-url/twilio/voice/status`
   - **Method**: `POST`

6. Click **Save**

### Step 5: Test It!

Make a test call:

```bash
curl -X POST http://localhost:3000/api/calls/outbound \
  -H "Content-Type: application/json" \
  -d '{"to": "+972XXXXXXXXX"}'
```

Replace `+972XXXXXXXXX` with a test phone number (your own number for testing).

**Expected response:**
```json
{
  "call_sid": "CAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "status": "queued",
  "to": "+972***-***-XXXX",
  "from": "+972***-***-2291"
}
```

The call should connect and you'll hear:
1. Company identification
2. Recording consent request
3. Demo prompt

---

## Troubleshooting

### Server not running?
```bash
cd packages/orchestrator
pnpm dev
```

### ngrok not installed?
Install from: https://ngrok.com/download

### Webhook signature errors?
- Verify `TWILIO_AUTH_TOKEN` is correct in `.env`
- Ensure ngrok URL matches `PUBLIC_BASE_URL` in `.env`
- Check that webhook URLs in Twilio match your ngrok URL exactly

### Can't make calls?
- Verify your Twilio number is active in Twilio Console
- Check Twilio Console logs for call status
- Ensure test number can receive calls
- Verify you have sufficient Twilio credits

---

## Need Help?

Check the full setup guide: `TWILIO_SETUP.md`

