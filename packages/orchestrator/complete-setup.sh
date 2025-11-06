#!/bin/bash

# Complete Setup Script - Automates ngrok + .env update + Twilio config

echo "🚀 Completing Twilio Integration Setup"
echo "======================================"
echo ""

# Check if server is running
if ! curl -s http://localhost:3000/health > /dev/null 2>&1; then
    echo "❌ Server is not running on port 3000"
    echo "   Please start it first: pnpm dev"
    exit 1
fi
echo "✅ Server is running on port 3000"
echo ""

# Check if ngrok is running
NGROK_URL=""
if curl -s http://localhost:4040/api/tunnels > /dev/null 2>&1; then
    echo "✅ ngrok is already running"
    NGROK_URL=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    tunnels = [t for t in data.get('tunnels', []) if t.get('proto') == 'https' and 'localhost:3000' in t.get('config', {}).get('addr', '')]
    if tunnels:
        print(tunnels[0]['public_url'])
except:
    pass
" 2>/dev/null)
    
    if [ -n "$NGROK_URL" ]; then
        echo "   Found tunnel: $NGROK_URL"
    else
        echo "   ⚠️  ngrok is running but no tunnel found for port 3000"
    fi
fi

# If ngrok not running or no URL found, ask user
if [ -z "$NGROK_URL" ]; then
    echo "📡 Setting up ngrok..."
    echo ""
    echo "   Please start ngrok in a NEW terminal window:"
    echo "   $ ngrok http 3000"
    echo ""
    echo "   Then paste your ngrok HTTPS URL here (e.g., https://abc123.ngrok.io):"
    read -r NGROK_URL
    
    if [[ ! $NGROK_URL =~ ^https:// ]]; then
        echo "   ❌ Invalid URL. Should start with https://"
        exit 1
    fi
fi

echo ""
echo "3️⃣  Updating .env file..."

ENV_FILE=".env"
if [ ! -f "$ENV_FILE" ]; then
    echo "   ❌ .env file not found"
    exit 1
fi

# Update PUBLIC_BASE_URL
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    sed -i '' "s|PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=$NGROK_URL|" "$ENV_FILE"
else
    # Linux
    sed -i "s|PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=$NGROK_URL|" "$ENV_FILE"
fi

echo "   ✅ Updated PUBLIC_BASE_URL to $NGROK_URL"
echo ""

# Display Twilio configuration instructions
echo "4️⃣  Configure Twilio Webhooks:"
echo "   ==========================================="
echo ""
echo "   📍 Go to: https://console.twilio.com/us1/develop/phone-numbers/manage/incoming"
echo "   📍 Click on your phone number: +97233822291"
echo ""
echo "   Under 'Voice & Fax' section, configure:"
echo ""
echo "   ┌─────────────────────────────────────────────────────────────┐"
echo "   │ A CALL COMES IN:                                            │"
echo "   │                                                              │"
echo "   │ Webhook: POST $NGROK_URL/twilio/voice/incoming │"
echo "   │ Method: POST                                                │"
echo "   └─────────────────────────────────────────────────────────────┘"
echo ""
echo "   ┌─────────────────────────────────────────────────────────────┐"
echo "   │ STATUS CALLBACK URL:                                        │"
echo "   │                                                              │"
echo "   │ POST $NGROK_URL/twilio/voice/status │"
echo "   │ Method: POST                                                │"
echo "   └─────────────────────────────────────────────────────────────┘"
echo ""
echo "   ⏳ After configuring, press Enter to continue..."
read -r

echo ""
echo "5️⃣  Testing the setup..."
echo ""

# Test health endpoint
HEALTH_RESPONSE=$(curl -s http://localhost:3000/health)
if echo "$HEALTH_RESPONSE" | grep -q "ok"; then
    echo "   ✅ Health check: $HEALTH_RESPONSE"
else
    echo "   ⚠️  Health check: $HEALTH_RESPONSE"
fi

# Test webhook endpoint (without signature, will fail but shows it's accessible)
echo ""
echo "   Testing webhook endpoint..."
WEBHOOK_TEST=$(curl -s -X POST "$NGROK_URL/twilio/voice/incoming" 2>&1 | head -20)
if echo "$WEBHOOK_TEST" | grep -q "Invalid Twilio signature\|Missing Twilio signature"; then
    echo "   ✅ Webhook is accessible (signature validation working as expected)"
elif echo "$WEBHOOK_TEST" | grep -q "TwiML\|Response"; then
    echo "   ✅ Webhook is working"
else
    echo "   ⚠️  Webhook response: ${WEBHOOK_TEST:0:100}..."
fi

echo ""
echo "✅ Setup Complete!"
echo ""
echo "📞 Test an outbound call:"
echo ""
echo "   curl -X POST http://localhost:3000/api/calls/outbound \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{\"to\": \"+972XXXXXXXXX\"}'"
echo ""
echo "   Replace +972XXXXXXXXX with a test phone number"
echo ""
echo "🎉 Your system is ready for outbound calls!"

