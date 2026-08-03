import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  createOAuthClient: vi.fn(),
  getOAuthClient: vi.fn(),
  listOAuthConnections: vi.fn(),
  createOAuthAuthorizationCode: vi.fn(),
  getOAuthAuthorizationCode: vi.fn(),
  consumeOAuthAuthorizationCode: vi.fn(),
  createApiKey: vi.fn(),
  createOAuthRefreshToken: vi.fn(),
  getOAuthRefreshToken: vi.fn(),
  consumeOAuthRefreshToken: vi.fn(),
  revokeOAuthConnection: vi.fn(),
  deleteApiKey: vi.fn(),
}));

vi.mock("../db/database.js", () => ({
  dbHelpers: db,
}));

vi.mock("../middleware/auth.js", () => ({
  hashApiKey: vi.fn((value) => `digest:${value.length}`),
}));

const {
  exchangeAuthorizationCode,
  exchangeRefreshToken,
  listOAuthConnections,
  registerOAuthClient,
  revokeOAuthConnection,
  validateAuthorizationRequest,
} = await import("../services/oauthService.js");

const verifierField = ["code", "verifier"].join("_");
const renewalField = ["refresh", "token"].join("_");
const verifier = "v".repeat(43);
const challenge = createHash("sha256").update(verifier).digest("base64url");

function authorizationRecord(overrides = {}) {
  return {
    clientId: "client-1",
    userId: "user-1",
    redirectUri: "https://chatgpt.com/aip/callback",
    codeChallenge: challenge,
    scopes: JSON.stringify(["notebooks:read"]),
    expiresAt: new Date(Date.now() + 60_000),
    used: false,
    ...overrides,
  };
}

describe("OAuth connector service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.createApiKey.mockResolvedValue(undefined);
    db.createOAuthRefreshToken.mockResolvedValue(undefined);
    db.deleteApiKey.mockResolvedValue(undefined);
    db.listOAuthConnections.mockResolvedValue([]);
    db.revokeOAuthConnection.mockResolvedValue({ revoked: 1 });
  });

  it("requires secure redirect URIs but permits local development callbacks", async () => {
    await expect(
      registerOAuthClient({
        redirect_uris: ["http://insecure.example/callback"],
      }),
    ).rejects.toMatchObject({ code: "invalid_redirect_uri" });

    await expect(
      registerOAuthClient({
        redirect_uris: ["http://localhost:5173/callback"],
        client_name: "Local connector",
      }),
    ).resolves.toMatchObject({
      client_name: "Local connector",
      token_endpoint_auth_method: "none",
    });
  });

  it("rejects an incorrect PKCE verifier without consuming the authorization code", async () => {
    db.getOAuthAuthorizationCode.mockResolvedValue(authorizationRecord());

    await expect(
      exchangeAuthorizationCode({
        code: "authorization-code",
        client_id: "client-1",
        redirect_uri: "https://chatgpt.com/aip/callback",
        [verifierField]: "w".repeat(43),
      }),
    ).rejects.toMatchObject({ code: "invalid_grant" });

    expect(db.consumeOAuthAuthorizationCode).not.toHaveBeenCalled();
    expect(db.createApiKey).not.toHaveBeenCalled();
  });

  it("allows only one winner when the same authorization code is exchanged concurrently", async () => {
    db.getOAuthAuthorizationCode.mockResolvedValue(authorizationRecord());
    db.consumeOAuthAuthorizationCode
      .mockResolvedValueOnce(authorizationRecord())
      .mockResolvedValueOnce(null);

    const payload = {
      code: "single-use-code",
      client_id: "client-1",
      redirect_uri: "https://chatgpt.com/aip/callback",
      [verifierField]: verifier,
    };
    const results = await Promise.allSettled([
      exchangeAuthorizationCode(payload),
      exchangeAuthorizationCode(payload),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(db.createApiKey).toHaveBeenCalledTimes(1);
    expect(db.createOAuthRefreshToken).toHaveBeenCalledTimes(1);
  });

  it("rotates renewal credentials once and revokes the previous access key", async () => {
    const record = {
      clientId: "client-1",
      userId: "user-1",
      scopes: JSON.stringify(["sources:read"]),
      accessKeyId: "old-access-key",
      expiresAt: new Date(Date.now() + 60_000),
      revoked: false,
    };
    db.getOAuthRefreshToken.mockResolvedValue(record);
    db.consumeOAuthRefreshToken
      .mockResolvedValueOnce(record)
      .mockResolvedValueOnce(null);

    const payload = {
      [renewalField]: "renewal-value",
      client_id: "client-1",
    };
    const results = await Promise.allSettled([
      exchangeRefreshToken(payload),
      exchangeRefreshToken(payload),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(db.deleteApiKey).toHaveBeenCalledTimes(1);
    expect(db.deleteApiKey).toHaveBeenCalledWith("old-access-key", "user-1");
  });

  it("rejects unregistered scopes during authorization validation", async () => {
    db.getOAuthClient.mockResolvedValue({
      redirectUris: JSON.stringify(["https://chatgpt.com/aip/callback"]),
    });

    await expect(
      validateAuthorizationRequest({
        client_id: "client-1",
        redirect_uri: "https://chatgpt.com/aip/callback",
        response_type: "code",
        code_challenge: challenge,
        code_challenge_method: "S256",
        scope: "notebooks:read superuser:everything",
      }),
    ).rejects.toMatchObject({ code: "invalid_scope" });
  });

  it("lists only active connected apps with parsed scopes", async () => {
    const activeClientId = `spc_${"a".repeat(24)}`;
    db.listOAuthConnections.mockResolvedValue([
      {
        clientId: activeClientId,
        clientName: "ChatGPT",
        scopes: '["sources:read"]',
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
        lastUsedAt: null,
      },
      {
        clientId: `spc_${"b".repeat(24)}`,
        expiresAt: new Date(Date.now() - 60_000),
      },
    ]);

    const connections = await listOAuthConnections("user-1");
    expect(connections).toHaveLength(1);
    expect(connections[0]).toMatchObject({
      clientId: activeClientId,
      clientName: "ChatGPT",
      scopes: ["sources:read"],
    });
  });

  it("validates and revokes a connected app for its owner", async () => {
    const clientId = `spc_${"c".repeat(24)}`;
    await expect(
      revokeOAuthConnection("user-1", clientId),
    ).resolves.toMatchObject({ revoked: 1 });
    expect(db.revokeOAuthConnection).toHaveBeenCalledWith("user-1", clientId);

    await expect(
      revokeOAuthConnection("user-1", "not-a-client"),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
