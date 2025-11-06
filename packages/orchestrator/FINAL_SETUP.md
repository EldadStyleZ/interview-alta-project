# ✅ Final Setup - Port 3008

## Current Configuration

- **Server Port:** 3008
- **ngrok URL:** https://alvera-nontyrannic-mirian.ngrok-free.dev
- **ngrok Forwarding:** localhost:3008

## ✅ What's Done

1. ✅ Port changed to 3008 (no conflict with portfolio on 3000)
2. ✅ ngrok URL configured in `.env`
3. ✅ Twilio credentials configured

## 📋 Final Steps

### 1. Start the Server

```bash
cd packages/orchestrator
pnpm dev
```

The server should start on port 3008.

### 2. Verify It's Working

```bash
curl http://localhost:3008/health
```

Should return: `{"ok": true}`

### 3. Configure Twilio Webhooks (if not done)

Go to: https://console.twilio.com/us1/develop/phone-numbers/manage/incoming

Click your number: **+97233822291**

Set these webhooks:
- **A CALL COMES IN:** `https://alvera-nontyrannic-mirian.ngrok-free.dev/twilio/voice/incoming`
- **STATUS CALLBACK:** `https://alvera-nontyrannic-mirian.ngrok-free.dev/twilio/voice/status`

### 4. Test It!

Make a test call:

```bash
curl -X POST http://localhost:3008/api/calls/outbound \
  -H "Content-Type: application/json" \
  -d '{"to": "+972XXXXXXXXX"}'
```

Replace `+972XXXXXXXXX` with a test phone number.

---

## ✅ Everything is Configured!

Your system is ready. Just:
1. Start the server: `pnpm dev`
2. Make sure ngrok is running: `ngrok http 3008`
3. Test with a call!

---

## Troubleshooting

**Server won't start?**
- Check for TypeScript errors: `pnpm build`
- Make sure port 3008 is free: `lsof -ti:3008`

**ngrok not forwarding?**
- Verify ngrok is running: `ngrok http 3008`
- Check ngrok dashboard: http://localhost:4040

**Webhooks not working?**
- Verify webhook URLs in Twilio match exactly
- Check server logs for errors
- Ensure `TWILIO_AUTH_TOKEN` is correct in `.env`

