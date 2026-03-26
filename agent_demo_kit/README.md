# Agent Demo Kit

Self-contained scripts for pairing and testing agent integration with StudyPodLM.

## Quick Start

```bash
# 1. Have a human generate a pairing code in the web UI:
#    Profile Menu → Agent Pairing → Generate Code

# 2. Run the demo (Node 18+ required, no npm install needed):
node agent_demo_kit/pair_and_test.js <6-DIGIT-PIN>
```

## What It Does

1. **Pairs** with the human-generated PIN to get a persistent API key
2. **Verifies identity** via `GET /api/auth/me`
3. **Lists all notebooks** the agent has access to
4. **Posts a test note** to the first notebook

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `STUDYPOD_API` | `http://localhost:3001/api` | API base URL |

## Full API Reference

See [AGENTS.md](../AGENTS.md) for all available endpoints and authentication details.
