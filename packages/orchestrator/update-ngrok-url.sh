#!/bin/bash

# Script to update ngrok URL in .env file

if [ -z "$1" ]; then
  echo "Usage: ./update-ngrok-url.sh <ngrok-url>"
  echo "Example: ./update-ngrok-url.sh https://abc123.ngrok-free.dev"
  exit 1
fi

NGROK_URL=$1

# Remove trailing slash if present
NGROK_URL=${NGROK_URL%/}

# Update .env file
cd "$(dirname "$0")"

if [ -f .env ]; then
  # Backup .env
  cp .env .env.backup
  
  # Update PUBLIC_BASE_URL
  if grep -q "PUBLIC_BASE_URL=" .env; then
    # macOS/BSD sed
    sed -i '' "s|PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=$NGROK_URL|" .env
    echo "✅ Updated .env file with: $NGROK_URL"
  else
    echo "PUBLIC_BASE_URL=$NGROK_URL" >> .env
    echo "✅ Added PUBLIC_BASE_URL to .env: $NGROK_URL"
  fi
  
  echo ""
  echo "📋 Updated configuration:"
  grep PUBLIC_BASE_URL .env
  echo ""
  echo "⚠️  Don't forget to update Twilio webhooks:"
  echo "   Voice webhook: $NGROK_URL/twilio/voice/incoming"
  echo "   Status callback: $NGROK_URL/twilio/voice/status"
else
  echo "❌ .env file not found!"
  exit 1
fi


