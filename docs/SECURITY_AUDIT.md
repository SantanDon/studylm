# StudyPodLM Security Audit

**Last updated:** 2026-07-08 (post Phase-0 hardening + Login-with-ChatGPT integration)
**Scope:** `backend/`, `src/`, `api/`, `mcp-server/`

---

## Resolved (historical issues now fixed)

The following issues from prior audit revisions have been addressed in the current codebase:

| Prior issue | Current state |
|---|---|
| Plaintext password storage in `localStorage` | Passwords are bcrypt-hashed server-side (`backend/src/routes/auth.js`); the frontend never stores raw passwords. Sessions are httpOnly JWT cookies, not localStorage tokens. |
| Session token = `'local-token-' + Date.now()` | Real JWT access (7d) + refresh (30d) tokens signed with `JWT_SECRET` (`backend/src/middleware/auth.js`). |
| No Content Security Policy | Helmet CSP is configured in `backend/src/server.js` (dynamic for `127.0.0.1`/`localhost`). |
| No client-side encryption | `src/stores/encryptionStore.ts` holds an in-memory `CryptoKey`; `src/lib/encryption/` implements client-side AES-GCM with multi-user isolation tests. |

---

## Phase 0 hardening (2026-07-08)

Five critical findings were remediated:

| ID | Finding | Remediation |
|---|---|---|
| **C1** | Hardcoded YouTube/Google InnerTube API key in 3 git-tracked files | Key externalized to `YOUTUBE_INNERTUBE_API_KEY` env var in `backend/src/routes/youtube.js`, `api/youtube-edge.js`, `vite-plugin-cors-proxy.ts`. **Action required:** rotate the leaked key in Google Cloud and scrub git history (`git filter-repo` / BFG). |
| **C2** | `GET /api/admin/migrate` was unauthenticated | `backend/src/routes/admin.js` now requires `authenticateToken` + `requireScope('admin:keys')`. |
| **C3** | MFA encryption fell back to a hardcoded key when `JWT_SECRET` unset | Fallback literal removed in `backend/src/routes/auth.js`; MFA now throws if `JWT_SECRET` is missing/short. Server boot aborts in production if `JWT_SECRET` is unset (`backend/src/server.js`). |
| **C4** | Rate limiting skipped in production on Vercel | The `|| !!process.env.VERCEL` skip clause removed from `apiLimiter`, `authLimiter` (server.js), and the route-local `authLimiter` (auth.js). **Note:** for multi-instance/serverless deploys, back the limiter store with Vercel KV/Upstash so limits apply across instances. |
| **C5** | JWT auto-provisioned ghost users with a hardcoded password when userId missing from DB | `backend/src/middleware/auth.js` now returns `401` ("Account no longer exists. Please sign in again.") instead of creating a shell user. |

Validation after Phase 0: `npm run lint` 0 errors, `npm run typecheck` baseline preserved, `npx vitest run backend/src/__tests__` 53/53 pass, production `vite build` green, live boot confirmed with LWC handler responding on `/api/chatgpt/session`.

---

## Current security posture

### Authentication
- **Humans:** passphrase/email signin → bcrypt (cost 10) → httpOnly cookies (`accessToken` 7d, `refreshToken` 30d) signed with `JWT_SECRET`. Optional TOTP MFA (`otplib`), MFA secret AES-256-CBC encrypted with a key derived from `JWT_SECRET`. BIP39 recovery flow.
- **Agents:** 6-digit pairing PIN (5-min expiry) → persistent `spm_` API key (32 random bytes, SHA-256 hashed at rest). 25 scopes enforced via `requireScope` for `authMethod === 'api_key'`; JWT (human) requests bypass scope checks. Per-key rate limiting (in-memory). `admin:keys`/`admin:all` short-circuit scope checks.
- **Guests:** `guest_*` tokens auto-authenticated as `accountType: 'guest'` with documented limits (`docs/GUEST_MODE.md`).

### Login with ChatGPT (added 2026-07-08)
- OAuth device-code flow via the public Codex client; refresh tokens never leave the session layer.
- Session cookie (`lwc_session`) is HttpOnly, HMAC-signed (24-char sessionId), tokens AES-GCM encrypted at rest with `LWC_SECRET`.
- `/api/chatgpt/responses` proxy rate-limited at 30 req/min per session; `allowedOrigins` CSRF guard on non-GET routes.
- Tokens never reach the browser; normal app code uses `auth.proxyFetch(request)` or `/responses`/`/models` without receiving bearer tokens.
- StudyPodLM `signOut` also calls `POST /api/chatgpt/logout` to revoke the LWC session server-side.
- **Required env:** `LWC_SECRET` (`openssl rand -hex 32`). **Production:** back `sessionStore` with a shared store (Vercel KV/Upstash); edge-limit `/login` + `/status`.

### Transport / headers
- Helmet CSP, COOP/COEP (`credentialless` for SharedArrayBuffer), CORP `cross-origin`.
- CORS allowlist (`CORS_ORIGIN` env) + permissive localhost for dev. `credentials: true`.

### Data at rest
- SQLite/Turso via libsql (Drizzle ORM). DB URL + auth token from env.
- Agent uploads land as **plaintext** in `uploads/agent/` until the frontend encrypts on notebook open (see N6 below).
- Client-side encryption (AES-GCM) with in-memory `CryptoKey` (never persisted).

### SQL safety
All user-facing queries use Drizzle parameterized builders or `sql` tagged templates with bound `args`. No string-interpolated user input found in SQL. `sql.raw` usages operate on hardcoded const arrays.

---

## Known remaining issues (non-critical)

| ID | Issue | Location | Suggested fix |
|---|---|---|---|
| **N1** | Unauthenticated `GET /api/agent/antigravity/pulse` | `backend/src/routes/antigravity.js:46` | Add `authenticateToken` or restrict to read-only public status |
| **N2** | Unauthed health endpoints leak env-var presence + DB health | `backend/src/server.js` (`/api/health/vault-check`, `/stability-audit`) | Gate behind `authenticateToken` or return only `status: ok` |
| **N3** | Permissive CORS (`!origin` accepted; any `localhost:*`) | `backend/src/server.js:137-148` | Acceptable for dev; ensure `CORS_ORIGIN` is tight in prod |
| **N4** | Email verification bypassed for all signups | `backend/src/routes/auth.js:141,179` | Enforce `isVerified` gate if email-verified features are needed |
| **N5** | SSRF surface on authed `/api/proxy/proxy` + `/extract-web` | `backend/src/routes/proxy.js:18,56` | Add an allowlist/blocklist for internal IPs (169.254/10/127/172.16/192.168) |
| **N6** | Agent uploads stored plaintext on disk until frontend encryption | `backend/src/routes/agent.js:62-63` | Encrypt on write (server-side envelope encryption) or restrict permissions |
| **N7** | `docs/SECURITY_AUDIT.md` was stale (this update resolves it) | — | Keep this file current with each hardening pass |
| **N8** | MCP SSE endpoint (`POST /rpc`) unauthenticated with `CORS *` | `mcp-server/index.js` | Add a token check or bind to loopback only |

### Other code-health notes
- 199 TypeScript errors remain (down from 316) — real type drift in `src/lib/extraction/pdfExtractor.ts` (pdfjs-dist `TextItem|TextMarkedContent` union) and `src/services/storage/LocalStorageServiceImpl.ts` (`LocalChatMessage` type drift). These need careful type design, not mechanical fixes.
- CRDT persistence (`syncRelay.js` `onLoadDocument`/`onStoreDocument`) is a TODO stub.
- `user.js` calls stubbed `dbHelpers` preferences/stats helpers (schema for those tables doesn't exist).
- `backend/src/routes/auth.js:568` references `sendVerificationEmail` which is not imported — `POST /api/auth/resend-verification` will throw `ReferenceError`. (Discovered by the Phase 1.3 test suite.)

---

## Maintenance protocol

1. After every security-relevant change, update the **Phase 0 hardening** or **Known remaining issues** table here.
2. New findings get a C/N ID and a remediation row.
3. Run the validation suite after each change: `npm run lint && npm run typecheck && npx vitest run backend/src/__tests__ && npm run build`.
4. Rotate secrets (`JWT_SECRET`, `LWC_SECRET`, provider API keys) on a schedule and after any suspected compromise.
