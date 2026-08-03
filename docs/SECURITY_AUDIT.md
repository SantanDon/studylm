# StudyPod Security Audit

**Last updated:** 2026-08-03
**Release:** Agent Missions, MCP/OAuth, grounded study workflows, document workspace, podcast hardening, and Audiobook Studio v2
**Scope:** `backend/`, `src/`, `api/`, `mcp-server/`, deployment configuration, and production dependencies

## Release posture

This release passed the complete automated, browser, API, storage, and deployment gates documented below. No API keys, tokens, environment files, databases, generated uploads, audiobook media, or QA artifacts are included in the release commit or Vercel upload.

### Resolved and hardened

| Area | Current state |
|---|---|
| Authentication | Passwords/passphrases are bcrypt-hashed server-side. Access and refresh credentials are issued through HttpOnly cookies or scoped API-key authentication. Production refuses to boot when `JWT_SECRET` is missing or shorter than 32 characters. |
| Account recovery | The insecure browser-local password-reset mock was removed. Recovery now uses the server-backed 24-word recovery flow and invalidates prior session state when the passphrase changes. |
| Removed attack surface | The obsolete admin migration route, legacy ChatGPT proxy/provider route, key-check scripts, debug research service, forensic PDF script, and obsolete video-key pool were removed. |
| Agent access | Pairing codes expire, persistent agent keys are hashed at rest, and every agent operation enforces scopes and notebook ownership. Cross-account mission access returns `404`. |
| Agent Missions | Goals and note counts are bounded. Mission claims are atomic, interrupted runs become recoverable, source and note text is treated as untrusted evidence, and completed reports include a verified evidence audit. |
| ChatGPT connector | StudyPod exposes OAuth discovery, dynamic client registration, PKCE, rotating refresh credentials, explicit consent, scoped MCP tools, and notebook ownership checks. Provider credentials are not sent to the browser. |
| External URL ingestion | Web extraction requires authentication and `sources:write`; only public HTTPS destinations are accepted. DNS and private/link-local/loopback address protections are centralized in `externalUrlSafety.js`. |
| Request hardening | Helmet, CSP, CORS allowlisting, bounded JSON/form bodies, cookie parsing, normalized request keys, route-level authentication, and production rate limiting are enabled. |
| Database access | User-facing data operations use parameterized Drizzle/libSQL queries. Notebook, source, note, mission, task, document, and audio metadata operations verify ownership. |
| Audiobook media | Source filenames and generated media filenames are kept distinct; media paths require safe basenames and ownership. Render manifests, chapter media, progress, and bookmarks are isolated per owner. |
| Serverless audio behavior | Vercel returns a clear local-beta capability response rather than starting non-durable local render workers or exposing broken generation controls. |
| Secret hygiene | `.env*`, `.vercel`, `.ai-bridge`, uploads, databases, local model caches, and generated media are ignored. The release secret-pattern scan and Git whitespace checks passed. |

## Current authentication surfaces

- **Human accounts:** server-side signup/sign-in, bcrypt verification, access/refresh credentials, optional TOTP MFA, and 24-word recovery.
- **Guest sessions:** explicitly identified guest tokens with restricted behavior.
- **Agent API keys:** human-sponsored pairing or Developer Settings, hashed storage, bounded scopes, and per-notebook ownership enforcement.
- **MCP/OAuth:** authorization-code flow with PKCE, consent records, short-lived access credentials, rotating refresh credentials, and scope checks on every tool.

## Known limitations and follow-up hardening

| ID | Limitation | Current mitigation / next step |
|---|---|---|
| **S1** | API and per-key rate-limit stores are process-local, so counters are not shared across serverless instances. | Route authentication and ownership still apply. Move production limiters to a shared Upstash/Vercel KV store before materially increasing public traffic. |
| **S2** | The browser ML/audio stack currently needs a permissive script policy (`unsafe-inline` / `unsafe-eval`) for compatibility. | All scripts remain same-origin except explicitly listed providers. Replace broad directives with nonces plus `wasm-unsafe-eval` after confirming Kokoro/ONNX compatibility. |
| **S3** | Locally received agent-upload files can exist as plaintext before the browser completes its encryption/import flow. | Uploads are excluded from Git and deployment. Add envelope encryption at write time for shared or multi-user server installations. |
| **S4** | Full audiobook rendering is local-runtime only; Vercel cannot provide durable filesystem jobs. | Production clearly disables creation and labels it Local Beta. Connect object storage plus a durable queue before enabling cloud rendering. |
| **S5** | The deployment still supports the legacy server-only `VITE_GROQ_API_KEY` alias during migration. | Frontend source has no references and the value is never bundled. Rename it to `GROQ_API_KEY` in Vercel, then remove the fallback in a later release. |
| **S6** | npm reports React Router advisory `GHSA-qwww-vcr4-c8h2`. | StudyPod is a Vite `BrowserRouter` SPA and uses none of the affected RSC, loader, action, or server-router APIs. `scripts/audit-production.mjs` fails if any other production advisory appears or if an affected API is introduced. |

## Release validation evidence

- **Automated:** 77 test files and 591 tests passed.
- **Static:** TypeScript passed with zero errors; ESLint passed with zero errors.
- **Build:** production Vite build and exact Vercel Node 22 package build passed.
- **Budgets:** initial app 446.4/600 KB, notebook 1636.9/1850 KB, Studio 439.2/500 KB.
- **Dependencies:** backend production audit reports zero vulnerabilities; frontend production audit passes only the narrowly unreachable React Router exception above.
- **Real-source browser regression:** eight sources (PDF, DOCX, text, pasted evidence, website, and YouTube) were ingested; eight grounded chats, citations, note/task persistence, source viewing, document revisions, version history, and DOCX/PDF exports passed.
- **Agent Mission browser/API regression:** grounded cited report, durable note, reload persistence, 390 px mobile layout, cross-account denial, and persisted no-source failure passed with zero browser console or page errors.
- **Long-book regression:** a 398-page PDF was structured into real chapters, progressively narrated, interrupted mid-render, resumed with cached chapters, and verified after another restart with progress and bookmarks intact.

## Maintenance protocol

1. Keep this audit synchronized with every authentication, connector, ingestion, storage, or deployment change.
2. Require automated tests, typecheck, lint, build, bundle budgets, both production audits, and at least one real browser/API journey before production promotion.
3. Run a secret-pattern scan and `git diff --check` before every release commit.
4. Never commit environment files, generated uploads, databases, local model caches, audio outputs, Vercel state, or QA artifacts.
5. Rotate signing secrets and provider credentials after any suspected exposure and remove compatibility aliases once migrations are complete.
