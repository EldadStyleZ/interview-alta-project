# ⚠️ Twilio API Key Credentials Issue

## Problem

The Twilio API Key credentials appear to be swapped or incorrect:

- `TWILIO_API_KEY_SID` = `YOUR_API_KEY_SID` (doesn't start with SK)
- `TWILIO_API_KEY_SECRET` = `YOUR_API_KEY_SECRET` (starts with SK - wrong!)

## Correct Format

For Twilio API Keys:
- **API Key SID**: Must start with `SK` and be 34 characters
- **API Key Secret**: Must NOT start with `SK` and be 32+ characters

## How to Fix

1. Go to: https://console.twilio.com/us1/develop/api-keys
2. Find your API Key (or create a new one)
3. Copy the correct values:
   - **SID**: Should start with `SK...` (34 chars)
   - **Secret**: Should NOT start with `SK` (32+ chars)

4. Update your `.env` file:

```env
TWILIO_API_KEY_SID=SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_API_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Make sure the SID starts with `SK` and the Secret does NOT.

## After Updating

Restart the server:
```bash
# Stop current server (Ctrl+C)
cd packages/orchestrator
pnpm dev
```

Then try the call again:
```bash
curl -X POST http://localhost:3008/api/calls/outbound \
  -H "Content-Type: application/json" \
  -d '{"to": "+972545405337"}'
```

---

**Note**: The values might be swapped - try swapping them if the current format doesn't match above.


