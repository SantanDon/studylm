# Agent Onboarding Protocol

This document is the official technical manual for external agents (AI instances, background scripts, or autonomous research bots) to collaborate within StudyPodLM.

---

## Prerequisites

> **A human user must authenticate first.** The 6-digit pairing code is generated from the StudyPodLM web UI by a logged-in human user. Agents cannot self-register without a human sponsor.

---

## 1. Pairing (Get Your API Key)

**Step 1 — Human generates pairing code:**
- Log into StudyPodLM web app
- Open **Profile Menu** → **Agent Pairing**
- Click **Generate Pairing Code** (6-digit PIN, expires in 5 minutes)

**Step 2 — Agent exchanges PIN for API key:**
```bash
node backend/scripts/kilo_pair.js <YOUR-6-DIGIT-PIN>
```
The script saves a persistent API key (`spm_...`) to `.env.agent`.

---

## 2. Authentication

Include your API key in all requests:

```
Authorization: Bearer spm_your_key_here
```

**Verify your identity:**
```bash
curl -H "Authorization: Bearer spm_your_key_here" \
  http://localhost:3001/api/auth/me
```
Returns: `{ id, displayName, account_type, email, createdAt }`

---

## 3. Core Capabilities

### Discover Notebooks
```
GET /api/notebooks
```

### Read Notebook Context (AI-optimized)
```
GET /api/notebooks/:id/context
```
Returns structured snapshot: notebook metadata, sources with content previews, all notes.

### Post Research Notes
```
POST /api/notebooks/:id/notes
Body: { "content": "Your insight here" }
```
Notes from agents are automatically tagged with an **AGENT** badge and synced to EverMemOS memory.

### Upload Files
```
POST /api/agent/upload
Content-Type: multipart/form-data
```
Raw files (PDFs, images) are queued for local encryption when the human opens the notebook.

### Chat with Notebook
```
POST /api/notebooks/:id/chat
Body: { "message": "What are the key themes?", "saveAsNote": true }
```

### Search Memories
```
POST /api/notebooks/:id/memory/search
Body: { "query": "machine learning trends" }
```

---

## 4. Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `401 Unauthorized` | Expired or missing API key | Re-pair with a fresh 6-digit code |
| `404 Notebook not found` | Wrong notebook ID or no access | Call `GET /api/notebooks` to list accessible notebooks |
| `CORS error` | Frontend origin not allowed | Set `CORS_ORIGIN` env var on server |
| Pairing code rejected | Code expired (>5 min) | Generate a new code from the UI |

### Manual Human Auth (for testing)
If you need a human JWT for the pairing flow outside the UI:
```bash
curl -X POST http://localhost:3001/api/auth/signin \
  -H "Content-Type: application/json" \
  -d '{"displayName":"testuser","passphrase":"your_passphrase"}'
```

---

## 5. Starter Kit

| Script | Purpose |
|--------|---------|
| `backend/scripts/kilo_pair.js` | Official pairing utility |
| `backend/scripts/syncAgent.js` | Base template for autonomous research bots |
| `agent_demo_kit/pair_and_test.js` | All-in-one: pair + list notebooks + post test note |
