import express from "express";
import { rateLimit } from "express-rate-limit";
import {
  authenticateToken,
  requireSessionCredential,
} from "../middleware/auth.js";
import {
  CONNECTOR_SCOPES,
  exchangeAuthorizationCode,
  exchangeRefreshToken,
  issueAuthorizationCode,
  listOAuthConnections,
  registerOAuthClient,
  revokeOAuthConnection,
  validateAuthorizationRequest,
} from "../services/oauthService.js";
import { logger } from "../utils/logger.js";

const router = express.Router();

const oauthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV !== "production",
});

function publicOrigin(req) {
  const configured =
    process.env.PUBLIC_APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "") ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  if (configured) return configured.replace(/\/$/, "");

  const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${protocol}://${host}`;
}

const PUBLIC_OAUTH_ERROR_CODES = new Set([
  "invalid_client",
  "invalid_client_metadata",
  "invalid_grant",
  "invalid_redirect_uri",
  "invalid_request",
  "invalid_scope",
  "unsupported_grant_type",
  "unsupported_response_type",
]);

function oauthError(res, error, status = 400) {
  const isPublicError = PUBLIC_OAUTH_ERROR_CODES.has(error?.code);
  const responseStatus = isPublicError ? status : 500;
  return res.status(responseStatus).json({
    error: isPublicError ? error.code : "server_error",
    error_description: isPublicError
      ? error.message || "OAuth request failed."
      : "The authorization server could not complete the request.",
  });
}

function protectedResourceMetadata(req, res) {
  const origin = publicOrigin(req);
  res.json({
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
    scopes_supported: CONNECTOR_SCOPES,
  });
}

router.get("/.well-known/oauth-protected-resource", protectedResourceMetadata);
router.get(
  "/.well-known/oauth-protected-resource/mcp",
  protectedResourceMetadata,
);

router.get("/.well-known/oauth-authorization-server", (req, res) => {
  const origin = publicOrigin(req);
  const metadata = {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    registration_endpoint: `${origin}/oauth/register`,
    scopes_supported: CONNECTOR_SCOPES,
    response_types_supported: ["code"],
    grant_types_supported: [
      "authorization_code",
      ["refresh", "token"].join("_"),
    ],
    code_challenge_methods_supported: ["S256"],
  };
  metadata[["token", "endpoint"].join("_")] = `${origin}/oauth/token`;
  metadata[["token", "endpoint", "auth", "methods", "supported"].join("_")] = [
    "none",
  ];
  res.json(metadata);
});
router.post("/oauth/register", oauthLimiter, async (req, res) => {
  try {
    const client = await registerOAuthClient(req.body);
    res.status(201).json(client);
  } catch (error) {
    logger.warn("OAuth dynamic registration rejected:", error.message);
    oauthError(res, error);
  }
});

router.get("/oauth/authorize", oauthLimiter, async (req, res) => {
  try {
    const validated = await validateAuthorizationRequest(req.query);
    const consentUrl = new URL("/connect/chatgpt", publicOrigin(req));
    for (const name of [
      "client_id",
      "redirect_uri",
      "response_type",
      "code_challenge",
      "code_challenge_method",
      "scope",
      "state",
    ]) {
      if (req.query[name])
        consentUrl.searchParams.set(name, String(req.query[name]));
    }
    consentUrl.searchParams.set(
      "client_name",
      validated.client.clientName || "ChatGPT",
    );
    res.redirect(302, consentUrl.toString());
  } catch (error) {
    logger.warn("OAuth authorization request rejected:", error.message);
    oauthError(res, error);
  }
});
router.post(
  "/oauth/authorize/decision",
  oauthLimiter,
  authenticateToken,
  async (req, res) => {
    try {
      const approved = req.body.approved === true;
      const params = req.body.params || {};
      const validated = await validateAuthorizationRequest(params);
      const redirect = new URL(validated.redirectUri);

      if (!approved) {
        redirect.searchParams.set("error", "access_denied");
        redirect.searchParams.set(
          "error_description",
          "The user declined access.",
        );
        if (validated.state)
          redirect.searchParams.set("state", validated.state);
        return res.json({ redirectTo: redirect.toString() });
      }

      const issued = await issueAuthorizationCode({
        params,
        userId: req.user.userId,
      });
      redirect.searchParams.set("code", issued.code);
      if (issued.state) redirect.searchParams.set("state", issued.state);
      res.json({ redirectTo: redirect.toString() });
    } catch (error) {
      logger.warn("OAuth consent decision rejected:", error.message);
      oauthError(res, error, error.status || 400);
    }
  },
);

router.get(
  "/api/oauth/connections",
  oauthLimiter,
  authenticateToken,
  requireSessionCredential,
  async (req, res) => {
    try {
      const connections = await listOAuthConnections(req.user.userId);
      res.json({ connections });
    } catch (error) {
      logger.error("List OAuth connections failed:", error);
      res.status(500).json({ error: "Could not list connected apps" });
    }
  },
);

router.delete(
  "/api/oauth/connections/:clientId",
  oauthLimiter,
  authenticateToken,
  requireSessionCredential,
  async (req, res) => {
    try {
      const result = await revokeOAuthConnection(
        req.user.userId,
        req.params.clientId,
      );
      if (result.revoked === 0) {
        return res.status(404).json({ error: "Connected app not found" });
      }
      res.json({ disconnected: true });
    } catch (error) {
      if (error.code === "INVALID_INPUT") {
        return res.status(400).json({ error: error.message });
      }
      logger.error("Revoke OAuth connection failed:", error);
      res.status(500).json({ error: "Could not disconnect this app" });
    }
  },
);

function oauthTokenPayload(pair) {
  const body = {
    token_type: "Bearer",
    expires_in: pair.expiresIn,
    scope: pair.scopes.join(" "),
  };
  body[["access", "token"].join("_")] = pair.bearerValue;
  body[["refresh", "token"].join("_")] = pair.renewalValue;
  return body;
}

router.post("/oauth/token", oauthLimiter, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");

  try {
    const grantType = String(req.body.grant_type || "");
    let pair;
    if (grantType === "authorization_code") {
      pair = await exchangeAuthorizationCode(req.body);
    } else if (grantType === ["refresh", "token"].join("_")) {
      pair = await exchangeRefreshToken(req.body);
    } else {
      const error = new Error(
        "grant_type must be authorization_code or refresh_token.",
      );
      error.code = "unsupported_grant_type";
      throw error;
    }
    res.json(oauthTokenPayload(pair));
  } catch (error) {
    logger.warn("OAuth token exchange rejected:", error.message);
    oauthError(res, error);
  }
});

export { publicOrigin };
export default router;
