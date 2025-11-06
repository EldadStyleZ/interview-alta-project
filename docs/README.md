# AI-Driven Outbound Meeting Booking - Prototype

## Overview

This system automates outbound calling to book discovery meetings between qualified leads and senior account managers. An AI agent conducts voice conversations, qualifies prospects using BANT criteria, captures explicit consent, proposes calendar times from manager availability, and orchestrates booking creation across calendar systems and CRM. The prototype includes policy gates for compliance (DNC checks, attempt limits, call windows), deterministic state machines for conversation flow, vendor-agnostic speech adapters (ASR/TTS), and append-only analytics for metrics tracking.

## Quick Start

### Prerequisites

- Node.js 18+ and pnpm installed
- Terminal access

**📋 [Detailed Configuration Guide](../CONFIGURATION.md)** - Step-by-step setup instructions

### Local Setup

1. **Install dependencies:**
   ```bash
   pnpm install
   ```

2. **Start the development server:**
   ```bash
   pnpm dev
   ```
   Server runs on `http://localhost:3000` (configurable via `PORT` env var).

3. **Verify health:**
   ```bash
   curl http://localhost:3000/healthz
   ```
   Should return `{"service":"orchestrator","git_sha":"unknown","status":"healthy"}`.

### Smoke Tests

**Quick smoke test (under 2 minutes):**

```bash
# Run all tests
pnpm test
```

**Expected result:** All tests pass with green checkmarks. This verifies:
- Health endpoint works
- Policy validators enforce rules
- Calendar operations respect buffers
- Booking flow creates all artifacts
- Analytics events are logged

**Individual test files:**
- `tests/health.test.ts` - Basic service health
- `tests/policy.test.ts` - Compliance gates
- `tests/calendar.test.ts` - Calendar operations
- `tests/booking.test.ts` - Full booking flow
- `tests/analytics.test.ts` - Event logging

### API Smoke Tests

Use the REST Client collection to test endpoints manually:

1. **Install VS Code REST Client extension** (or use IntelliJ HTTP Client)
2. **Open** `docs/tests/api-tests.http`
3. **Run requests sequentially:**
   - Health check
   - Seed manager calendar (`POST /dev/seed/managerCalendar`)
   - Seed test leads (`POST /dev/seed/leads`)
   - Policy checks
   - Availability, booking, metrics

All requests should return **2xx status codes** with expected payloads.

See `docs/tests/README.md` for detailed instructions.

## Key Concepts

### Idempotency

All write operations are idempotent to prevent duplicate records:

- **Calendar Events**: Use deterministic `iCal_uid` generated as SHA-256(`booking_id` + `start_utc`). Re-submitting the same booking creates/updates the same event.
- **CRM Tasks**: Use `booking_id` as external ID. Duplicate writes with the same `booking_id` update the existing task rather than creating a new one.
- **Confirmation Messages**: Each booking enqueues exactly one confirmation message.

### Buffers

Calendar operations enforce **10-minute buffers** around events and holds to prevent double-booking:

- When checking availability, slots within 10 minutes of existing events are marked unavailable.
- Hold placement and event creation reject overlaps including buffers.
- Example: An event at 2:00 PM blocks availability from 1:50 PM to 2:10 PM.

### Consent Handling

Consent is captured at multiple stages with explicit verification:

1. **Consent to Proceed**: Required before qualification questions. Must be explicit verbal confirmation.
2. **Recording Consent**: Required if `recording_required` flag is set (jurisdiction-based). Must be captured before any recording begins.
3. **Opt-Out Detection**: Keywords like "stop", "remove", "do not call" immediately halt the conversation and record an opt-out event.

Consent records include `consent_id`, `subject_id`, `status`, `captured_ts`, and optional `evidence_url` for audit.

## Architecture

### Core Components

- **Policy Validator** (`src/policy/validator.ts`): Enforces pre-dial, in-call, pre-booking, and pre-write gates
- **State Machine** (`src/agent/stateMachine.ts`): Deterministic conversation flow with mandatory line enforcement
- **Call Orchestrator** (`src/agent/orchestrator.ts`): Manages ASR/TTS streaming and state transitions
- **Calendar Service** (`src/calendar/service.ts`): Availability, holds, and event creation with overlap detection
- **CRM Mock** (`src/crm/salesforceMock.ts`): Idempotent task creation using booking_id as external ID
- **Analytics Bus** (`src/analytics/bus.ts`): Append-only JSONL event logging to `./data/events.log`
- **Attempts Strategy** (`src/attempts/strategy.ts`): 3 attempts/week, 24-hour spacing, region-based time windows

### Data Flow

1. Lead ingested → Policy pre-dial check → Attempt scheduled
2. Call answered → ASR streaming → State machine transitions
3. Qualification complete → Calendar availability → Time proposed
4. Time confirmed → Booking created → Calendar event + CRM task + Confirmation queued
5. Analytics events logged at each stage

## Design Documents

### Process & Architecture
- [Problem and Objectives Brief](../01_Executive_brief.md) (if available)
- [Workflow Mapping](../07_Workflow.md) (if available)
- [Architecture and Tech Stack](../02_Architecture.md) (if available)

### Design Specifications
- [Conversation Design and State Machine](../03_Conversation_Design.md) (if available)
- [Data Contracts and Write Paths](../04_Data_Contracts.md) (if available)
- [Compliance Guardrails and Safety Policies](../06_Compliance.md) (if available)

### Strategy & Operations
- [Qualification, Lead Scoring, and Attempt Strategy](../08_Qualification_and_Scoring.md) (if available)
- [Booking Logic and Calendar Policy](../05_Calendar_Policy.md) (if available)
- [Analytics, Dashboards, and Experiment Plan](../09_Analytics_and_Experiments.md) (if available)

**Note:** Design documents are in the repository root. If not present, refer to the inline code documentation and test files for implementation details.

### Diagrams
- Architecture diagrams: See design documents above for Mermaid diagrams
- State machine diagrams: See Conversation Design document
- Sequence diagrams: See Architecture document

## Development

### Project Structure

```
ai-outbound-booking/
├── packages/
│   └── orchestrator/          # Main service
│       ├── src/
│       │   ├── agent/          # State machine & orchestration
│       │   ├── analytics/     # Event logging
│       │   ├── attempts/      # Scheduling strategy
│       │   ├── calendar/      # Calendar service
│       │   ├── contracts/     # Zod schemas & validators
│       │   ├── crm/           # CRM mock
│       │   ├── messaging/     # Outbox & templates
│       │   ├── policy/         # Compliance gates
│       │   ├── speech/        # ASR/TTS adapters
│       │   └── telephony/     # CPaaS integration
│       └── tests/              # Unit tests
├── docs/
│   ├── tests/                 # API test collection
│   └── README.md              # This file
└── README.md                   # Root README
```

### Commands

- `pnpm dev`: Start development server with hot reload
- `pnpm test`: Run all tests
- `pnpm lint`: Run ESLint
- `pnpm format`: Format code with Prettier

### Environment Variables

- `PORT`: Server port (default: 3000)
- `GIT_SHA`: Git commit SHA for health checks (default: "unknown")

## Troubleshooting

**Tests fail with port conflicts:**
- Ensure no other service is using port 3000
- Set `PORT` environment variable to use a different port

**Analytics events not appearing:**
- Check `./data/events.log` exists (created automatically)
- Verify write permissions in the project directory

**Calendar slots show as unavailable:**
- Check for existing events or expired holds
- Verify time window is within business hours (09:00-17:00 local time)

**Policy checks block valid requests:**
- Review policy context (DNC flags, attempt counts, time windows)
- Check `src/policy/validator.ts` for specific reason codes

## Contributing

1. Fork the repository
2. Create a feature branch
3. Write tests for new functionality
4. Ensure all tests pass (`pnpm test`)
5. Submit a pull request

## License

Prototype - Internal use only.

