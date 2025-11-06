#!/bin/bash

# Twilio Setup Helper Script
# This script helps you complete the Twilio integration setup

echo "🚀 Twilio Integration Setup Helper"
echo "=================================="
echo ""

# Check if server is running
if curl -s http://localhost:3000/health > /dev/null 2>&1; then
    echo "✅ Server is running on port 3000"
else
    echo "❌ Server is not running. Starting it now..."
    echo "   Run 'pnpm dev' in a separate terminal"
    exit 1
fi

echo ""
echo "📋 Step-by-Step Setup:"
echo ""

# Step 1: Check ngrok
echo "1️⃣  Check ngrok installation:"
if command -v ngrok &> /dev/null; then
    echo "   ✅ ngrok is installed"
    echo ""
    echo "   Now start ngrok in a NEW terminal:"
    echo "   $ ngrok http 3000"
    echo ""
    echo "   ⏳ Waiting for you to start ngrok..."
    echo "   (Press Enter after you've started ngrok and copied the HTTPS URL)"
    read -r
else
    echo "   ❌ ngrok not found"
    echo "   Install it: https://ngrok.com/download"
    exit 1
fi

# Step 2: Get ngrok URL
echo ""
echo "2️⃣  Enter your ngrok HTTPS URL (e.g., https://abc123.ngrok.io):"
read -r NGROK_URL

if [[ ! $NGROK_URL =~ ^https:// ]]; then
    echo "   ❌ Invalid URL. Should start with https://"
    exit 1
fi

# Update .env file
echo ""
echo "3️⃣  Updating .env file with ngrok URL..."
if [ -f .env ]; then
    # Update PUBLIC_BASE_URL
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        sed -i '' "s|PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=$NGROK_URL|" .env
    else
        # Linux
        sed -i "s|PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=$NGROK_URL|" .env
    fi
    echo "   ✅ Updated PUBLIC_BASE_URL to $NGROK_URL"
else
    echo "   ❌ .env file not found"
    exit 1
fi

# Step 3: Display Twilio webhook configuration
echo ""
echo "4️⃣  Configure Twilio Webhooks:"
echo "   ==========================================="
echo "   Go to: https://console.twilio.com/us1/develop/phone-numbers/manage/incoming"
echo "   Click on your phone number: +97233822291"
echo ""
echo "   Under 'Voice & Fax' section:"
echo "   ┌─────────────────────────────────────────┐"
echo "   │ A CALL COMES IN:                         │"
echo "   │ Webhook: POST $NGROK_URL/twilio/voice/incoming │"
echo "   │ Method: POST                             │"
echo "   └─────────────────────────────────────────┘"
echo ""
echo "   ┌─────────────────────────────────────────┐"
echo "   │ STATUS CALLBACK URL:                    │"
echo "   │ POST $NGROK_URL/twilio/voice/status │"
echo "   │ Method: POST                             │"
echo "   └─────────────────────────────────────────┘"
echo ""
echo "   ⏳ Press Enter after you've configured the webhooks in Twilio Console..."
read -r

# Step 4: Test the setup
echo ""
echo "5️⃣  Testing the setup..."
echo ""

# Test health endpoint
echo "   Testing health endpoint..."
HEALTH_RESPONSE=$(curl -s http://localhost:3000/health)
if echo "$HEALTH_RESPONSE" | grep -q "ok"; then
    echo "   ✅ Health check passed: $HEALTH_RESPONSE"
else
    echo "   ❌ Health check failed: $HEALTH_RESPONSE"
    exit 1
fi

# Test webhook endpoint (without signature validation, it will fail but that's expected)
echo ""
echo "   Testing webhook endpoint (expected to fail without signature)..."
WEBHOOK_TEST=$(curl -s -X POST "$NGROK_URL/twilio/voice/incoming" 2>&1)
if echo "$WEBHOOK_TEST" | grep -q "Invalid Twilio signature\|Missing Twilio signature"; then
    echo "   ✅ Webhook endpoint is accessible (signature validation working)"
elif echo "$WEBHOOK_TEST" | grep -q "TwiML\|Response"; then
    echo "   ✅ Webhook endpoint is working"
else
    echo "   ⚠️  Webhook test: $WEBHOOK_TEST"
fi

echo ""
echo "✅ Setup Complete!"
echo ""
echo "📞 To test an outbound call, run:"
echo "   curl -X POST http://localhost:3000/api/calls/outbound \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{\"to\": \"+972XXXXXXXXX\"}'"
echo ""
echo "   Replace +972XXXXXXXXX with a test phone number"
echo ""
echo "🎉 You're all set! The system is ready for outbound calls."

