# Port Change: 3000 → 3001

## ✅ Issue Fixed

Your portfolio website is using port 3000, so we've changed the orchestrator server to use **port 3001**.

## 📋 What You Need to Do

### 1. Update ngrok to Forward Port 3001

**Stop your current ngrok** (if running on port 3000) and restart it:

```bash
# Stop current ngrok (Ctrl+C in that terminal)
# Then start it forwarding to port 3001:
ngrok http 3001
```

### 2. Get Your New ngrok URL

After starting ngrok on port 3001, you'll see a new URL like:
```
Forwarding  https://new-url.ngrok.io -> http://localhost:3001
```

**Copy the new HTTPS URL** (it will be different from before).

### 3. Update .env File

Once you have the new ngrok URL, I'll update your `.env` file with it. Or you can tell me the new URL and I'll do it automatically.

### 4. Update Twilio Webhooks

After getting the new ngrok URL, update your Twilio webhooks:
- Go to: https://console.twilio.com/us1/develop/phone-numbers/manage/incoming
- Click your number: +97233822291
- Update webhook URLs to your new ngrok URL

### 5. Restart the Server

The server should now start on port 3001. Start it with:

```bash
cd packages/orchestrator
pnpm dev
```

---

## ✅ Quick Test

After everything is configured:

```bash
# Test health endpoint
curl http://localhost:3001/health

# Should return: {"ok": true}
```

---

## Summary

- ✅ Server port changed to 3001
- ⏳ You need to: Restart ngrok on port 3001
- ⏳ You need to: Get new ngrok URL and update Twilio webhooks

