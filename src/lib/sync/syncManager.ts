/**
 * Sync Manager Service
 * 
 * Orchestrates automatic syncing of encrypted data to the cloud.
 * Handles queue processing, conflict resolution, and retry logic.
 */

import { useSyncStore } from '@/stores/syncStore';
import { useEncryptionStore } from '@/stores/encryptionStore';
import { SyncQueue } from './queue';
import { CloudClient } from './cloudClient';
import { encrypt } from '@/lib/encryption/encryption';
import { generateChecksum } from '@/lib/encryption/integrity';
import type { EncryptedData } from '@/lib/encryption/types';

export interface ISyncManager {
  initialize(): void;
  shutdown(): void;
  queueSync(entityId: string, entityType: string, data: unknown, operationType?: 'create' | 'update' | 'delete'): Promise<void>;
  processQueue(): Promise<void>;
  triggerSync(): Promise<void>;
  downloadData(entityId: string): Promise<unknown>;
  listSyncedItems(type?: string): Promise<unknown>;
  deleteData(entityId: string): Promise<void>;
}

class SyncManager implements ISyncManager {
  private queue: SyncQueue;
  private cloudClient: CloudClient;
  private isProcessing = false;
  private processingInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.queue = new SyncQueue();
    // In production (Vercel), we use relative paths or provide VITE_API_URL
    const apiBase = import.meta.env.VITE_API_URL || '';
    const cleanApiBase = apiBase.endsWith('/api') ? apiBase.slice(0, -4) : apiBase;
    this.cloudClient = new CloudClient({ baseUrl: cleanApiBase || window.location.origin });
  }

  /**
   * Initialize sync manager
   * Sets up automatic sync processing
   */
  initialize() {
    // Process queue every 30 seconds
    this.processingInterval = setInterval(() => {
      this.processQueue();
    }, 30000);

    // Process queue on online event
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.processQueue();
      });
    }

    // Initial queue processing
    this.processQueue();
  }

  /**
   * Shutdown sync manager
   */
  shutdown() {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
  }

  /**
   * Queue data for sync
   */
  async queueSync(entityId: string, entityType: string, data: unknown, operationType: 'create' | 'update' | 'delete' = 'update') {
    const { masterKey, userId } = useEncryptionStore.getState();
    
    if (!masterKey || !userId) {
      console.warn('Cannot queue sync: no encryption key or user context available');
      return;
    }

    try {
      // Encrypt data
      const dataString = JSON.stringify(data);
      const encrypted = await encrypt(dataString, masterKey);

      // Add to queue
      await this.queue.add({
        type: operationType,
        entityType: entityType as "notebook" | "source" | "note" | "chat",
        entityId,
        data: encrypted,
        metadata: {
          userId,
          entityType,
          entityId,
          timestamp: Date.now()
        }
      });

      // Update pending count
      const status = this.queue.getStatus();
      useSyncStore.getState().setPendingOperations(status.pending);

      // Trigger immediate processing if online
      if (navigator.onLine) {
        this.processQueue();
      }
    } catch (error) {
      console.error('Failed to queue sync:', error);
    }
  }

  /**
   * Process sync queue
   */
  async processQueue() {
    // Don't process if already processing or offline
    if (this.isProcessing || !navigator.onLine) {
      return;
    }

    const { isSyncing } = useSyncStore.getState();
    if (isSyncing) {
      return;
    }

    const { masterKey, userId } = useEncryptionStore.getState();
    if (!masterKey || !userId) {
      console.warn('Cannot process sync queue: no encryption key or user context available');
      return;
    }

    this.isProcessing = true;
    useSyncStore.getState().setSyncing(true);

    try {
      await this.queue.process();

      // Update sync state
      const status = this.queue.getStatus();
      
      useSyncStore.getState().setPendingOperations(status.pending);
      useSyncStore.getState().setFailedOperations(status.failed);
      useSyncStore.getState().setLastSyncTime(Date.now());
      useSyncStore.getState().setError(null);
    } catch (error) {
      console.error('Queue processing error:', error);
      useSyncStore.getState().setError(
        error instanceof Error ? error.message : 'Sync failed'
      );
    } finally {
      this.isProcessing = false;
      useSyncStore.getState().setSyncing(false);
    }
  }

  /**
   * Trigger manual sync
   */
  async triggerSync() {
    await this.processQueue();
  }

  /**
   * Download and decrypt data from cloud
   */
  async downloadData(entityId: string) {
    const { masterKey } = useEncryptionStore.getState();
    
    if (!masterKey) {
      throw new Error('No encryption key available');
    }

    try {
      const remoteData = await this.cloudClient.download(entityId);
      
      if (!remoteData) {
        return null;
      }

      // Verify checksum
      const { verifyChecksum } = await import('@/lib/encryption/integrity');
      const isValid = await verifyChecksum(remoteData.encryptedData, remoteData.checksum);
      
      if (!isValid) {
        throw new Error('Data integrity check failed');
      }

      // Decrypt data
      const { decrypt } = await import('@/lib/encryption/encryption');
      const encryptedData: EncryptedData = JSON.parse(remoteData.encryptedData);
      const decrypted = await decrypt(encryptedData, masterKey);
      
      return JSON.parse(decrypted);
    } catch (error) {
      console.error('Failed to download data:', error);
      throw error;
    }
  }

  /**
   * List all synced items
   */
  async listSyncedItems(type?: string) {
    try {
      return await this.cloudClient.list(type);
    } catch (error) {
      console.error('Failed to list synced items:', error);
      throw error;
    }
  }

  /**
   * Delete synced data
   */
  async deleteData(entityId: string) {
    try {
      await this.cloudClient.delete(entityId);
      this.queue.remove(entityId);
    } catch (error) {
      console.error('Failed to delete data:', error);
      throw error;
    }
  }
}

// Singleton instance
let syncManagerInstance: ISyncManager | null = null;

export function getSyncManager(): ISyncManager {
  if (!syncManagerInstance) {
    syncManagerInstance = new SyncManager();
  }
  return syncManagerInstance;
}

export function initializeSyncManager() {
  const manager = getSyncManager();
  manager.initialize();
  return manager;
}

export function shutdownSyncManager() {
  if (syncManagerInstance) {
    syncManagerInstance.shutdown();
    syncManagerInstance = null;
  }
}
