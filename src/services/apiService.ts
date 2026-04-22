
/**
 * ApiService
 * 
 * Client for the StudyPod LM Express Backend.
 * Handles identity authentication and cloud content management.
 */

export const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

/**
 * Handle HTTP response globally for Auth events.
 * If 401 or 403, clear corrupted localStorage state and force logout.
 */
async function handleResponse(response: Response) {
  if (response.status === 401 || response.status === 403) {
    throw new Error('Authentication expired or invalid. Please sign in again.');
  }
  if (!response.ok) {
    let errorMsg = 'API request failed';
    try {
      const errData = await response.json();
      errorMsg = errData.error || errorMsg;
    } catch (e) {
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

  async mfaVerify(mfaToken: string, code: string): Promise<any> {
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

  async getChatMessages(notebookId: string, token: string) {
    const response = await fetch(`${API_BASE_URL}/notebooks/${notebookId}/messages`, {
      headers: { 'Authorization': `Bearer ${token}` },
      credentials: 'include'
    });
    if (!response.ok) throw new Error('Failed to fetch chat messages');
    return response.json();
  },

  async sendChatMessage(notebookId: string, params: { message: string, saveAsNote?: boolean, agentId?: string }, token: string) {
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
  async getPendingAgentUploads(notebookId: string, token: string) {
    const response = await fetch(`${API_BASE_URL}/agent/pending-uploads?notebookId=${notebookId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
      credentials: 'include'
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
  }
};

export default ApiService;
