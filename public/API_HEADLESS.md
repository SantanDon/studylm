# StudyPodLM Headless API Guide

This guide provides information on how to integrate autonomous agents and external tools with StudyPodLM.

## Authentication

StudyPodLM uses two types of authentication for headless access:

### 1. Temporary Session Tokens (JWT)
Found in the "Manual Integration" section of Developer Tools.
- **Prefix:** `Bearer `
- **Duration:** 1 hour
- **Use Case:** Quick testing or one-off tasks.

### 2. Persistent Agent Keys
Generated via the **Agent Pairing Wizard**.
- **Prefix:** `spm_`
- **Duration:** Infinite (unless revoked)
- **Use Case:** Long-running agents, IDE extensions, or scheduled tasks.

## Connecting an Agent via Pairing

1. Open **Profile Menu** -> **Agent Pairing**.
2. Click **Generate Pairing Code**.
3. In your agent's terminal, run:
   ```bash
   kilo pair <6-DIGIT-PIN>
   ```
4. The agent will exchange the PIN for a persistent API key and store it locally.

## API Endpoints for Agents

### Uploading to Dropbox
Agents can push files to a specific "Dropbox" route without needing your encryption passphrase. These files are queued and will be encrypted locally the next time you open the corresponding notebook.

`POST /api/agent/upload`
- **Headers:** `X-API-Key: your_agent_key`
- **Body:** Multipart/form-data containing the file.

### Checking for Commands
Agents can poll for user-assigned tasks or study goals.

`GET /api/agent/tasks`
- **Headers:** `X-API-Key: your_agent_key`
