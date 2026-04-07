import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { HocuspocusProvider } from '@hocuspocus/provider';

/**
 * SyncManager
 * 
 * Orchestrates Local-First + Team-Sync logic.
 * 1. Local-First: Backed by IndexedDB via Yjs.
 * 2. Team-Sync: Synchronized via Hocuspocus (WebSockets).
 */
export class SyncManager {
  private docs: Map<string, Y.Doc> = new Map();
  private providers: Map<string, HocuspocusProvider> = new Map();
  private persistence: Map<string, IndexeddbPersistence> = new Map();

  /**
   * Get or create a synchronized document for a notebook.
   */
  public getNotebookDoc(notebookId: string, token: string): Y.Doc {
    if (this.docs.has(notebookId)) {
      return this.docs.get(notebookId)!;
    }

    const doc = new Y.Doc();
    this.docs.set(notebookId, doc);

    // 1. Local Persistence (IndexedDB)
    const indexeddb = new IndexeddbPersistence(`notebook-${notebookId}`, doc);
    this.persistence.set(notebookId, indexeddb);

    // 2. Network Sync (Hocuspocus)
    // In a real app, this URL would come from config
    const provider = new HocuspocusProvider({
      url: 'ws://localhost:3001/api/sync-relay',
      name: notebookId,
      document: doc,
      token: token,
      onConnect: () => console.log(`[Sync] Connected to notebook: ${notebookId}`),
      onDisconnect: () => console.log(`[Sync] Offline for notebook: ${notebookId}`),
    });
    this.providers.set(notebookId, provider);

    return doc;
  }

  /**
   * Get the real-time agent state for a notebook.
   * This is where the Council's internal thoughts are streamed.
   */
  public getAgentState(notebookId: string): Y.Map<unknown> {
    const doc = this.docs.get(notebookId);
    if (!doc) {
      throw new Error(`[Sync] Document not initialized for notebook: ${notebookId}`);
    }
    return doc.getMap('agent_state');
  }

  /**
   * Clean up resources for a notebook.
   */
  public destroyNotebook(notebookId: string) {
    this.providers.get(notebookId)?.destroy();
    this.persistence.get(notebookId)?.destroy();
    this.docs.delete(notebookId);
    this.providers.delete(notebookId);
    this.persistence.delete(notebookId);
  }
}

export const syncManager = new SyncManager();
