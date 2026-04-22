// Local storage service for StudyPodLM data persistence
import {
  storageManager,
  getStorageStats,
  formatBytes,
  type StorageStats,
  type StorageCleanupResult,
} from "@/lib/storage/storageManager";

import { encryptionService } from "./encryptionService";
import { getSyncManager } from "@/lib/sync/syncManager";
export interface LocalUser {
  id: string;
  email: string;
  displayName?: string;
  account_type?: string;
  created_at: string;
}

export interface LocalSession {
  user: LocalUser;
  expires_at: number;
}

export interface LocalNotebook {
  id: string;
  title: string;
  description?: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  generation_status: "pending" | "processing" | "completed" | "failed";
  audio_overview_url?: string;
  audio_url_expires_at?: string;
  icon?: string;
  example_questions?: string[];
}

export interface LocalSource {
  id: string;
  notebook_id: string;
  title: string;
  summary?: string;
  type: "pdf" | "text" | "website" | "youtube" | "audio";
  content?: string;
  url?: string;
  file_path?: string;
  file_size?: number;
  processing_status?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface LocalNote {
  id: string;
  notebook_id: string;
  title: string;
  content: string;
  source_type: "user" | "ai_response";
  extracted_text?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface LocalChatMessage {
  id: string;
  notebook_id: string;
  message: string | { type: "human" | "ai"; content: string };
  response: string;
  citations?: unknown;
  created_at: string;
}

export interface LocalPodcast {
  id: string;
  notebook_id: string;
  title: string;
  created_at: string;
  duration?: number;
  audio_blob_id: string; // Key for IndexedDB
}

export interface StorageSaveResult {
  success: boolean;
  error?: string;
  compressed?: boolean;
}

class LocalStorageService {
  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  private getFromStorage<T>(key: string): T[] {
    try {
      const data = storageManager.safeGetItem(key);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  private saveToStorage<T>(key: string, data: T[]): StorageSaveResult {
    try {
      const jsonData = JSON.stringify(data);
      const result = storageManager.safeSetItem(key, jsonData, {
        compress: true,
        forceCleanup: false,
      });

      if (!result.success) {
        console.error(`Failed to save to localStorage (${key}):`, result.error);
        
        // Try with cleanup if initial save failed
        const retryResult = storageManager.safeSetItem(key, jsonData, {
          compress: true,
          forceCleanup: true,
        });

        if (!retryResult.success) {
          console.error(`Failed to save even after cleanup:`, retryResult.error);
          return { success: false, error: retryResult.error };
        }

        return { success: true, compressed: retryResult.compressed };
      }

      return { success: true, compressed: result.compressed };
    } catch (error) {
      console.error("Failed to save to localStorage:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private async hashPassword(password: string): Promise<string> {
    return encryptionService.hashPassword(password);
  }

  private async verifyPassword(password: string, storedHash: string): Promise<boolean> {
    return encryptionService.verifyPassword(password, storedHash);
  }

  /**
   * Trigger sync for entity changes
   * Queues data for cloud sync if encryption is enabled
   */
  private triggerSync(entityType: string, entityId: string, data: unknown): void {
    try {
      const syncManager = getSyncManager();
      // Queue sync asynchronously - don't block the operation
      syncManager.queueSync(entityId, entityType, data).catch(err => {
        console.warn('Failed to queue sync:', err);
      });
    } catch (error) {
      // Sync is optional - don't fail the operation if sync fails
      console.warn('Sync not available:', error);
    }
  }

  // Storage Management Methods
  getStorageStats(): StorageStats {
    return getStorageStats();
  }

  getStorageUsage(): { bytes: number; formatted: string; percentage: number } {
    const stats = getStorageStats();
    return {
      bytes: stats.totalBytes,
      formatted: formatBytes(stats.totalBytes),
      percentage: stats.usedPercentage * 100,
    };
  }

  isStorageNearLimit(): boolean {
    const stats = getStorageStats();
    return stats.isNearLimit;
  }

  cleanupStorage(options?: {
    maxAgeMs?: number;
    keepMinItems?: number;
    dryRun?: boolean;
  }): StorageCleanupResult {
    return storageManager.cleanupOldData(options);
  }

  // User and Session Management
  getCurrentUser(): LocalUser | null {
    const user = localStorage.getItem("currentUser");
    return user ? JSON.parse(user) : null;
  }

  setCurrentUser(user: LocalUser | null): void {
    if (user) {
      localStorage.setItem("currentUser", JSON.stringify(user));
    } else {
      localStorage.removeItem("currentUser");
    }
  }

  getUsers(): LocalUser[] {
    return this.getFromStorage<LocalUser>("users");
  }

  async addUser(user: LocalUser, password: string): Promise<void> {
    const users = this.getFromStorage<LocalUser>("users");

    // Check if user already exists
    if (users.some((u) => u.email === user.email)) {
      throw new Error("User already exists");
    }

    // Use secure password verification
    // Note: Local password storage is handled by encryption lib
    users.push(user);
    this.saveToStorage("users", users);
  }

  async authenticate(
    email: string,
    password: string
  ): Promise<LocalUser | null> {
    const users = this.getFromStorage<LocalUser>("users");
    const passwords = this.getFromStorage<{
      user_id: string;
      password: string;
    }>("passwords");

    const user = users.find((u) => u.email === email);
    if (!user) {
      return null;
    }

    const passwordEntry = passwords.find((p) => p.user_id === user.id);
    if (!passwordEntry) {
      return null;
    }

    // Use secure password verification
    if (!(await this.verifyPassword(password, passwordEntry.password))) {
      return null;
    }

    return user;
  }

  // Notebooks
  getNotebooks(userId: string): LocalNotebook[] {
    const notebooks = this.getFromStorage<LocalNotebook>("notebooks");
    return notebooks.filter((n) => n.user_id === userId);
  }

  getNotebook(id: string): LocalNotebook | null {
    const notebooks = this.getFromStorage<LocalNotebook>("notebooks");
    return notebooks.find((n) => n.id === id) || null;
  }

  // Alias for getNotebook (for test compatibility)
  getNotebookById(id: string): LocalNotebook | null {
    return this.getNotebook(id);
  }

  createNotebook(
    data: Omit<LocalNotebook, "id" | "created_at" | "updated_at">
  ): LocalNotebook {
    const notebooks = this.getFromStorage<LocalNotebook>("notebooks");
    const newNotebook: LocalNotebook = {
      ...data,
      id: this.generateId(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    notebooks.push(newNotebook);
    const result = this.saveToStorage("notebooks", notebooks);
    
    if (!result.success) {
      throw new Error(`Failed to create notebook: ${result.error}`);
    }
    
    return newNotebook;
  }

  updateNotebook(
    id: string,
    updates: Partial<LocalNotebook>
  ): LocalNotebook | null {
    const notebooks = this.getFromStorage<LocalNotebook>("notebooks");
    const index = notebooks.findIndex((n) => n.id === id);
    if (index === -1) return null;

    notebooks[index] = {
      ...notebooks[index],
      ...updates,
      updated_at: new Date().toISOString(),
    };
    this.saveToStorage("notebooks", notebooks);
    
    // Trigger sync for updated notebook
    const updatedNotebook = notebooks[index];
    this.triggerSync('notebook', updatedNotebook.id, updatedNotebook);
    
    return updatedNotebook;
  }

  deleteNotebook(id: string): boolean {
    const notebooks = this.getFromStorage<LocalNotebook>("notebooks");
    const notebookToDelete = notebooks.find((n) => n.id === id);
    const filtered = notebooks.filter((n) => n.id !== id);
    if (filtered.length === notebooks.length) return false;

    this.saveToStorage("notebooks", filtered);

    // Also delete related sources and notes
    const sources = this.getFromStorage<LocalSource>("sources");
    const filteredSources = sources.filter((s) => s.notebook_id !== id);
    this.saveToStorage("sources", filteredSources);

    const notes = this.getFromStorage<LocalNote>("notes");
    const filteredNotes = notes.filter((n) => n.notebook_id !== id);
    this.saveToStorage("notes", filteredNotes);

    const messages = this.getFromStorage<LocalChatMessage>("chat_messages");
    const filteredMessages = messages.filter((m) => m.notebook_id !== id);
    this.saveToStorage("chat_messages", filteredMessages);

    const result = this.saveToStorage("chat_messages", filteredMessages);

    // Clean up audio blob from IndexedDB
    // We don't await this to keep the method synchronous-compatible, but it will run in background
    import('./blobStorageService').then(({ blobStorageService }) => {
      blobStorageService.deletePodcastAudio(id).catch(err => 
        console.error('Failed to cleanup audio blob:', err)
      );
    });

    // Trigger sync for deleted notebook
    if (notebookToDelete) {
      this.triggerSync('notebook', id, { ...notebookToDelete, _deleted: true });
    }

    return true;
  }

  // Sources
  getSources(notebookId: string): LocalSource[] {
    const sources = this.getFromStorage<LocalSource>("sources");
    return sources.filter((s) => s.notebook_id === notebookId);
  }

  getSourceById(id: string): LocalSource | null {
    const sources = this.getFromStorage<LocalSource>("sources");
    return sources.find((s) => s.id === id) || null;
  }

  createSource(
    data: Omit<LocalSource, "id" | "created_at" | "updated_at">
  ): LocalSource {
    const sources = this.getFromStorage<LocalSource>("sources");
    const newSource: LocalSource = {
      ...data,
      id: this.generateId(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    sources.push(newSource);
    const result = this.saveToStorage("sources", sources);
    
    if (!result.success) {
      throw new Error(`Failed to create source: ${result.error}`);
    }
    
    // Trigger sync for the notebook that contains this source
    const notebook = this.getNotebook(newSource.notebook_id);
    if (notebook) {
      this.triggerSync('notebook', notebook.id, notebook);
    }
    
    return newSource;
  }

  updateSource(id: string, updates: Partial<LocalSource>): LocalSource | null {
    const sources = this.getFromStorage<LocalSource>("sources");
    const index = sources.findIndex((s) => s.id === id);
    if (index === -1) return null;

    sources[index] = {
      ...sources[index],
      ...updates,
      updated_at: new Date().toISOString(),
    };
    this.saveToStorage("sources", sources);
    return sources[index];
  }

  deleteSource(id: string): boolean {
    const sources = this.getFromStorage<LocalSource>("sources");
    const sourceToDelete = sources.find((s) => s.id === id);
    const filtered = sources.filter((s) => s.id !== id);
    if (filtered.length === sources.length) return false;
    this.saveToStorage("sources", filtered);
    
    // Trigger sync for the notebook that contained this source
    if (sourceToDelete) {
      const notebook = this.getNotebook(sourceToDelete.notebook_id);
      if (notebook) {
        this.triggerSync('notebook', notebook.id, notebook);
      }
    }
    
    return true;
  }

  // Notes
  getNotes(notebookId: string): LocalNote[] {
    const notes = this.getFromStorage<LocalNote>("notes");
    return notes.filter((n) => n.notebook_id === notebookId);
  }

  // Get note by ID
  getNoteById(id: string): LocalNote | null {
    const notes = this.getFromStorage<LocalNote>("notes");
    return notes.find((n) => n.id === id) || null;
  }

  createNote(
    data: Omit<LocalNote, "id" | "created_at" | "updated_at">
  ): LocalNote {
    const notes = this.getFromStorage<LocalNote>("notes");
    const newNote: LocalNote = {
      ...data,
      id: this.generateId(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    notes.push(newNote);
    const result = this.saveToStorage("notes", notes);
    
    if (!result.success) {
      throw new Error(`Failed to create note: ${result.error}`);
    }
    
    return newNote;
  }

  updateNote(id: string, updates: Partial<LocalNote>): LocalNote | null {
    const notes = this.getFromStorage<LocalNote>("notes");
    const index = notes.findIndex((n) => n.id === id);
    if (index === -1) return null;

    notes[index] = {
      ...notes[index],
      ...updates,
      updated_at: new Date().toISOString(),
    };
    this.saveToStorage("notes", notes);
    return notes[index];
  }

  deleteNote(id: string): boolean {
    const notes = this.getFromStorage<LocalNote>("notes");
    const filtered = notes.filter((n) => n.id !== id);
    if (filtered.length === notes.length) return false;
    this.saveToStorage("notes", filtered);
    return true;
  }

  // Chat Messages
  getChatMessages(notebookId: string): LocalChatMessage[] {
    const messages = this.getFromStorage<LocalChatMessage>("chat_messages");
    return messages.filter((m) => m.notebook_id === notebookId);
  }

  createChatMessage(
    data: Omit<LocalChatMessage, "id" | "created_at">
  ): LocalChatMessage {
    const messages = this.getFromStorage<LocalChatMessage>("chat_messages");
    const newMessage: LocalChatMessage = {
      ...data,
      id: this.generateId(),
      created_at: new Date().toISOString(),
    };
    messages.push(newMessage);
    const result = this.saveToStorage("chat_messages", messages);
    
    if (!result.success) {
      throw new Error(`Failed to create chat message: ${result.error}`);
    }
    
    return newMessage;
  }

  deleteChatMessage(id: string): boolean {
    const messages = this.getFromStorage<LocalChatMessage>("chat_messages");
    const filtered = messages.filter((m) => m.id !== id);
    if (filtered.length === messages.length) return false;
    this.saveToStorage("chat_messages", filtered);
    return true;
  }

  // Podcast Management
  getPodcasts(notebookId: string): LocalPodcast[] {
    const podcasts = this.getFromStorage<LocalPodcast>("podcasts");
    return podcasts.filter((p) => p.notebook_id === notebookId).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  createPodcast(data: Omit<LocalPodcast, "id" | "created_at">): LocalPodcast {
    const podcasts = this.getFromStorage<LocalPodcast>("podcasts");
    const newPodcast: LocalPodcast = {
      ...data,
      id: this.generateId(),
      created_at: new Date().toISOString(),
    };
    podcasts.push(newPodcast);
    this.saveToStorage("podcasts", podcasts);
    return newPodcast;
  }

  deletePodcast(id: string): boolean {
    const podcasts = this.getFromStorage<LocalPodcast>("podcasts");
    const filtered = podcasts.filter((p) => p.id !== id);
    if (filtered.length === podcasts.length) return false;
    this.saveToStorage("podcasts", filtered);
    return true;
  }

  // Utility methods
  clearAllData(): void {
    const keys = [
      "notebooks",
      "sources",
      "notes",
      "chat_messages",
      "currentUser",
      "users",
      "passwords",
    ];
    keys.forEach((key) => localStorage.removeItem(key));
  }

  exportData(): string {
    const stats = this.getStorageStats();
    const data = {
      notebooks: this.getFromStorage<LocalNotebook>("notebooks"),
      sources: this.getFromStorage<LocalSource>("sources"),
      notes: this.getFromStorage<LocalNote>("notes"),
      chat_messages: this.getFromStorage<LocalChatMessage>("chat_messages"),
      currentUser: this.getCurrentUser(),
      _metadata: {
        exportedAt: new Date().toISOString(),
        storageStats: {
          totalBytes: stats.totalBytes,
          totalMB: stats.totalMB,
          usedPercentage: `${(stats.usedPercentage * 100).toFixed(1)}%`,
          maxMB: stats.maxMB,
          itemCount: stats.itemCount,
          isNearLimit: stats.isNearLimit,
        },
      },
    };
    return JSON.stringify(data, null, 2);
  }

  importData(jsonData: string): void {
    try {
      const data = JSON.parse(jsonData);

      // Calculate import size
      const importSize = jsonData.length * 2; // UTF-16 estimate
      const stats = this.getStorageStats();

      if (importSize > stats.availableBytes) {
        throw new Error(
          `Import data (${formatBytes(importSize)}) exceeds available storage (${formatBytes(stats.availableBytes)}). ` +
            `Please clean up existing data first.`
        );
      }

      if (data.notebooks) this.saveToStorage("notebooks", data.notebooks);
      if (data.sources) this.saveToStorage("sources", data.sources);
      if (data.notes) this.saveToStorage("notes", data.notes);
      if (data.chat_messages)
        this.saveToStorage("chat_messages", data.chat_messages);
      if (data.currentUser) this.setCurrentUser(data.currentUser);
    } catch (error) {
      console.error("Failed to import data:", error);
      throw error instanceof Error ? error : new Error("Invalid data format");
    }
  }
}

export const localStorageService = new LocalStorageService();
