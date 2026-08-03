import { GoogleGenAI } from "@google/genai";
import { logger } from "../utils/logger.js";

const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const MIN_REQUEST_TIMEOUT_MS = 30_000;
const MAX_REQUEST_TIMEOUT_MS = 300_000;

const getRequestTimeoutMs = () => {
  const configured = Number.parseInt(
    process.env.GEMINI_PDF_TIMEOUT_MS || "",
    10,
  );
  if (!Number.isFinite(configured)) return DEFAULT_REQUEST_TIMEOUT_MS;
  return Math.min(
    MAX_REQUEST_TIMEOUT_MS,
    Math.max(MIN_REQUEST_TIMEOUT_MS, configured),
  );
};

export class GeminiKeyPool {
  constructor(configuredCredentials = null) {
    this.keys = [];
    this.keyHealth = new Map();
    this.loadKeys(configuredCredentials);
  }

  loadKeys(configuredCredentials = null) {
    const configured =
      configuredCredentials ??
      (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "");
    this.keys = [
      ...new Set(
        configured
          .split(/[,;]/)
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ];

    if (this.keys.length === 0) {
      logger.info("[Gemini] No server-side credential configured.");
      return;
    }

    logger.info(`[Gemini] Configured ${this.keys.length} credential(s).`);
    for (const key of this.keys) {
      this.keyHealth.set(key, {
        failures: 0,
        lastUsed: 0,
        blockedUntil: 0,
        disabled: false,
      });
    }
  }

  getAvailableCredential() {
    const now = Date.now();
    const selectedKey =
      this.keys
        .filter((key) => {
          const health = this.keyHealth.get(key);
          return !health.disabled && health.blockedUntil <= now;
        })
        .sort(
          (left, right) =>
            this.keyHealth.get(left).lastUsed -
            this.keyHealth.get(right).lastUsed,
        )[0] || null;

    if (!selectedKey) {
      throw new Error("Gemini credentials are temporarily unavailable.");
    }

    this.keyHealth.get(selectedKey).lastUsed = now;
    return selectedKey;
  }

  async generateContent(model, prompt, systemInstruction = null) {
    if (this.keys.length === 0) {
      throw new Error("Gemini document extraction is not configured.");
    }

    let attempts = 0;
    const maxRetries = Math.min(this.keys.length, 5);

    while (attempts < maxRetries) {
      const credential = this.getAvailableCredential();

      try {
        const client = new GoogleGenAI({ apiKey: credential });
        const response = await client.models.generateContent({
          model,
          contents: prompt,
          config: {
            systemInstruction: systemInstruction || undefined,
            temperature: 0.4,
            maxOutputTokens: 32768,
            httpOptions: {
              timeout: getRequestTimeoutMs(),
              retryOptions: { attempts: 1 },
            },
          },
        });
        const text = String(response.text ?? "").trim();

        if (!text) throw new Error("EMPTY_RESPONSE_FROM_GEMINI");

        return {
          text,
          usageMetadata: response.usageMetadata,
        };
      } catch (error) {
        const stats = this.keyHealth.get(credential);
        attempts += 1;
        stats.failures += 1;

        const message = String(error?.message || "");
        const errorStatus = Number.isFinite(error?.status)
          ? Number(error.status)
          : /\b429\b/.test(message)
            ? 429
            : 500;

        if (errorStatus === 401 || errorStatus === 403) {
          stats.disabled = true;
        } else if (
          errorStatus === 429 ||
          message.toLowerCase().includes("quota")
        ) {
          stats.blockedUntil = Date.now() + 60_000;
        }

        logger.warn(
          `[Gemini] Request attempt ${attempts}/${maxRetries} failed (HTTP ${errorStatus}).`,
        );
      }
    }

    throw new Error(
      `Gemini document extraction is unavailable after ${attempts} attempt(s).`,
    );
  }
}

export const geminiPool = new GeminiKeyPool();
export default geminiPool;
