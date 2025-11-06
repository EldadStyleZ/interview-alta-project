# 🌐 Network Troubleshooting - University WiFi (eduroam)

## 🔍 The Problem

You're on **eduroam (university WiFi)** now, but it worked on **home WiFi**. This is likely a network restriction issue.

## 🚨 Common University WiFi Restrictions

1. **Blocked incoming connections** - eduroam often blocks incoming webhooks
2. **Firewall rules** - May block ngrok tunnels or specific ports
3. **VPN restrictions** - Some universities block VPN/tunneling services
4. **Port blocking** - Port 3008 or ngrok ports might be blocked
5. **Rate limiting** - May throttle external connections

## ✅ Quick Tests

### 1. Check if ngrok is running:
```bash
ps aux | grep ngrok
curl http://localhost:4040/api/tunnels
```

### 2. Test ngrok URL accessibility:
```bash
curl https://YOUR_NGROK_URL/health
```

### 3. Check if Twilio can reach your server:
- Look at Twilio Console → Monitor → Logs
- Check for webhook errors (403, 404, 500, timeout)

## 🔧 Solutions

### Option 1: Use Mobile Hotspot (Easiest)
Switch to your phone's mobile hotspot:
1. Turn on mobile hotspot on your phone
2. Connect your computer to the hotspot
3. Restart ngrok: `ngrok http 3008`
4. Update `.env` with new ngrok URL
5. Update Twilio webhooks

### Option 2: Use VPN
If your university allows VPN:
1. Connect to a VPN service
2. This might bypass some restrictions
3. Restart ngrok and test

### Option 3: Wait for Home WiFi
The simplest solution - test when you're back on home WiFi where it worked before.

### Option 4: Use ngrok with Reserved Domain (Paid)
If you have ngrok paid plan:
1. Use a reserved domain (doesn't change)
2. More reliable on restricted networks

### Option 5: Check University Firewall Rules
Some universities allow you to:
- Request port exceptions
- Whitelist specific services
- Use alternative ports

## 🧪 Diagnostic Steps

### Test 1: Is ngrok accessible?
```bash
# Start ngrok
ngrok http 3008

# In another terminal, test
curl https://YOUR_NGROK_URL/health
```

### Test 2: Can Twilio reach your server?
1. Make a test call
2. Check Twilio Console → Monitor → Logs
3. Look for webhook delivery errors

### Test 3: Check server logs
```bash
tail -f /tmp/orchestrator.log | grep -E "(twilio|webhook|error)"
```

## 📊 Expected Behavior

**On Home WiFi** ✅:
- ngrok tunnel works
- Twilio webhooks reach your server
- Calls work normally

**On eduroam** ❌:
- ngrok tunnel might not be accessible
- Twilio webhooks might timeout or fail
- Calls fail with "application error"

## 🎯 Recommended Action

**For now**: 
1. Try using mobile hotspot
2. Or wait until you're back on home WiFi

**For production**:
- Use a cloud server (AWS, Heroku, etc.)
- Or use a paid ngrok plan with reserved domain
- Or deploy to a service that provides public URLs

## 🔍 Check Current Status

Run these commands to diagnose:

```bash
# 1. Check if server is running
curl http://localhost:3008/health

# 2. Check if ngrok is running
curl http://localhost:4040/api/tunnels

# 3. Test ngrok URL from outside
curl https://YOUR_NGROK_URL/health

# 4. Check Twilio webhook logs
# (Go to Twilio Console → Monitor → Logs)
```

## 💡 Quick Fix Right Now

If you need to test immediately:

1. **Use mobile hotspot**:
   ```bash
   # Connect to phone hotspot
   # Then:
   ngrok http 3008
   # Copy new URL
   # Update .env
   # Update Twilio webhooks
   ```

2. **Or wait for home WiFi** - it worked there before!


