# Step-by-Step Configuration Guide

This guide walks you through everything needed to configure and run the AI-Driven Outbound Booking prototype.

## Prerequisites

Before starting, ensure you have:
- **Node.js 18+** installed (check with `node --version`)
- **pnpm 8+** installed (check with `pnpm --version`, install with `npm install -g pnpm`)
- **Terminal/Command line** access
- **Git** (optional, for version control)

---

## Step 1: Clone/Navigate to Project

```bash
cd "/Users/eldad/job interview projects/ai-outbound-booking"
```

Or if cloning from a repository:
```bash
git clone <repository-url>
cd ai-outbound-booking
```

---

## Step 2: Install Dependencies

Install all project dependencies using pnpm:

```bash
pnpm install
```

**Expected output:** Packages are downloaded and installed. This may take 1-2 minutes.

**Verify:** Check that `node_modules` directories exist in `packages/orchestrator/`.

---

## Step 3: Configure Environment Variables (Optional)

Environment variables are optional but recommended for customization.

### Create `.env` file:

```bash
cd packages/orchestrator
touch .env
```

### Edit `.env` file with:

```env
# Server Configuration
PORT=3000
NODE_ENV=development

# Optional: Git SHA for health checks
GIT_SHA=unknown

# Optional: Analytics Configuration
# ANALYTICS_LOG_PATH=./data/events.log
```

**Default values** (if `.env` is not created):
- `PORT`: 3000
- `NODE_ENV`: development
- `GIT_SHA`: "unknown"

**Note:** The `.env` file is gitignored, so you can safely add local configuration.

---

## Step 4: Verify Directory Structure

Ensure the analytics data directory exists (created automatically, but verify):

```bash
# From project root
mkdir -p packages/orchestrator/data
```

**Verify structure:**
```
ai-outbound-booking/
├── packages/
│   └── orchestrator/
│       ├── src/          ✓ (source code)
│       ├── tests/        ✓ (test files)
│       ├── data/         ✓ (analytics logs)
│       └── .env          ✓ (optional, created in Step 3)
└── package.json          ✓
```

---

## Step 5: Build TypeScript (Optional for Development)

The project uses TypeScript. For development, `nodemon` auto-compiles. For production:

```bash
# From project root
cd packages/orchestrator
pnpm build
```

**Note:** Development mode (`pnpm dev`) auto-compiles with `nodemon`, so this step is optional.

---

## Step 6: Run Tests (Smoke Test)

Verify everything is configured correctly by running tests:

```bash
# From project root
pnpm test
```

**Expected result:** All tests pass with green checkmarks.

**What this verifies:**
- TypeScript compilation works
- All dependencies are installed correctly
- Core functionality (policy, calendar, booking, analytics) works
- No configuration errors

**If tests fail:**
- Check Node.js version: `node --version` (must be 18+)
- Check pnpm version: `pnpm --version` (must be 8+)
- Reinstall dependencies: `rm -rf node_modules packages/*/node_modules && pnpm install`
- Check for TypeScript errors: `pnpm --filter orchestrator build`

---

## Step 7: Start Development Server

Start the orchestrator service:

```bash
# From project root
pnpm dev
```

**Expected output:**
```
[nodemon] starting `ts-node src/index.ts`
Server listening on port 3000
```

**Verify health endpoint:**
Open a new terminal and run:
```bash
curl http://localhost:3000/healthz
```

**Expected response:**
```json
{
  "service": "orchestrator",
  "git_sha": "unknown",
  "status": "healthy"
}
```

---

## Step 8: Configure API Testing (Optional)

### Option A: VS Code REST Client

1. **Install REST Client extension:**
   - Open VS Code
   - Go to Extensions (Cmd+Shift+X / Ctrl+Shift+X)
   - Search for "REST Client" by Huachao Mao
   - Click Install

2. **Open test file:**
   - Open `docs/tests/api-tests.http`
   - Click "Send Request" links above each request

### Option B: IntelliJ HTTP Client

1. Open `docs/tests/api-tests.http` in IntelliJ IDEA or WebStorm
2. Click the green play button next to each request

### Option C: cURL (Command Line)

Run requests manually:
```bash
# Health check
curl http://localhost:3000/healthz

# Seed manager calendar
curl -X POST http://localhost:3000/dev/seed/managerCalendar \
  -H "Content-Type: application/json"

# Seed test leads
curl -X POST http://localhost:3000/dev/seed/leads \
  -H "Content-Type: application/json"
```

---

## Step 9: Verify Data Directory Permissions

The analytics bus writes to `packages/orchestrator/data/events.log`. Ensure write permissions:

```bash
# From project root
chmod -R 755 packages/orchestrator/data
```

**Verify write access:**
```bash
touch packages/orchestrator/data/test.log
rm packages/orchestrator/data/test.log
```

If this fails, check directory ownership and permissions.

---

## Step 10: Run Full Smoke Test Suite

Execute the complete smoke test:

```bash
# Terminal 1: Start server
pnpm dev

# Terminal 2: Run tests
pnpm test
```

**All tests should pass:**
- ✅ Health endpoint
- ✅ Policy validators
- ✅ Calendar operations
- ✅ Booking flow
- ✅ CRM integration
- ✅ Analytics logging
- ✅ Attempt scheduling
- ✅ State machine
- ✅ Speech adapters
- ✅ Telephony mocks

---

## Configuration Checklist

Use this checklist to verify configuration:

- [ ] **Dependencies installed** (`pnpm install` completed)
- [ ] **Environment variables set** (`.env` file created, optional)
- [ ] **Data directory exists** (`packages/orchestrator/data/` exists)
- [ ] **Tests pass** (`pnpm test` shows all green)
- [ ] **Server starts** (`pnpm dev` runs without errors)
- [ ] **Health endpoint responds** (`curl http://localhost:3000/healthz` returns 200)
- [ ] **Analytics logs writable** (can write to `data/events.log`)
- [ ] **API tests work** (REST Client or cURL requests return 2xx)

---

## Troubleshooting Common Issues

### Issue: "Command not found: pnpm"

**Solution:**
```bash
npm install -g pnpm
```

### Issue: "Port 3000 already in use"

**Solution:**
1. Find process using port: `lsof -i :3000` (macOS/Linux) or `netstat -ano | findstr :3000` (Windows)
2. Kill process or change PORT in `.env`:
   ```env
   PORT=3001
   ```

### Issue: "Cannot find module"

**Solution:**
```bash
# Clean install
rm -rf node_modules packages/*/node_modules pnpm-lock.yaml
pnpm install
```

### Issue: "TypeScript compilation errors"

**Solution:**
```bash
# Check TypeScript version
pnpm --filter orchestrator exec tsc --version

# Rebuild
pnpm --filter orchestrator build
```

### Issue: "Analytics events not writing"

**Solution:**
```bash
# Ensure directory exists and is writable
mkdir -p packages/orchestrator/data
chmod 755 packages/orchestrator/data
```

### Issue: "Tests fail with timeout"

**Solution:**
- Increase Jest timeout in `packages/orchestrator/jest.config.ts`
- Check for port conflicts
- Ensure no other services are running

---

## Next Steps After Configuration

Once configuration is complete:

1. **Explore the API:**
   - Use `docs/tests/api-tests.http` to test endpoints
   - See `docs/tests/README.md` for detailed API documentation

2. **Read the documentation:**
   - `docs/README.md` - Full system overview
   - `README.md` - Quick start guide

3. **Run simulations:**
   - `POST /dev/simulate-call` - Simulate a full call conversation
   - `POST /dev/simulate-speech` - Test ASR/TTS adapters

4. **Review test files:**
   - Each test file in `packages/orchestrator/tests/` documents expected behavior

---

## Production Configuration (Advanced)

For production deployment, additional configuration may be needed:

1. **Set production environment:**
   ```env
   NODE_ENV=production
   PORT=3000
   GIT_SHA=<actual-git-sha>
   ```

2. **Build for production:**
   ```bash
   pnpm --filter orchestrator build
   pnpm --filter orchestrator start
   ```

3. **Configure logging:**
   - Set up log aggregation (e.g., CloudWatch, Datadog)
   - Configure analytics event streaming

4. **Set up monitoring:**
   - Health check endpoint: `/healthz`
   - Metrics endpoint: `/metrics/summary`

---

## Summary

**Minimum configuration (5 minutes):**
1. `pnpm install`
2. `pnpm test` (verify)
3. `pnpm dev` (start server)

**Full configuration (15 minutes):**
1. All minimum steps
2. Create `.env` file
3. Set up API testing tool
4. Run full smoke test suite
5. Verify all endpoints

**You're ready when:**
- ✅ `pnpm test` passes
- ✅ `pnpm dev` starts server
- ✅ `curl http://localhost:3000/healthz` returns 200
- ✅ Analytics events write to `data/events.log`

---

## Need Help?

- Check `docs/README.md` for system overview
- Review test files in `packages/orchestrator/tests/` for usage examples
- See `docs/tests/README.md` for API testing guide

