# 🔧 Quick Fix - ngrok Not Running

## The Problem
- ✅ Server is running on port 3008
- ❌ ngrok tunnel is not running
- ❌ Twilio can't reach your server → calls fail

## Quick Fix (2 minutes)

### Step 1: Start ngrok
Open a **new terminal window** and run:
```bash
ngrok http 3008
```

You'll see something like:
```
Forwarding   https://abc123.ngrok-free.dev -> http://localhost:3008
```

### Step 2: Copy the HTTPS URL
Copy the `https://` URL (not the http:// one)

### Step 3: Update .env
```bash
cd packages/orchestrator
# Edit .env file
# Change PUBLIC_BASE_URL to your new ngrok URL
PUBLIC_BASE_URL=https://YOUR_NEW_NGROK_URL
```

### Step 4: Restart Server (if needed)
```bash
# Kill existing server
lsof -ti:3008 | xargs kill -9

# Restart
pnpm dev
```

### Step 5: Update Twilio Webhooks
1. Go to [Twilio Console](https://console.twilio.com)
2. Phone Numbers → Manage → Active Numbers
3. Click on your number (+97233822291)
4. Update:
   - **Voice & Fax** → **A CALL COMES IN**: 
     ```
     POST https://YOUR_NEW_NGROK_URL/twilio/voice/incoming
     ```
   - **Status Callback URL**:
     ```
     POST https://YOUR_NEW_NGROK_URL/twilio/voice/status
     ```

### Step 6: Test
```bash
curl -X POST http://localhost:3008/api/calls/outbound \
  -H "Content-Type: application/json" \
  -d '{"to": "+972545405337"}'
```

## ⚠️ Important Notes

- **Keep ngrok running** - Don't close the terminal where ngrok is running
- **Free ngrok URLs change** - Each time you restart ngrok, you get a new URL
- **Update both .env AND Twilio** - Both need the new URL

## 🎯 One-Liner to Get ngrok URL

Once ngrok is running, get the URL:
```bash
curl -s http://localhost:4040/api/tunnels | grep -o 'https://[^"]*\.ngrok[^"]*' | head -1
```


