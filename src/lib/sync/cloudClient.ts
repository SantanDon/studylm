/**
 * Cloud storage client for encrypted sync
 *
 * Handles communication with cloud storage backend.
 * All data is encrypted before upload, server only stores encrypted blobs.
 */

import type { EncryptedData } from "../encryption/types";

export interface EncryptedEntity {
  id: string;
  userId: string;
  type:
    "notebook" | "source" | "note" | "chat" | "flashcard" | "quiz" | "podcast";
  encryptedData: string; // JSON-stringified EncryptedData blob
  salt: string; // Base64 salt
  checksum: string; // SHA-256 of plaintext
  version: number;
  createdAt: string; // ISO date
  updatedAt: string; // ISO date
  syncStatus: "synced" | "pending" | "conflict";
}

export interface CloudClientConfig {
  baseUrl: string;
}

/**
 * Cloud storage client — all requests use credentials: 'include' so that
 * HttpOnly auth cookies are forwarded automatically, and path aliases now
 * match the backend router exactly.
 */
export class CloudClient {
  private config: CloudClientConfig;

  constructor(config: CloudClientConfig) {
    this.config = config;
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.config.baseUrl}${endpoint}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    };

    const response = await fetch(url, {
      ...options,
      headers,
      credentials: "include", // Always transmit HttpOnly cookies
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`API error (${response.status}): ${body}`);
    }

    return response.json() as Promise<T>;
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Upload encrypted entity — POST /api/sync/upload
   */
  async upload(
    entity: EncryptedEntity,
  ): Promise<{ success: boolean; id: string; version: number }> {
    return this.request("/api/sync/upload", {
      method: "POST",
      body: JSON.stringify({
        id: entity.id,
        type: entity.type,
        encryptedData: entity.encryptedData,
        checksum: entity.checksum,
        version: entity.version,
      }),
    });
  }

  /**
   * Download encrypted entity — GET /api/sync/download/:id
   */
  async download(entityId: string): Promise<EncryptedEntity | null> {
    try {
      return await this.request<EncryptedEntity>(
        `/api/sync/download/${entityId}`,
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("404")) {
        return null;
      }
      throw error;
    }
  }

  /**
   * List all synced entities — GET /api/sync/list
   */
  async list(type?: string): Promise<EncryptedEntity[]> {
    const qs = type ? `?type=${encodeURIComponent(type)}` : "";
    const result = await this.request<{ items: EncryptedEntity[] }>(
      `/api/sync/list${qs}`,
    );
    return result.items ?? [];
  }

  /**
   * Delete entity — DELETE /api/sync/delete/:id
   */
  async delete(entityId: string): Promise<void> {
    await this.request<void>(`/api/sync/delete/${entityId}`, {
      method: "DELETE",
    });
  }

  /**
   * Sync status — GET /api/sync/status
   */
  async getStatus(): Promise<{
    totalItems: number;
    totalSize: number;
    lastSync: string | null;
  }> {
    return this.request("/api/sync/status");
  }

  /**
   * Batch upload — POST /api/sync/batch-upload
   */
  async batchUpload(
    items: Array<{
      id: string;
      type: string;
      encryptedData: string;
      checksum: string;
      version?: number;
    }>,
  ): Promise<
    Array<{ id: string; success: boolean; version?: number; error?: string }>
  > {
    const result = await this.request<{
      results: Array<{
        id: string;
        success: boolean;
        version?: number;
        error?: string;
      }>;
    }>("/api/sync/batch-upload", {
      method: "POST",
      body: JSON.stringify({ items }),
    });
    return result.results ?? [];
  }

  /**
   * Check reachability
   */
  async ping(): Promise<boolean> {
    try {
      await this.request("/health");
      return true;
    } catch {
      return false;
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function createEncryptedEntity(
  id: string,
  userId: string,
  type: EncryptedEntity["type"],
  encryptedData: EncryptedData,
  salt: string,
  plaintextChecksum: string,
  version = 1,
): EncryptedEntity {
  const blob = JSON.stringify(encryptedData);
  return {
    id,
    userId,
    type,
    encryptedData: blob,
    salt,
    checksum: plaintextChecksum,
    version,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    syncStatus: "pending",
  };
}

export function parseEncryptedEntity(entity: EncryptedEntity): EncryptedData {
  return JSON.parse(entity.encryptedData) as EncryptedData;
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let defaultClient: CloudClient | null = null;

export function initializeCloudClient(config: CloudClientConfig): void {
  defaultClient = new CloudClient(config);
}

export function getCloudClient(): CloudClient {
  if (!defaultClient) {
    throw new Error(
      "Cloud client not initialized. Call initializeCloudClient() first.",
    );
  }
  return defaultClient;
}
