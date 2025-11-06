# API Test Collection

This directory contains REST Client test files for the AI-Driven Outbound Booking API.

## Prerequisites

1. **VS Code REST Client Extension** (recommended)
   - Install the "REST Client" extension from the VS Code marketplace
   - Open `api-tests.http` and use "Send Request" links above each request

2. **IntelliJ HTTP Client**
   - IntelliJ IDEA and WebStorm have built-in HTTP Client support
   - Open `api-tests.http` directly

3. **Alternative: Postman**
   - Import the collection using Postman's import feature
   - Or use curl commands (see below)

## Setup

1. Start the development server:
   ```bash
   pnpm dev
   ```

2. The server should be running on `http://localhost:3000` (default)

3. Update the `@baseUrl` variable in `api-tests.http` if using a different port

## Test Collection Overview

The `api-tests.http` file contains 20 test requests organized by category:

### 1. Health & Infrastructure
- **Health Check**: Verify service is running
- **Policy Checks**: Test pre-dial and pre-booking validation

### 2. Data Seeding
- **Seed Manager Calendar**: Create two open slots (today and tomorrow)
- **Seed Test Leads**: Create five test leads (3 NA, 2 EMEA)

### 3. Calendar Operations
- **Get Availability**: Check manager's available time slots
- **Place Hold**: Reserve a tentative time slot
- **Create Event**: Create a confirmed calendar event

### 4. Booking Flow
- **Create Booking (Full)**: Complete booking with confirmation
- **Create Booking (Hold Only)**: Place hold without confirmation

### 5. Analytics & Metrics
- **Metrics Summary**: Get aggregated analytics and KPIs

### 6. Attempts & Scheduling
- **Schedule Attempt**: Check when next call attempt is allowed

### 7. Voice & Call Management
- **Voice Answer**: Create a call session
- **Voice Events**: Process call status callbacks
- **Get Call**: Retrieve call details

### 8. Simulation & Testing
- **Simulate Happy Path**: End-to-end booking simulation
- **Simulate Call**: Full conversation flow simulation

### 9. CRM Integration
- **Get CRM Task**: Retrieve task by booking ID
- **Create CRM Task**: Write task to CRM

## Running the Collection

### VS Code REST Client

1. Open `api-tests.http` in VS Code
2. Click "Send Request" above each request
3. View responses in the editor panel

### IntelliJ HTTP Client

1. Open `api-tests.http` in IntelliJ
2. Click the green play button next to each request
3. View responses in the built-in HTTP Client tool window

### Using curl

Example:
```bash
# Health check
curl http://localhost:3000/healthz

# Seed manager calendar
curl -X POST http://localhost:3000/dev/seed/managerCalendar \
  -H "Content-Type: application/json" \
  -d '{"manager_id": "0051234567890XYZ"}'
```

## Expected Results

All requests should return **2xx status codes** with expected payloads:

- `200 OK`: Successful operations
- `400 Bad Request`: Invalid input (expected for some policy checks)
- `404 Not Found`: Resource not found (expected for some lookups)

## Test Variables

The collection uses variables defined at the top of `api-tests.http`:

- `@baseUrl`: API base URL (default: `http://localhost:3000`)
- `@managerId`: Test manager ID
- `@leadId`: Test lead ID
- `@callId`: Test call ID
- `@bookingId`: Test booking ID

Update these variables to match your test data.

## Order of Execution

For best results, run requests in this order:

1. Health check
2. Seed manager calendar
3. Seed test leads
4. Policy checks
5. Availability and calendar operations
6. Booking operations
7. Metrics and analytics

## Notes

- The calendar seeding endpoint creates slots that are available by default (no existing events)
- Test leads are stored in memory and will be lost on server restart
- All timestamps should be in RFC 3339 UTC format
- The collection includes both success and failure scenarios


