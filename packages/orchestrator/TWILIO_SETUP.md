# Twilio Integration Setup Guide

This guide walks you through setting up Twilio for outbound calling with the AI-Driven Outbound Booking prototype.

## Prerequisites

1. **Twilio Account** with:
   - Account SID
   - API Key SID and Secret
   - Auth Token
   - A voice-capable phone number purchased

2. **ngrok** installed and configured
   - Free account is sufficient
   - ngrok linked to GitHub (optional, for persistent URLs)

3. **Node.js 20+** and **pnpm** installed

## Step 1: Install Dependencies

```bash
cd packages/orchestrator
pnpm install
```

This installs the `twilio` SDK.

## Step 2: Configure Environment Variables

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` and fill in your Twilio credentials:

```env
# Server Configuration
PORT=3000
NODE_ENV=development
GIT_SHA=unknown

# Public URL (ngrok URL - update after starting ngrok)
PUBLIC_BASE_URL=https://REPLACE_WITH_NGROK_URL

# Twilio Configuration
REGION=us1
TWILIO_ACCOUNT_SID=ACXXXXXXXXXXXX
TWILIO_API_KEY_SID=SKXXXXXXXXXXXX
TWILIO_API_KEY_SECRET=YOUR_SECRET_HERE
TWILIO_AUTH_TOKEN=YOUR_AUTH_TOKEN_HERE
TWILIO_VOICE_NUMBER=+1XXXXXXXXXX

# Call Configuration
COMPANY_NAME=Alta
CALL_PURPOSE=to schedule a short discovery meeting about our services
FEATURE_REQUIRE_RECORDING_CONSENT=true
TIMEZONE_DEFAULT=America/New_York
```

**Important:** Replace:
- `TWILIO_AUTH_TOKEN` with your actual Auth Token from Twilio Console
- `TWILIO_VOICE_NUMBER` with your purchased Twilio phone number (E.164 format: +1XXXXXXXXXX)
- `PUBLIC_BASE_URL` will be updated after starting ngrok (see Step 4)

## Step 3: Start Development Server

```bash
pnpm dev
```

The server should start on port 3000 (or your configured PORT).

Verify it's running:
```bash
curl http://localhost:3000/health
```

Expected response:
```json
{"ok": true}
```

## Step 4: Start ngrok

In a new terminal:

```bash
ngrok http 3000
```

ngrok will display a forwarding URL like:
```
Forwarding  https://abc123.ngrok.io -> http://localhost:3000
```

**Copy the HTTPS URL** (e.g., `https://abc123.ngrok.io`).

## Step 5: Update Environment with ngrok URL

Update `PUBLIC_BASE_URL` in your `.env` file:

```env
PUBLIC_BASE_URL=https://abc123.ngrok.io
```

**Note:** If using ngrok's GitHub integration for persistent URLs, you can use that URL instead.

## Step 6: Configure Twilio Webhooks

### 6.1 Configure Voice Webhook

1. Go to [Twilio Console](https://console.twilio.com)
2. Navigate to **Phone Numbers** → **Manage** → **Active Numbers**
3. Click on your purchased phone number
4. Under **Voice & Fax**, set:
   - **A CALL COMES IN**: Webhook
   - URL: `POST https://abc123.ngrok.io/twilio/voice/incoming`
   - Method: `POST`

### 6.2 Configure Status Callback

In the same phone number configuration:
- **STATUS CALLBACK URL**: `POST https://abc123.ngrok.io/twilio/voice/status`
- **STATUS CALLBACK METHOD**: `POST`

**Note:** Status callbacks are also configured per-call in the outbound call API, but setting them here ensures all calls are tracked.

## Step 7: Test Outbound Call

With the server running and ngrok active, test an outbound call:

```bash
curl -X POST http://localhost:3000/api/calls/outbound \
  -H "Content-Type: application/json" \
  -d '{"to": "+1XXXXXXXXXX"}'
```

Replace `+1XXXXXXXXXX` with a **consenting test number** (your own phone for testing).

**Expected response:**
```json
{
  "call_sid": "CAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "status": "queued",
  "to": "+1***-***-1234",
  "from": "+1***-***-5678"
}
```

## Step 8: Verify Call Flow

When the call connects, you should hear:

1. **Company identification** (first 10 seconds):
   - "This is Alta calling about to schedule a short discovery meeting about our services."

2. **Recording consent request**:
   - "For quality assurance, may I record this call? You can say yes or no."

3. **Demo prompt** (after consent):
   - "Thank you. We'd like to invite you to a brief discovery meeting..."
   - "Would you be interested in scheduling this meeting?"

4. **Opt-out handling**:
   - If you say "stop" or "remove me", you'll hear the opt-out confirmation.

## Call Flow Diagram

```
Outbound Call Initiated
    ↓
Call Connects → /twilio/voice/incoming
    ↓
Company ID + Purpose (10 seconds)
    ↓
Recording Consent Request
    ↓
[Yes] → Start Recording → Demo Prompt
[No] → Demo Prompt (no recording)
    ↓
Gather Response
    ↓
[Opt-out] → Opt-out Confirmation → End Call
[Other] → Thank you → End Call
```

## Status Callbacks

Status callbacks are logged to console with masked phone numbers:

```json
{
  "level": "info",
  "msg": "call_status",
  "call_sid": "CA...",
  "call_status": "answered",
  "direction": "outbound-api",
  "to": "+1***-***-1234",
  "from": "+1***-***-5678",
  "recording_url": "https://...",
  "recording_status": "completed"
}
```

## Security Features

1. **Webhook Signature Validation**: All `/twilio/*` endpoints verify Twilio signatures using the Auth Token
2. **PII Masking**: Phone numbers are masked in logs (last 4 digits only)
3. **No Secrets in Logs**: Auth tokens and API keys are never logged
4. **API Key Authentication**: Twilio client uses API Key SID/Secret (not Auth Token)

## Troubleshooting

### Issue: "Invalid Twilio signature"

- Ensure `TWILIO_AUTH_TOKEN` is correct in `.env`
- Verify ngrok URL matches `PUBLIC_BASE_URL`
- Check that webhook URLs in Twilio Console match ngrok URL

### Issue: "Call not connecting"

- Verify `TWILIO_VOICE_NUMBER` is correct (E.164 format)
- Check Twilio Console for call logs
- Ensure test number is valid and can receive calls

### Issue: "TwiML errors"

- Check server logs for errors
- Verify `PUBLIC_BASE_URL` is accessible from internet
- Test webhook endpoints directly: `curl https://abc123.ngrok.io/health`

### Issue: "Recording not starting"

- Verify consent response is being parsed correctly
- Check Twilio Console for recording status
- Ensure `recordingStatusCallback` URL is correct

## Production Considerations

1. **Persistent URLs**: Use ngrok's GitHub integration or deploy to a permanent domain
2. **Recording Storage**: Implement recording download and storage
3. **Error Handling**: Add retry logic for failed webhooks
4. **Rate Limiting**: Add rate limiting for outbound call endpoint
5. **Monitoring**: Set up alerts for failed calls or webhook errors

## Next Steps

- Integrate with existing booking flow
- Connect to lead database
- Add call transcription and analysis
- Implement call recording playback
- Add metrics dashboard

## Support

For issues:
1. Check Twilio Console logs
2. Review server logs (`pnpm dev` output)
3. Verify all environment variables are set
4. Test webhook endpoints with Postman/curl

