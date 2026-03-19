
/**
 * ApiService
 * 
 * Client for the StudyPod LM Express Backend.
 * Handles identity authentication and cloud content management.
 */

const API_BASE_URL = 'http://localhost:3001/api';

export const ApiService = {
  async signin(credentials: { email?: string; password?: string; displayName?: string; passphrase?: string }) {
    const response = await fetch(`${API_BASE_URL}/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials)
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to sign in to cloud');
    }
    return response.json();
  },

  async fetchProfile(token: string) {
    const response = await fetch(`${API_BASE_URL}/user/profile`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return response.json();
  },

  async fetchNotebooks(token: string) {
    const response = await fetch(`${API_BASE_URL}/notebooks`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return response.json();
  },

  async createNotebook(title: string, description: string | undefined, token: string) {
    const response = await fetch(`${API_BASE_URL}/notebooks`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description })
    });
    if (!response.ok) throw new Error('Failed to create notebook');
    return response.json();
  },

  async fetchNotes(notebookId: string, token: string) {
    const response = await fetch(`${API_BASE_URL}/notebooks/${notebookId}/notes`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return response.json();
  },

  async fetchSources(notebookId: string, token: string) {
    const response = await fetch(`${API_BASE_URL}/notebooks/${notebookId}/sources`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return response.json();
  },

  /** Create a note via backend API — visible to agents and across sessions */
  async createNote(notebookId: string, content: string, token: string) {
    const response = await fetch(`${API_BASE_URL}/notebooks/${notebookId}/notes`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    if (!response.ok) throw new Error('Failed to create note');
    return response.json();
  },

  /** Update a note via backend API */
  async updateNote(notebookId: string, noteId: string, content: string, token: string) {
    const response = await fetch(`${API_BASE_URL}/notebooks/${notebookId}/notes/${noteId}`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    if (!response.ok) throw new Error('Failed to update note');
    return response.json();
  },

  /** Delete a note via backend API */
  async deleteNote(notebookId: string, noteId: string, token: string) {
    const response = await fetch(`${API_BASE_URL}/notebooks/${notebookId}/notes/${noteId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!response.ok) throw new Error('Failed to delete note');
    return response.json();
  }
};

export default ApiService;
