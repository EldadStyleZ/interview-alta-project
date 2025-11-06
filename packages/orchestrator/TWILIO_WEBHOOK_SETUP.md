# Twilio Webhook Configuration - Final Step

## Your ngrok URL
**https://alvera-nontyrannic-mirian.ngrok-free.dev**

## Step-by-Step: Configure Twilio Webhooks

### 1. Go to Twilio Console
Open: https://console.twilio.com/us1/develop/phone-numbers/manage/incoming

### 2. Click Your Phone Number
Click on: **+97233822291**

### 3. Scroll to "Voice & Fax" Section

### 4. Configure "A CALL COMES IN"
Set these values:

- **Webhook:** `https://alvera-nontyrannic-mirian.ngrok-free.dev/twilio/voice/incoming`
- **Method:** `POST`

### 5. Configure "STATUS CALLBACK URL"
Set these values:

- **URL:** `https://alvera-nontyrannic-mirian.ngrok-free.dev/twilio/voice/status`
- **Method:** `POST`

### 6. Click "Save"

---

## After Configuration - Test It!

Once you've saved the webhooks, test with:

```bash
curl -X POST http://localhost:3000/api/calls/outbound \
  -H "Content-Type: application/json" \
  -d '{"to": "+972XXXXXXXXX"}'
```

Replace `+972XXXXXXXXX` with a test phone number.

---

## Expected Response

```json
{
  "call_sid": "CAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "status": "queued",
  "to": "+972***-***-XXXX",
  "from": "+972***-***-2291"
}
```

The call will:
1. ✅ Connect to the number
2. ✅ Play company identification
3. ✅ Ask for recording consent
4. ✅ Continue with demo prompt

---

## Need Help?

- Check server logs for errors
- Verify ngrok is still running: `ngrok http 3000`
- Check Twilio Console logs for call status

