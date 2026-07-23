
/**
 * ApiService
 * 
 * Client for the StudyPod LM Express Backend.
 * Handles identity authentication and cloud content management.
 */

export { API_BASE_URL } from '@/config/api';
import { API_BASE_URL } from '@/config/api';
import type {
  CreateDocumentInput,
  DocumentArtifact,
  DocumentExportFormat,
  DocumentRevisionInput,
  DocumentRevisionProposal,
  DocumentVersion,
  UpdateDocumentInput,
} from '@/types/document';

/**
 * Handle HTTP response globally for Auth events.
 * If 401 or 403, clear corrupted localStorage state and force logout.
 */
async function handleDocumentResponse<T>(response: Response): Promise<T> {
  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent('auth:unauthorized'));
    throw new Error('Authentication expired or invalid. Please sign in again.');
  }
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({})) as {
      error?: string;
      code?: string;
      currentVersion?: number;
    };
    const error = new Error(errorData.error || 'Document request failed') as Error & {
      code?: string;
      currentVersion?: number;
    };
    error.code = errorData.code;
    error.currentVersion = errorData.currentVersion;
    throw error;
  }
  return response.json() as Promise<T>;
}

async function handleResponse(response: Response) {
  if (response.status === 401 || response.status === 403) {
    // Notify the AuthContext to clear stale local sessions
    window.dispatchEvent(new CustomEvent('auth:unauthorized'));
    throw new Error('Authentication expired or invalid. Please sign in again.');
  }
  if (!response.ok) {
    let errorMsg = 'API request failed';
    try {
      const errData = await response.json();
      errorMsg = errData.error || errorMsg;
    } catch {
      console.warn('Silent JSON parsing fail for error body');
    }
    throw new Error(errorMsg);
  }
  return response.json();
}

export const ApiService = {
  async signin(credentials: { email?: string; password?: string; displayName?: string; passphrase?: string }) {
    const response = await fetch(`${API_BASE_URL}/auth/signin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials),
      credentials: 'include'
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "Authentication failed");
    }

    return response.json();
  },

  async signup(credentials: { displayName?: string; passphrase?: string; email?: string; password?: string; recovery_key_hash?: string; emailConsent?: boolean }) {
    const response = await fetch(`${API_BASE_URL}/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials),
      credentials: 'include'
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "Signup failed");
    }

    return response.json();
  },

  async chatgptLogin() {
    const response = await fetch(`${API_BASE_URL}/auth/chatgpt-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: 'include'
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "ChatGPT sign-in failed");
    }

    return response.json();
  },

  async recover(displayName: string, recoveryKey: string) {
    const response = await fetch(`${API_BASE_URL}/auth/recover`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName, recoveryKey }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "Recovery failed");
    }

    return response.json(); // { resetToken }
  },

  async resetPassphrase(resetToken: string, newPassphrase: string) {
    const response = await fetch(`${API_BASE_URL}/auth/reset-passphrase`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resetToken, newPassphrase }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "Passphrase reset failed");
    }

    return response.json(); // { success, user, accessToken, refreshToken }
  },

  async verifyEmail(token: string) {
    const response = await fetch(`${API_BASE_URL}/auth/verify-email?token=${token}`);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "Email verification failed");
    }
    return response.json();
  },

  async resendVerification(email: string) {
    const response = await fetch(`${API_BASE_URL}/auth/resend-verification`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "Failed to resend verification email");
    }
    return response.json();
  },

  async signout(): Promise<void> {
    await fetch(`${API_BASE_URL}/auth/signout`, { method: 'POST', credentials: 'include' });
  },

  // --- MFA Endpoints ---
  async mfaSetup(token: string): Promise<{ secret: string; qrCode: string; message: string }> {
    const response = await fetch(`${API_BASE_URL}/auth/mfa/setup`, { 
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      credentials: 'include'
    });
    return handleResponse(response);
  },

  async mfaEnable(code: string, token: string): Promise<{ message: string }> {
    const response = await fetch(`${API_BASE_URL}/auth/mfa/enable`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
      credentials: 'include'
    });
    return handleResponse(response);
  },

  async mfaVerify(mfaToken: string, code: string): Promise<{ user: { id: string; email?: string; displayName?: string; account_type?: string; createdAt: string } }> {
    const response = await fetch(`${API_BASE_URL}/auth/mfa/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mfaToken, code }),
      credentials: 'include'
    });
    return handleResponse(response);
  },

  async mfaDisable(code: string, token: string): Promise<{ message: string }> {
    const response = await fetch(`${API_BASE_URL}/auth/mfa/disable`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
      credentials: 'include'
    });
    return handleResponse(response);
  },

  async getUser(token: string) {
    const response = await fetch(`${API_BASE_URL}/user/profile`, {
      headers: { 'Authorization': `Bearer ${token}` },
      credentials: 'include'
    });
    return handleResponse(response);
  },

  async getYouTubeUsage(token: string): Promise<{ limit: number; used: number; remaining: number; resetAt: string }> {
    const response = await fetch(`${API_BASE_URL}/user/usage/youtube`, {
      headers: { 'Authorization': `Bearer ${token}` },
      credentials: 'include'
    });
    return handleResponse(response);
  },

  async recordYouTubeExtractionSuccess(token: string | undefined, videoId: string, extractedBy?: string): Promise<{ limit: number; used: number; remaining: number; resetAt: string }> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE_URL}/user/usage/youtube/record-success`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ videoId, extractedBy }),
      credentials: 'include'
    });
    return handleResponse(response);
  },

  async fetchNotebooks(token: string) {
    const response = await fetch(`${API_BASE_URL}/notebooks`, {
      headers: { 'Authorization': `Bearer ${token}` },
      credentials: 'include'
    });
    return handleResponse(response);
  },

  async createNotebook(title: string, description: string | undefined, token: string, id?: string) {
    const response = await fetch(`${API_BASE_URL}/notebooks`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description, id }),
      credentials: 'include'
    });
    return handleResponse(response);
  },

  async joinNotebook(joinCode: string, token: string) {
    const response = await fetch(`${API_BASE_URL}/notebooks/join`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: joinCode }),
      credentials: 'include'
    });
    return handleResponse(response);
  },

  async updateNotebook(notebookId: string, updates: { title?: string, description?: string, example_questions?: string[], generation_status?: string, icon?: string }, token: string) {
    const response = await fetch(`${API_BASE_URL}/notebooks/${notebookId}`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
      credentials: 'include'
    });
    return handleResponse(response);
  },

  async deleteNotebook(notebookId: string, token: string) {
    const response = await fetch(`${API_BASE_URL}/notebooks/${notebookId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
      credentials: 'include'
    });
    return handleResponse(response);
  },

  async batchDeleteNotebooks(ids: string[], token: string) {
    const response = await fetch(`${API_BASE_URL}/notebooks/batch`, {
      method: 'DELETE',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ids }),
      credentials: 'include'
    });
    return handleResponse(response);
  },

  async fetchNotes(notebookId: string, token: string) {
    const response = await fetch(`${API_BASE_URL}/notebooks/${notebookId}/notes`, {
      headers: { 'Authorization': `Bearer ${token}` },
      credentials: 'include'
    });
    return handleResponse(response);
  },

  async fetchSources(notebookId: string, token: string) {
    const response = await fetch(`${API_BASE_URL}/notebooks/${notebookId}/sources`, {
      headers: { 'Authorization': `Bearer ${token}` },
      credentials: 'include'
    });
    return handleResponse(response);
  },

  async createSource(notebookId: string, sourceData: Record<string, unknown>, token: string) {
    const response = await fetch(`${API_BASE_URL}/notebooks/${notebookId}/sources`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(sourceData),
      credentials: 'include'
    });
    if (!response.ok) throw new Error('Failed to create source');
    return response.json();
  },

  async updateSource(notebookId: string, sourceId: string, updates: Record<string, unknown>, token: string) {
    const response = await fetch(`${API_BASE_URL}/notebooks/${notebookId}/sources/${sourceId}`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
      credentials: 'include'
    });
    if (!response.ok) throw new Error('Failed to update source');
    return response.json();
  },

  async deleteSource(notebookId: string, sourceId: string, token: string) {
    const response = await fetch(`${API_BASE_URL}/notebooks/${notebookId}/sources/${sourceId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
      credentials: 'include'
    });
    if (!response.ok) throw new Error('Failed to delete source');
    return response.json();
  },

  /** Create a note via backend API — visible to agents and across sessions */
  async createNote(notebookId: string, content: string, token: string) {
    const response = await fetch(`${API_BASE_URL}/notebooks/${notebookId}/notes`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
      credentials: 'include'
    });
    if (!response.ok) throw new Error('Failed to create note');
    return response.json();
  },

  /** Update a note via backend API */
  async updateNote(notebookId: string, noteId: string, content: string, token: string) {
    const response = await fetch(`${API_BASE_URL}/notebooks/${notebookId}/notes/${noteId}`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
      credentials: 'include'
    });
    if (!response.ok) throw new Error('Failed to update note');
    return response.json();
  },

  async getChatMessages(notebookId: string, token: string, signal?: AbortSignal) {
    const response = await fetch(`${API_BASE_URL}/notebooks/${notebookId}/messages`, {
      headers: { 'Authorization': `Bearer ${token}` },
      credentials: 'include',
      signal,
    });
    if (!response.ok) throw new Error('Failed to fetch chat messages');
    return response.json();
  },

  async deleteChatHistory(notebookId: string, token: string) {
    const response = await fetch(`${API_BASE_URL}/notebooks/${notebookId}/messages`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
      credentials: 'include'
    });
    if (!response.ok) throw new Error('Failed to delete chat history');
    return response.json();
  },

  async sendChatMessage(notebookId: string, params: { message: string; saveAsNote?: boolean; agentId?: string; responseStyle?: 'dense' | 'conversational'; sourceIds?: string[] }, token: string) {
    const response = await fetch(`${API_BASE_URL}/notebooks/${notebookId}/chat`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      credentials: 'include'
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const detailedMessage = errorData.details ? `${errorData.error}: ${errorData.details}` : errorData.error;
      throw new Error(detailedMessage || 'Failed to send chat message');
    }
    return response.json();
  },

  /** Delete a note via backend API */
  async deleteNote(notebookId: string, noteId: string, token: string) {
    const response = await fetch(`${API_BASE_URL}/notebooks/${notebookId}/notes/${noteId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
      credentials: 'include'
    });
    if (!response.ok) throw new Error('Failed to delete note');
    return response.json();
  },

  /** Retrieves pending agent uploads for the front-end to process */
  async getPendingAgentUploads(notebookId: string, token: string, signal?: AbortSignal) {
    const response = await fetch(`${API_BASE_URL}/agent/pending-uploads?notebookId=${notebookId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
      credentials: 'include',
      signal,
    });
    if (!response.ok) throw new Error('Failed to fetch pending agent uploads');
    return response.json();
  },

  /** Deletes the raw footprint of an agent upload after processing */
  async deleteAgentUpload(uploadId: string, token: string) {
    const response = await fetch(`${API_BASE_URL}/agent/upload/${uploadId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
      credentials: 'include'
    });
    if (!response.ok) throw new Error('Failed to delete pending agent upload');
    return response.json();
  },

  /** Downloads the raw Agent file as a Blob */
  async downloadAgentUpload(uploadId: string, token: string): Promise<Blob> {
    const response = await fetch(`${API_BASE_URL}/agent/download/${uploadId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
      credentials: 'include'
    });
    if (!response.ok) throw new Error('Failed to download pending agent upload');
    return response.blob();
  },

  // Sovereign Startup Injections (RALPH LOOP 2)
  async globalSearch(query: string, token: string) {
    const response = await fetch(`${API_BASE_URL}/search?q=${encodeURIComponent(query)}`, {
      headers: { 'Authorization': `Bearer ${token}` },
      credentials: 'include'
    });
    return handleResponse(response);
  },

  async fetchTasks(notebookId: string, token: string) {
    const response = await fetch(`${API_BASE_URL}/tasks/${notebookId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
      credentials: 'include'
    });
    return handleResponse(response);
  },

  async createTask(notebookId: string, content: string, priority: string, token: string) {
    const response = await fetch(`${API_BASE_URL}/tasks`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ notebookId, content, priority }),
      credentials: 'include'
    });
    return handleResponse(response);
  },

  async generateSignal(notebookId: string, sourceId: string, token: string) {
    const response = await fetch(`${API_BASE_URL}/signal/generate`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ notebookId, sourceId }),
      credentials: 'include'
    });
    return handleResponse(response);
  },

  async syncToMemory(notebookId: string, sourceId: string, token: string) {
    const response = await fetch(`${API_BASE_URL}/signal/memory-sync`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ notebookId, sourceId }),
      credentials: 'include'
    });
    return handleResponse(response);
  },

  async fetchSignalQueue(token: string, params?: { status?: string; platform?: string; notebookId?: string; limit?: number }) {
    const query = new URLSearchParams();
    if (params?.status) query.append('status', params.status);
    if (params?.platform) query.append('platform', params.platform);
    if (params?.notebookId) query.append('notebookId', params.notebookId);
    if (params?.limit) query.append('limit', String(params.limit));

    const response = await fetch(`${API_BASE_URL}/signal-queue?${query.toString()}`, {
      headers: { 'Authorization': `Bearer ${token}` },
      credentials: 'include'
    });
    return handleResponse(response);
  },

  async fetchSignalQueueStats(token: string) {
    const response = await fetch(`${API_BASE_URL}/signal-queue/stats`, {
      headers: { 'Authorization': `Bearer ${token}` },
      credentials: 'include'
    });
    return handleResponse(response);
  },

  async createSignalQueueItem(token: string, item: { notebookId?: string; platform: string; content: string; sourceId?: string; tweetSourceId?: string; scheduledFor?: string; noteId?: string }) {
    const response = await fetch(`${API_BASE_URL}/signal-queue`, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(item),
      credentials: 'include'
    });
    return handleResponse(response);
  },

  async updateSignalQueueItem(id: string, token: string, updates: Record<string, unknown>) {
    const response = await fetch(`${API_BASE_URL}/signal-queue/${id}`, {
      method: 'PUT',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updates),
      credentials: 'include'
    });
    return handleResponse(response);
  },

  async deleteSignalQueueItem(id: string, token: string) {
    const response = await fetch(`${API_BASE_URL}/signal-queue/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
      credentials: 'include'
    });
    return handleResponse(response);
  },

  async importTweets(notebookId: string, token: string, data: { urls?: string[]; fileContent?: string }) {
    const response = await fetch(`${API_BASE_URL}/notebooks/${notebookId}/sources/tweets`, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data),
      credentials: 'include'
    });
    return handleResponse(response);
  },

  async fetchResearchGoals(notebookId: string, token: string, opts: { includeArchived?: boolean; parentGoalId?: string | null } = {}) {
    const params = new URLSearchParams();
    if (opts.includeArchived) params.set('includeArchived', 'true');
    if (opts.parentGoalId) params.set('parentGoalId', opts.parentGoalId);
    const qs = params.toString();
    const url = `${API_BASE_URL}/notebooks/${notebookId}/research-goals${qs ? `?${qs}` : ''}`;
    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` },
      credentials: 'include'
    });
    return handleResponse(response);
  },

  async createResearchGoal(notebookId: string, title: string, description: string, token: string, extras: { parentGoalId?: string; priority?: 'low'|'medium'|'high'; status?: 'active'|'completed'|'paused'|'archived'; sourceId?: string } = {}) {
    const body: Record<string, unknown> = { title, description };
    if (extras.parentGoalId) body.parentGoalId = extras.parentGoalId;
    if (extras.priority) body.priority = extras.priority;
    if (extras.status) body.status = extras.status;
    if (extras.sourceId) body.sourceId = extras.sourceId;
    const response = await fetch(`${API_BASE_URL}/notebooks/${notebookId}/research-goals`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      credentials: 'include'
    });
    return handleResponse(response);
  },

  async patchResearchGoal(notebookId: string, goalId: string, updates: Record<string, unknown>, token: string) {
    const response = await fetch(`${API_BASE_URL}/notebooks/${notebookId}/research-goals/${goalId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updates),
      credentials: 'include'
    });
    return handleResponse(response);
  },

  async linkTaskToGoal(notebookId: string, goalId: string, taskId: string, token: string) {
    const response = await fetch(`${API_BASE_URL}/notebooks/${notebookId}/research-goals/${goalId}/tasks/${taskId}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      credentials: 'include'
    });
    return handleResponse(response);
  },

  async linkArtifactToGoal(notebookId: string, goalId: string, artifactId: string, token: string) {
    const response = await fetch(`${API_BASE_URL}/notebooks/${notebookId}/research-goals/${goalId}/artifacts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ artifactId }),
      credentials: 'include'
    });
    return handleResponse(response);
  },

  async fetchSuggestedGoals(notebookId: string, sourceId: string, token: string) {
    const response = await fetch(`${API_BASE_URL}/notebooks/${notebookId}/sources/${sourceId}/suggested-goals`, {
      headers: { 'Authorization': `Bearer ${token}` },
      credentials: 'include'
    });
    return handleResponse(response);
  },

  async acceptSuggestedGoal(notebookId: string, sourceId: string, suggestionId: string, token: string) {
    const response = await fetch(`${API_BASE_URL}/notebooks/${notebookId}/sources/${sourceId}/suggested-goals/${suggestionId}/accept`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      credentials: 'include'
    });
    return handleResponse(response);
  },

  async deleteResearchGoal(notebookId: string, goalId: string, token: string) {
    const response = await fetch(`${API_BASE_URL}/notebooks/${notebookId}/research-goals/${goalId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
      credentials: 'include'
    });
    return handleResponse(response);
  },

  async researchNotebook(notebookId: string, options: { query?: string; depth?: 'quick' | 'deep' }, token: string) {
    const response = await fetch(`${API_BASE_URL}/notebooks/${notebookId}/research`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(options),
      credentials: 'include'
    });
    return handleResponse(response);
  },

  async fetchDocuments(notebookId: string, token: string): Promise<DocumentArtifact[]> {
    const response = await fetch(`${API_BASE_URL}/notebooks/${notebookId}/documents`, {
      headers: { 'Authorization': `Bearer ${token}` },
      credentials: 'include',
    });
    const data = await handleDocumentResponse<{ documents: DocumentArtifact[] }>(response);
    return data.documents;
  },

  async fetchDocument(notebookId: string, documentId: string, token: string): Promise<DocumentArtifact> {
    const response = await fetch(`${API_BASE_URL}/notebooks/${notebookId}/documents/${documentId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
      credentials: 'include',
    });
    const data = await handleDocumentResponse<{ document: DocumentArtifact }>(response);
    return data.document;
  },

  async createDocument(notebookId: string, input: CreateDocumentInput, token: string): Promise<DocumentArtifact> {
    const response = await fetch(`${API_BASE_URL}/notebooks/${notebookId}/documents`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      credentials: 'include',
    });
    const data = await handleDocumentResponse<{ document: DocumentArtifact }>(response);
    return data.document;
  },

  async createDocumentFromSource(notebookId: string, sourceId: string, token: string, title?: string): Promise<DocumentArtifact> {
    const response = await fetch(`${API_BASE_URL}/notebooks/${notebookId}/documents/from-source`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId, title }),
      credentials: 'include',
    });
    const data = await handleDocumentResponse<{ document: DocumentArtifact }>(response);
    return data.document;
  },

  async updateDocument(notebookId: string, documentId: string, input: UpdateDocumentInput, token: string): Promise<DocumentArtifact> {
    const response = await fetch(`${API_BASE_URL}/notebooks/${notebookId}/documents/${documentId}`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      credentials: 'include',
    });
    const data = await handleDocumentResponse<{ document: DocumentArtifact }>(response);
    return data.document;
  },

  async deleteDocument(notebookId: string, documentId: string, token: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/notebooks/${notebookId}/documents/${documentId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
      credentials: 'include',
    });
    await handleDocumentResponse<{ success: boolean }>(response);
  },

  async fetchDocumentVersions(notebookId: string, documentId: string, token: string): Promise<DocumentVersion[]> {
    const response = await fetch(`${API_BASE_URL}/notebooks/${notebookId}/documents/${documentId}/versions`, {
      headers: { 'Authorization': `Bearer ${token}` },
      credentials: 'include',
    });
    const data = await handleDocumentResponse<{ versions: DocumentVersion[] }>(response);
    return data.versions;
  },

  async restoreDocumentVersion(notebookId: string, documentId: string, version: number, token: string): Promise<DocumentArtifact> {
    const response = await fetch(`${API_BASE_URL}/notebooks/${notebookId}/documents/${documentId}/versions/${version}/restore`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      credentials: 'include',
    });
    const data = await handleDocumentResponse<{ document: DocumentArtifact }>(response);
    return data.document;
  },

  async proposeDocumentRevision(
    notebookId: string,
    documentId: string,
    input: DocumentRevisionInput,
    token: string,
  ): Promise<{ proposal: DocumentRevisionProposal; documentVersion: number; sourceScope: string[] }> {
    const response = await fetch(`${API_BASE_URL}/notebooks/${notebookId}/documents/${documentId}/revisions/propose`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      credentials: 'include',
    });
    return handleDocumentResponse(response);
  },

  async applyDocumentRevision(
    notebookId: string,
    documentId: string,
    revisedContent: string,
    expectedVersion: number,
    changeSummary: string,
    token: string,
    metadata?: Record<string, unknown>,
  ): Promise<DocumentArtifact> {
    const response = await fetch(`${API_BASE_URL}/notebooks/${notebookId}/documents/${documentId}/revisions/apply`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ revisedContent, expectedVersion, changeSummary, metadata }),
      credentials: 'include',
    });
    const data = await handleDocumentResponse<{ document: DocumentArtifact }>(response);
    return data.document;
  },

  async exportDocument(
    notebookId: string,
    documentId: string,
    format: DocumentExportFormat,
    token: string,
  ): Promise<{ blob: Blob; filename: string; version: number | null }> {
    const response = await fetch(`${API_BASE_URL}/notebooks/${notebookId}/documents/${documentId}/export?format=${format}`, {
      headers: { 'Authorization': `Bearer ${token}` },
      credentials: 'include',
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(data.error || 'Document export failed');
    }
    const disposition = response.headers.get('content-disposition') || '';
    const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
    const simple = /filename="?([^";]+)"?/i.exec(disposition)?.[1];
    const filename = encoded ? decodeURIComponent(encoded) : (simple || `StudyPod-Document.${format}`);
    return {
      blob: await response.blob(),
      filename,
      version: Number(response.headers.get('x-studypod-document-version')) || null,
    };
  },
};

export default ApiService;
