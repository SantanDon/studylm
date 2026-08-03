# StudyPod Final Architecture and Risk Review

Date: 2026-07-24
Release branch: `codex/studypod-audiobook-breakthrough-july-2026`

## Executive assessment

StudyPod is a capable research workspace with five substantial product surfaces: source ingestion, grounded study tools, editable research documents, media generation, and agent missions. The strongest architectural path is the authenticated React client talking to one Express API backed by Turso/Drizzle, with provider selection and grounding kept on the server.

This release materially improves security, ownership isolation, provider reliability, media continuity, the ChatGPT connector, source upload ergonomics, and agent evidence quality. The codebase is suitable for a controlled production release after all release gates and browser journeys pass.

It is not yet a horizontally scalable media-rendering or autonomous-agent platform. Long audiobook renders and long-running missions still need durable cloud queues, object storage, and resumable execution before they should be marketed as always-on cloud jobs.

## Current architecture

### Client

- React 18 and Vite provide the application shell and lazy-loaded routes.
- TanStack Query handles server state; Zustand and feature hooks handle active workspace state.
- IndexedDB stores local media blobs and per-item playback checkpoints.
- Local and authenticated modes coexist, with protected routes and explicit guest limits.
- The notebook workspace composes Sources, Chat, Studio, documents, study tools, and agent controls.

### API and identity

- Express exposes the application API and the OAuth/MCP connector.
- JWT sessions and scoped API credentials pass through shared authentication middleware.
- Notebook, source, note, task, mission, and audiobook operations are scoped to the authenticated owner.
- Turso/libSQL with Drizzle is the durable application store.
- Helmet, CORS policy, body limits, route rate limits, redirect validation, and sanitized public errors protect the request boundary.

### AI and grounding

- The server-side provider layer selects OpenAI first for reasoning/context work when configured, then falls through the configured provider chain by workload.
- Provider requests use bounded concurrency, a bounded wait queue for bursts, total deadlines, per-request timeouts, cooldowns, and safe failover.
- OpenAI generation uses the Responses API and a current reasoning-capable default model.
- Prompts keep user/source material in an explicitly untrusted evidence boundary.
- Mission execution selects relevant source segments, creates persistent reports, audits citations, and records evidence status.
- Agent missions survive refresh and can be listed, created, run, paused, resumed, and reviewed.

### Sources and research tools

- Upload supports PDF, DOCX, EPUB, text, Markdown, spreadsheets, audio, images, URLs, YouTube, and pasted evidence through type-specific extraction paths.
- Upload admission is bounded by file count, per-file size, total batch size, duplicate checks, and controlled concurrency.
- Grounded chat, citations, notes, tasks, quizzes, flashcards, concept maps, podcasts, documents, revisions, and exports consume stored source content.
- External URL and redirect handling is revalidated to reduce SSRF and redirect-rebinding risk.

### Audio and media

- Podcasts use local neural or browser-compatible generation paths and persist generated audio in IndexedDB.
- Audiobooks add literary-direction analysis, semantic narration beats, pronunciation overrides, preview generation, background job state, and MP3/M4B/WAV output.
- Podcast and audiobook players persist position, duration, playback rate, completion, and update time per media item.
- On return, StudyPod restores the most recently played unfinished item and seeks to its checkpoint.
- Kokoro is the verified default. Chatterbox is an optional local expressive engine with explicit warm-up and bounded concurrency.

### ChatGPT connector

- StudyPod exposes an authenticated MCP endpoint with OAuth 2.0 authorization code flow, PKCE, dynamic client registration, consent, scoped access, and rotating refresh credentials.
- The connector offers 13 owner-scoped tools for notebooks, source search and reading, notes, tasks, and agent missions.
- Search ranks evidence by phrase, title, occurrence, and matched query terms, then returns bounded excerpts.
- Tool instructions require source identifiers, explicit inference, and confirmation before writes.
- Consent and settings use the official monochrome OpenAI mark and accurately describe granted actions and the subscription/API boundary.
- Settings lists active ChatGPT apps and revokes the full grant, including access and rotating refresh credentials.

### Deployment

- Vercel serves the Vite bundle and routes API, OAuth, and MCP requests to the Express serverless entry point.
- Serverless functions have a 60-second ceiling.
- Long-lived collaboration WebSockets and local model runtimes are intentionally disabled on Vercel.
- Deployment exclusions keep local neural runtimes and backend-only dependency manifests out of the serverless function bundle.

## High-impact gaps found and fixed in this cycle

- Removed the unsupported consumer ChatGPT session proxy and browser-held provider credentials.
- Replaced generic connector branding with the official OpenAI mark and truthful capability copy.
- Added a real OAuth/MCP connector instead of treating a ChatGPT subscription as an API credential.
- Fixed a restricted-key cross-notebook note isolation bug.
- Applied owner checks to audiobook books, jobs, previews, generation, downloads, and worker state.
- Added mission ownership checks before execution and atomic stale-run recovery.
- Added evidence-focused mission context selection, citation auditing, persistent self-audit, and durable reports.
- Added server-side OpenAI provider failover, bounded concurrency, and timeouts.
- Added capacity-aware queuing so a burst of study-generation requests waits for the configured provider instead of returning spurious 503 responses.
- Hardened Gemini SDK/model use and large-document retries.
- Added upload limits, duplicate rejection, controlled processing waves, and partial-failure feedback.
- Added per-podcast and per-audiobook resume checkpoints across full page exits.
- Stale audiobook render records now self-clear when their owner-scoped server job no longer exists.
- Sanitized unexpected OAuth, MCP, notebook, audiobook, sync, and provider errors.
- Removed tracked model caches, obsolete integrations, stale forensic scripts, dead imports, and private-book assumptions.
- Updated vulnerable dependency paths and forced patched Sharp and adm-zip versions.

## Agentic capability assessment

The agent is now evidence-oriented rather than a thin chat wrapper. It has durable missions, explicit execution states, source selection, provider execution, report persistence, citation audits, and user-visible evidence status. The ChatGPT connector can also create and run missions without bypassing ownership rules.

The next major enhancement should be an execution ledger rather than more prompt complexity. Each mission step should be an idempotent job with inputs, selected evidence, provider output, citations, cost/latency metadata, retry policy, and an append-only event. That design would enable safe multi-step plans, cancellation, resumability, evaluation, and human approval gates without relying on one HTTP request.

## Residual risks and recommended next changes

### High: durable long-running work

Audiobook artifacts and worker manifests rely on process-local files, while Vercel storage and execution are ephemeral. Mission execution also runs inside a request bounded by the deployment timeout.

Recommended change: move media outputs to object storage and run media and mission steps through a durable queue with leases, idempotency keys, heartbeats, cancellation, and replayable events.

### Medium: notebook route concentration

`backend/src/routes/notebooks.js` remains a large mixed-responsibility route module. It combines notebook lifecycle, sources, notes, chat, research, webhooks, signals, and recovery behavior. This increases regression risk and makes authorization review harder.

Recommended change: split by domain behind shared ownership middleware and move just-in-time recovery out of GET paths into explicit repair jobs.

### Medium: device-local playback continuity

Playback resumes after exit on the same browser profile. IndexedDB/local checkpoints do not provide cross-device continuity and can disappear when site storage is cleared.

Recommended change: sync small playback checkpoint records to the authenticated backend while keeping large audio blobs local or in object storage.

### Medium: distributed controls

In-memory SSE connection counts and some rate limits are per function instance. They are useful safeguards but not global controls under horizontal scaling.

Recommended change: use a shared rate/lease store for expensive generation, mission execution, OAuth abuse protection, and live-client quotas.

### Medium: browser content policy

The current content security policy still permits inline script/style behavior and `unsafe-eval`, primarily for existing client/runtime compatibility.

Recommended change: introduce nonces and isolate any neural/WASM runtime that truly needs relaxed execution into a worker-specific boundary.

### Medium: notebook bundle weight

The production notebook chunk is 1,683.6 KB minified (511.6 KB gzip), below its enforced 1,850 KB budget but still expensive on slower devices. Several modules are also both statically and dynamically imported, preventing the intended code splitting.

Recommended change: lazy-load Studio generators and document/export tooling at panel boundaries, then lower the notebook budget after measuring real navigation latency.

### Time-bounded dependency exception

React Router 7.18.1 is reported by GHSA-qwww-vcr4-c8h2. The advisory explicitly affects only unstable RSC APIs; StudyPod is a React 18 declarative BrowserRouter application and does not import or enable those APIs.

The only published patched Router release is 8.3.0, which requires React 19.2.7 or newer and Node 22.22 or newer. Downgrading to 7.11 would reintroduce fourteen older Router advisories. StudyPod therefore remains on 7.18.1 with a documented non-applicability exception until a supported 7.x patch or a tested React 19/Router 8 migration is available.

Recommended change: monitor the advisory and remove this exception as soon as a compatible patched release exists.

### Medium: external ingestion variability

YouTube, arbitrary websites, model providers, and local neural engines can change or throttle independently of StudyPod.

Recommended change: retain the layered extraction strategy, add provider-specific telemetry and fixtures, and expose a user-facing provenance/status panel when fallbacks are used.

### Low: OAuth registration retention

Users can inspect active ChatGPT grants and revoke their access and refresh credentials. Dynamic client registrations and already-expired grant rows still need scheduled retention cleanup.

Recommended change: add a scheduled cleanup job for expired authorization codes, revoked/expired grants, and long-unused orphan client registrations.

## ChatGPT subscription boundary

A ChatGPT paid plan and OpenAI API billing are separate products. StudyPod cannot import a user's ChatGPT subscription quota, hidden system behavior, or premium API entitlement.

The supported high-quality design is:

1. Connect StudyPod as an MCP app inside the user's ChatGPT account. ChatGPT-side models and account features remain governed by that ChatGPT account.
2. Use StudyPod's separately configured OpenAI API project for AI work executed inside StudyPod.
3. Never request, proxy, or store a consumer ChatGPT session cookie.

## Release verification record

The release must not be deployed until these are complete:

- Focused security, OAuth/MCP, mission, audiobook, playback, and upload tests.
- Full Vitest suite.
- TypeScript, ESLint, production build, and bundle budget.
- Production dependency audits for the root and backend package where applicable.
- Backend JavaScript syntax sweep and Chatterbox Python compilation.
- Real-source regression covering imports, citations, notes, tasks, documents, revisions, and exports.
- Desktop and 390-pixel browser journeys with console, failed-request, and overflow inspection.
- Podcast and audiobook reload/resume journeys.
- Agent mission execution and persisted evidence-report review.
- ChatGPT consent/branding and OAuth metadata inspection.
- Production health, authentication, and connector smoke tests after deployment.

## Recommended architecture sequence

1. Ship this hardening release once every gate is green.
2. Introduce durable jobs plus object storage for media and agent work.
3. Split the notebook API into domain routers with shared policy tests.
4. Add cross-device playback checkpoint sync.
5. Add a mission execution ledger, evaluation fixtures, and approval gates.
6. Add OAuth retention cleanup and distributed rate controls.
