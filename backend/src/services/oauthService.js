import { createHash, randomBytes } from "crypto";
import { v4 as uuidv4 } from "uuid";
import { dbHelpers } from "../db/database.js";
import { hashApiKey } from "../middleware/auth.js";

export const CONNECTOR_SCOPES = [
  "notebooks:read",
  "sources:read",
  "notes:read",
  "notes:create",
  "tasks:read",
  "tasks:write",
  "missions:read",
  "missions:write",
];

const ACCESS_TOKEN_LIFETIME_MS = 60 * 60 * 1000;
const REFRESH_TOKEN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const AUTHORIZATION_CODE_LIFETIME_MS = 10 * 60 * 1000;

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function safeJsonArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isAllowedRedirectUri(value) {
  try {
    const uri = new URL(value);
    if (uri.protocol === "https:") return true;
    return (
      uri.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(uri.hostname)
    );
  } catch {
    return false;
  }
}

function parseRequestedScopes(scopeValue) {
  if (!scopeValue) return [...CONNECTOR_SCOPES];
  const requested = [
    ...new Set(String(scopeValue).split(/\s+/).filter(Boolean)),
  ];
  if (requested.some((scope) => !CONNECTOR_SCOPES.includes(scope))) {
    const error = new Error("One or more requested scopes are not supported.");
    error.code = "invalid_scope";
    throw error;
  }
  return requested;
}

export async function listOAuthConnections(userId) {
  const rows = await dbHelpers.listOAuthConnections(userId);
  const seen = new Set();
  const active = [];
  for (const row of rows) {
    if (new Date(row.expiresAt).getTime() <= Date.now()) continue;
    if (seen.has(row.clientId)) continue;
    seen.add(row.clientId);
    active.push({
      clientId: row.clientId,
      clientName: row.clientName || "ChatGPT connector",
      scopes: safeJsonArray(row.scopes),
      expiresAt: row.expiresAt,
      connectedAt: row.createdAt,
      lastUsedAt: row.lastUsedAt || null,
    });
  }
  return active;
}

export async function revokeOAuthConnection(userId, clientId) {
  const normalizedClientId = String(clientId || "").trim();
  if (!userId || !/^spc_[A-Za-z0-9_-]{20,100}$/.test(normalizedClientId)) {
    const error = new Error("A valid connector client ID is required.");
    error.code = "INVALID_INPUT";
    throw error;
  }
  return dbHelpers.revokeOAuthConnection(userId, normalizedClientId);
}

export async function registerOAuthClient(payload = {}) {
  const redirectUris = Array.isArray(payload.redirect_uris)
    ? payload.redirect_uris
    : [];
  if (
    redirectUris.length === 0 ||
    redirectUris.length > 10 ||
    !redirectUris.every(isAllowedRedirectUri)
  ) {
    const error = new Error(
      "redirect_uris must contain 1-10 secure HTTPS URLs (localhost HTTP is allowed).",
    );
    error.code = "invalid_redirect_uri";
    throw error;
  }

  const grantTypes =
    Array.isArray(payload.grant_types) && payload.grant_types.length
      ? payload.grant_types
      : ["authorization_code", "refresh_token"];
  if (
    grantTypes.some(
      (grant) => !["authorization_code", "refresh_token"].includes(grant),
    )
  ) {
    const error = new Error(
      "Only authorization_code and refresh_token grants are supported.",
    );
    error.code = "invalid_client_metadata";
    throw error;
  }

  const clientId = `spc_${randomBytes(24).toString("base64url")}`;
  const clientName = String(payload.client_name || "ChatGPT connector").slice(
    0,
    120,
  );
  await dbHelpers.createOAuthClient(
    clientId,
    clientName,
    redirectUris,
    grantTypes,
  );

  return {
    client_id: clientId,
    client_name: clientName,
    redirect_uris: redirectUris,
    grant_types: grantTypes,
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}

export async function validateAuthorizationRequest(params) {
  const clientId = String(params.client_id || "");
  const redirectUri = String(params.redirect_uri || "");
  const responseType = String(params.response_type || "");
  const codeChallenge = String(params.code_challenge || "");
  const codeChallengeMethod = String(params.code_challenge_method || "");

  const client = await dbHelpers.getOAuthClient(clientId);
  const registeredRedirects = safeJsonArray(client?.redirectUris);

  if (!client) {
    const error = new Error("Unknown OAuth client.");
    error.code = "invalid_client";
    throw error;
  }
  if (responseType !== "code") {
    const error = new Error("Only the code response type is supported.");
    error.code = "unsupported_response_type";
    throw error;
  }
  if (!registeredRedirects.includes(redirectUri)) {
    const error = new Error(
      "redirect_uri does not match the registered client.",
    );
    error.code = "invalid_redirect_uri";
    throw error;
  }
  if (
    codeChallengeMethod !== "S256" ||
    !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)
  ) {
    const error = new Error(
      "PKCE with a valid S256 code challenge is required.",
    );
    error.code = "invalid_request";
    throw error;
  }

  return {
    client,
    clientId,
    redirectUri,
    codeChallenge,
    scopes: parseRequestedScopes(params.scope),
    state: params.state ? String(params.state) : "",
  };
}

export async function issueAuthorizationCode({ params, userId }) {
  const validated = await validateAuthorizationRequest(params);
  const rawCode = `spa_${randomBytes(32).toString("base64url")}`;
  await dbHelpers.createOAuthAuthorizationCode({
    codeHash: hashToken(rawCode),
    clientId: validated.clientId,
    userId,
    redirectUri: validated.redirectUri,
    codeChallenge: validated.codeChallenge,
    scopes: validated.scopes,
    expiresAt: new Date(Date.now() + AUTHORIZATION_CODE_LIFETIME_MS),
  });
  return { ...validated, code: rawCode };
}

function createOpaqueCredential(prefix, byteLength) {
  return `${prefix}_${randomBytes(byteLength).toString("base64url")}`;
}
async function issueTokenPair({ clientId, userId, scopes }) {
  const bearerValue = createOpaqueCredential("spm", 32);
  const accessKeyId = uuidv4();
  const accessExpiresAt = new Date(Date.now() + ACCESS_TOKEN_LIFETIME_MS);

  await dbHelpers.createApiKey(
    accessKeyId,
    userId,
    hashApiKey(bearerValue),
    `${bearerValue.slice(0, 12)}...`,
    "ChatGPT connector",
    JSON.stringify(scopes),
    null,
    accessExpiresAt,
    120,
  );

  const renewalValue = createOpaqueCredential("spr", 40);
  await dbHelpers.createOAuthRefreshToken({
    tokenHash: hashToken(renewalValue),
    clientId,
    userId,
    scopes,
    accessKeyId,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_LIFETIME_MS),
  });

  return {
    bearerValue,
    renewalValue,
    expiresIn: Math.floor(ACCESS_TOKEN_LIFETIME_MS / 1000),
    scopes,
  };
}
export async function exchangeAuthorizationCode(payload) {
  const code = String(payload.code || "");
  const clientId = String(payload.client_id || "");
  const redirectUri = String(payload.redirect_uri || "");
  const verifier = String(payload.code_verifier || "");

  if (
    !code ||
    !clientId ||
    !redirectUri ||
    !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)
  ) {
    const error = new Error(
      "code, client_id, redirect_uri, and a valid PKCE verifier are required.",
    );
    error.code = "invalid_request";
    throw error;
  }

  const codeHash = hashToken(code);
  const record = await dbHelpers.getOAuthAuthorizationCode(codeHash);
  if (
    !record ||
    record.used ||
    record.clientId !== clientId ||
    record.redirectUri !== redirectUri
  ) {
    const error = new Error(
      "Authorization code is invalid, expired, used, or belongs to another client.",
    );
    error.code = "invalid_grant";
    throw error;
  }
  if (new Date(record.expiresAt).getTime() <= Date.now()) {
    const error = new Error("Authorization code expired.");
    error.code = "invalid_grant";
    throw error;
  }

  const expectedChallenge = createHash("sha256")
    .update(verifier)
    .digest("base64url");
  if (expectedChallenge !== record.codeChallenge) {
    const error = new Error("PKCE verification failed.");
    error.code = "invalid_grant";
    throw error;
  }

  const consumed = await dbHelpers.consumeOAuthAuthorizationCode(codeHash);
  if (!consumed) {
    const error = new Error("Authorization code was already used.");
    error.code = "invalid_grant";
    throw error;
  }

  return issueTokenPair({
    clientId,
    userId: record.userId,
    scopes: safeJsonArray(record.scopes),
  });
}

export async function exchangeRefreshToken(payload) {
  const renewalValue = String(payload.refresh_token || "");
  const clientId = String(payload.client_id || "");
  if (!renewalValue || !clientId) {
    const error = new Error("refresh_token and client_id are required.");
    error.code = "invalid_request";
    throw error;
  }

  const tokenHash = hashToken(renewalValue);
  const record = await dbHelpers.getOAuthRefreshToken(tokenHash);
  if (
    !record ||
    record.revoked ||
    record.clientId !== clientId ||
    new Date(record.expiresAt).getTime() <= Date.now()
  ) {
    const error = new Error(
      "Refresh token is invalid, revoked, expired, or belongs to another client.",
    );
    error.code = "invalid_grant";
    throw error;
  }

  const consumed = await dbHelpers.consumeOAuthRefreshToken(tokenHash);
  if (!consumed) {
    const error = new Error("Refresh token was already used.");
    error.code = "invalid_grant";
    throw error;
  }
  if (record.accessKeyId) {
    await dbHelpers.deleteApiKey(record.accessKeyId, record.userId);
  }

  return issueTokenPair({
    clientId,
    userId: record.userId,
    scopes: safeJsonArray(record.scopes),
  });
}
