# AI-Driven Outbound Meeting Booking

A Node.js TypeScript monorepo prototype for automating outbound calling to book discovery meetings.

**📖 [Full Documentation](./docs/README.md)**

## Quick Start

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Run tests
pnpm test
```

See [docs/README.md](./docs/README.md) for complete setup instructions, smoke tests, and architecture overview.

**📋 [Configuration Guide](./CONFIGURATION.md)** - Step-by-step setup instructions

## Environment Variables

Create a `.env` file at `packages/orchestrator/.env` (or use env vars):

- PORT: number (default 3000)
- NODE_ENV: development | test | production (default development)
- GIT_SHA: optional git sha for build identification

An example is provided in `packages/orchestrator/.env.example`.

## Smoke Test

After `pnpm -w dev` starts the orchestrator, verify health:

```bash
curl -s http://localhost:3000/healthz | jq
```

Expected 200 JSON:

```json
{
  "service": "orchestrator",
  "sha": "unknown",
  "status": "ok"
}
```

## Structure

- packages/
  - orchestrator/ (Express app with WebSocket support)

## Scripts

- `pnpm -w dev`: runs orchestrator in watch mode
- `pnpm test`: runs all package tests

