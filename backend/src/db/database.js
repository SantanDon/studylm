import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../../.env') });

// Standardized DB path
const isVercel = process.env.VERCEL === '1' || !!process.env.VERCEL;
// fallback to local file if no cloud URL is provided
const url = process.env.TURSO_DATABASE_URL || (isVercel ? 'file:/tmp/insights.db' : 'file:backend/studypod.db');
const authToken = process.env.TURSO_AUTH_TOKEN;

// Global db instance
let client;

/**
 * Initializes the database connection once.
 * Should be called and awaited at server startup.
 */
export async function getDatabase() {
  if (!client) {
    try {
      console.log(`📂 Connecting to database at: ${url}`);
      client = createClient({
        url: url,
        authToken: authToken
      });
      console.log('✅ Database connection established');
    } catch (error) {
      console.error('❌ Database load failure:', error);
      throw error;
    }
  }
  return client;
}

/**
 * Synchronous getter for internal helpers.
 * ASSUMES getDatabase() has already been called and awaited!
 */
function getDb() {
  if (!client) {
    throw new Error('Database not initialized! Call getDatabase() first.');
  }
  return client;
}

/**
 * Replaces the old initialization logic. 
 * Migrates existing schemas and creates new tables.
 */
export async function initializeDatabase() {
  console.log('Initializing database schema...');
  const db = await getDatabase();
  
  // 1. Create Core Tables
  await db.batch([
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      bio TEXT,
      avatar_url TEXT,
      account_type TEXT DEFAULT 'human',
      webhook_url TEXT,
      owner_id TEXT,
      is_verified INTEGER DEFAULT 0,
      verification_token TEXT,
      token_expires_at DATETIME,
      email_consent INTEGER DEFAULT 0,
      email_consent_at DATETIME,
      recovery_key_hash TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
    )`,
    `CREATE TABLE IF NOT EXISTS recovery_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      used INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS agent_api_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT 'My Agent Key',
      key_hash TEXT NOT NULL UNIQUE,
      prefix TEXT NOT NULL,
      last_used_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS user_preferences (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      theme TEXT DEFAULT 'light',
      accent_color TEXT DEFAULT 'blue',
      compact_mode INTEGER DEFAULT 0,
      default_model TEXT DEFAULT 'llama2',
      ai_temperature REAL DEFAULT 0.7,
      auto_title_generation INTEGER DEFAULT 1,
      show_example_questions INTEGER DEFAULT 1,
      email_notifications INTEGER DEFAULT 1,
      browser_notifications INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id)
    )`,
    `CREATE TABLE IF NOT EXISTS user_stats (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      total_notebooks INTEGER DEFAULT 0,
      total_sources INTEGER DEFAULT 0,
      total_notes INTEGER DEFAULT 0,
      storage_used INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id)
    )`,
    `CREATE TABLE IF NOT EXISTS notebooks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      example_questions TEXT,
      generation_status TEXT DEFAULT 'pending',
      icon TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      notebook_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT,
      url TEXT,
      metadata TEXT,
      file_path TEXT,
      file_size INTEGER,
      processing_status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      notebook_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      author_id TEXT,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL
    )`,
    `CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      notebook_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      sources TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS sync_data (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      encrypted_data TEXT NOT NULL,
      checksum TEXT NOT NULL,
      version INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS agent_pairing_codes (
      code TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS agent_uploads (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      notebook_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      mime_type TEXT NOT NULL,
      file_path TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
    )`
  ], "write");

  // Supporting Indexes
  await db.batch([
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_display_name ON users(display_name)`,
    `CREATE INDEX IF NOT EXISTS idx_notebooks_user_id ON notebooks(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_sources_notebook_id ON sources(notebook_id)`,
    `CREATE INDEX IF NOT EXISTS idx_sources_user_id ON sources(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_notes_notebook_id ON notes(notebook_id)`,
    `CREATE INDEX IF NOT EXISTS idx_notes_user_id ON notes(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_chat_messages_notebook_id ON chat_messages(notebook_id)`,
    `CREATE INDEX IF NOT EXISTS idx_chat_messages_user_id ON chat_messages(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_sync_data_user_id ON sync_data(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON agent_api_keys(user_id)`
  ], "write");

  console.log('Database initialization complete.');
}

export function closeDatabase() {
  client = null;
}

// Helper functions for common database operations
export const dbHelpers = {
  // User operations
  async getUserByEmail(email) {
    const db = getDb();
    const result = await db.execute({
      sql: 'SELECT id, email, password_hash, display_name, account_type, bio, avatar_url, is_verified, verification_token, token_expires_at, email_consent, email_consent_at, created_at, updated_at FROM users WHERE email = ?',
      args: [email]
    });
    return result.rows[0];
  },

  async getUserByDisplayName(displayName) {
    const db = getDb();
    const result = await db.execute({
      sql: 'SELECT id, email, password_hash, display_name, account_type, bio, avatar_url, is_verified, verification_token, token_expires_at, email_consent, email_consent_at, created_at, updated_at FROM users WHERE display_name = ?',
      args: [displayName]
    });
    return result.rows[0];
  },

  async getUserById(id) {
    const db = getDb();
    const result = await db.execute({
      sql: 'SELECT id, email, display_name, account_type, bio, avatar_url, is_verified, email_consent, created_at, updated_at FROM users WHERE id = ?',
      args: [id]
    });
    return result.rows[0];
  },

  async getUserByVerificationToken(token) {
    const db = getDb();
    const result = await db.execute({
      sql: 'SELECT id, email, is_verified, token_expires_at FROM users WHERE verification_token = ?',
      args: [token]
    });
    return result.rows[0];
  },

  async createUser(id, email, passwordHash, displayName = null, accountType = 'human', webhookUrl = null, ownerId = null, isVerified = 0, emailConsent = 0) {
    const db = getDb();
    const consentAt = emailConsent ? new Date().toISOString() : null;
    return await db.execute({
      sql: `INSERT INTO users (id, email, password_hash, display_name, account_type, webhook_url, owner_id, is_verified, email_consent, email_consent_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, email, passwordHash, displayName, accountType, webhookUrl, ownerId, isVerified, emailConsent, consentAt]
    });
  },

  async updateUser(id, updates) {
    const db = getDb();
    const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = [...Object.values(updates), id];
    return await db.execute({
      sql: `UPDATE users SET ${fields}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      args: values
    });
  },

  // User preferences
  async getUserPreferences(userId) {
    const db = getDb();
    const result = await db.execute({
      sql: 'SELECT * FROM user_preferences WHERE user_id = ?',
      args: [userId]
    });
    return result.rows[0];
  },

  async createUserPreferences(id, userId) {
    const db = getDb();
    return await db.execute({
      sql: 'INSERT INTO user_preferences (id, user_id) VALUES (?, ?)',
      args: [id, userId]
    });
  },

  async updateUserPreferences(userId, updates) {
    const db = getDb();
    const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = [...Object.values(updates), userId];
    return await db.execute({
      sql: `UPDATE user_preferences SET ${fields}, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`,
      args: values
    });
  },

  // User stats
  async getUserStats(userId) {
    const db = getDb();
    const result = await db.execute({
      sql: 'SELECT * FROM user_stats WHERE user_id = ?',
      args: [userId]
    });
    return result.rows[0];
  },

  async createUserStats(id, userId) {
    const db = getDb();
    return await db.execute({
      sql: 'INSERT INTO user_stats (id, user_id) VALUES (?, ?)',
      args: [id, userId]
    });
  },

  async updateUserStats(userId, updates) {
    const db = getDb();
    const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = [...Object.values(updates), userId];
    return await db.execute({
      sql: `UPDATE user_stats SET ${fields}, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`,
      args: values
    });
  },

  // Notebooks
  async getNotebooksByUserId(userId) {
    const db = getDb();
    const result = await db.execute({
      sql: `SELECT * FROM notebooks 
            WHERE user_id = ? 
            OR user_id IN (SELECT id FROM users WHERE owner_id = ?)
            ORDER BY updated_at DESC`,
      args: [userId, userId]
    });
    return result.rows;
  },

  async getNotebookById(id, userId) {
    const db = getDb();
    const result = await db.execute({
      sql: `SELECT * FROM notebooks 
            WHERE id = ? 
            AND (user_id = ? OR user_id IN (SELECT id FROM users WHERE owner_id = ?))`,
      args: [id, userId, userId]
    });
    return result.rows[0];
  },

  async createNotebook(id, userId, title, description = null) {
    const db = getDb();
    return await db.execute({
      sql: 'INSERT INTO notebooks (id, user_id, title, description) VALUES (?, ?, ?, ?)',
      args: [id, userId, title, description]
    });
  },

  async updateNotebook(id, userId, updates) {
    const db = getDb();
    const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = [...Object.values(updates), id, userId];
    return await db.execute({
      sql: `UPDATE notebooks SET ${fields}, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`,
      args: values
    });
  },

  async deleteNotebook(id, userId) {
    const db = getDb();
    return await db.execute({
      sql: 'DELETE FROM notebooks WHERE id = ? AND user_id = ?',
      args: [id, userId]
    });
  },

  // Sources
  async getSourcesByNotebookId(notebookId, userId) {
    const db = getDb();
    const result = await db.execute({
      sql: `SELECT s.*, u.display_name as author_name 
            FROM sources s
            LEFT JOIN users u ON s.user_id = u.id
            WHERE s.notebook_id = ? 
            AND (s.user_id = ? OR s.user_id IN (SELECT id FROM users WHERE owner_id = ?))
            ORDER BY s.created_at DESC`,
      args: [notebookId, userId, userId]
    });
    return result.rows;
  },

  async createSource(id, notebookId, userId, title, type, content = null, url = null, metadata = null, filePath = null, fileSize = null) {
    const db = getDb();
    const metaStr = metadata ? (typeof metadata === 'string' ? metadata : JSON.stringify(metadata)) : null;
    return await db.execute({
      sql: `INSERT INTO sources (id, notebook_id, user_id, title, type, content, url, metadata, file_path, file_size)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, notebookId, userId, title, type, content, url, metaStr, filePath, fileSize]
    });
  },

  async updateSource(id, userId, updates) {
    const db = getDb();
    const updateFields = [];
    const values = [];
    
    if (updates.title !== undefined) { updateFields.push('title = ?'); values.push(updates.title); }
    if (updates.content !== undefined) { updateFields.push('content = ?'); values.push(updates.content); }
    if (updates.url !== undefined) { updateFields.push('url = ?'); values.push(updates.url); }
    if (updates.file_path !== undefined) { updateFields.push('file_path = ?'); values.push(updates.file_path); }
    if (updates.processing_status !== undefined) { updateFields.push('processing_status = ?'); values.push(updates.processing_status); }
    if (updates.metadata !== undefined) { updateFields.push('metadata = ?'); values.push(updates.metadata ? JSON.stringify(updates.metadata) : null); }

    if (updateFields.length === 0) return { rowsAffected: 0 };

    updateFields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id, userId);

    return await db.execute({
      sql: `UPDATE sources SET ${updateFields.join(', ')} WHERE id = ? AND user_id = ?`,
      args: values
    });
  },

  async deleteSource(id, userId) {
    const db = getDb();
    return await db.execute({
      sql: 'DELETE FROM sources WHERE id = ? AND user_id = ?',
      args: [id, userId]
    });
  },

  async getAgentsByOwnerId(ownerId) {
    const db = getDb();
    const result = await db.execute({
      sql: 'SELECT * FROM users WHERE owner_id = ?',
      args: [ownerId]
    });
    return result.rows;
  },

  // Notes
  async getNotesByNotebookId(notebookId, userId) {
    const db = getDb();
    const result = await db.execute({
      sql: `SELECT n.*, u.display_name as author_name
            FROM notes n
            LEFT JOIN users u ON n.author_id = u.id
            WHERE n.notebook_id = ? 
            AND (n.user_id = ? OR n.user_id IN (SELECT id FROM users WHERE owner_id = ?))
            ORDER BY n.updated_at DESC`,
      args: [notebookId, userId, userId]
    });
    return result.rows;
  },

  async createNote(id, notebookId, userId, content, authorId = null) {
    const db = getDb();
    return await db.execute({
      sql: 'INSERT INTO notes (id, notebook_id, user_id, content, author_id) VALUES (?, ?, ?, ?, ?)',
      args: [id, notebookId, userId, content, authorId || userId]
    });
  },

  async updateNote(id, userId, content) {
    const db = getDb();
    return await db.execute({
      sql: 'UPDATE notes SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
      args: [content, id, userId]
    });
  },

  async deleteNote(id, userId) {
    const db = getDb();
    return await db.execute({
      sql: 'DELETE FROM notes WHERE id = ? AND user_id = ?',
      args: [id, userId]
    });
  },

  async getNoteById(id, userId) {
    const db = getDb();
    const result = await db.execute({
      sql: 'SELECT * FROM notes WHERE id = ? AND user_id = ?',
      args: [id, userId]
    });
    return result.rows[0];
  },

  // Chat Messages
  async getChatMessagesByNotebookId(notebookId, userId) {
    const db = getDb();
    const result = await db.execute({
      sql: `SELECT * FROM chat_messages 
            WHERE notebook_id = ? 
            AND (user_id = ? OR user_id IN (SELECT id FROM users WHERE owner_id = ?))
            ORDER BY created_at ASC`,
      args: [notebookId, userId, userId]
    });
    return result.rows;
  },

  async createChatMessage(id, notebookId, userId, role, content, sources = null) {
    const db = getDb();
    const sourcesStr = sources ? JSON.stringify(sources) : null;
    return await db.execute({
      sql: 'INSERT INTO chat_messages (id, notebook_id, user_id, role, content, sources) VALUES (?, ?, ?, ?, ?, ?)',
      args: [id, notebookId, userId, role, content, sourcesStr]
    });
  },

  // Account Recovery
  async storeRecoveryKeyHash(userId, hash) {
    const db = getDb();
    return await db.execute({
      sql: 'UPDATE users SET recovery_key_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      args: [hash, userId]
    });
  },

  async getRecoveryTokenByHash(hash) {
    const db = getDb();
    const result = await db.execute({
      sql: 'SELECT * FROM recovery_tokens WHERE token_hash = ? AND used = 0 AND expires_at > CURRENT_TIMESTAMP',
      args: [hash]
    });
    return result.rows[0];
  },

  async createRecoveryToken(id, userId, tokenHash, expiresAt) {
    const db = getDb();
    return await db.execute({
      sql: 'INSERT INTO recovery_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
      args: [id, userId, tokenHash, expiresAt]
    });
  },

  async markRecoveryTokenUsed(id) {
    const db = getDb();
    return await db.execute({
      sql: 'UPDATE recovery_tokens SET used = 1 WHERE id = ?',
      args: [id]
    });
  },

  async getUserByRecoveryKeyHash(hash) {
    const db = getDb();
    const result = await db.execute({
      sql: 'SELECT id, display_name FROM users WHERE recovery_key_hash = ?',
      args: [hash]
    });
    return result.rows[0];
  },

  // Agent API keys
  async createApiKey(id, userId, keyHash, prefix, label) {
    const db = getDb();
    return await db.execute({
      sql: 'INSERT INTO agent_api_keys (id, user_id, key_hash, prefix, label) VALUES (?, ?, ?, ?, ?)',
      args: [id, userId, keyHash, prefix, label]
    });
  },

  async getApiKeyByHash(keyHash) {
    const db = getDb();
    const result = await db.execute({
      sql: 'SELECT * FROM agent_api_keys WHERE key_hash = ?',
      args: [keyHash]
    });
    return result.rows[0];
  },

  async listApiKeys(userId) {
    const db = getDb();
    const result = await db.execute({
      sql: 'SELECT id, label, prefix, created_at, last_used_at FROM agent_api_keys WHERE user_id = ? ORDER BY created_at DESC',
      args: [userId]
    });
    return result.rows;
  },

  async deleteApiKey(id) {
    const db = getDb();
    return await db.execute({
      sql: 'DELETE FROM agent_api_keys WHERE id = ?',
      args: [id]
    });
  },

  // Agent Pairing Codes
  async createPairingCode(code, userId, expiresAt) {
    const db = getDb();
    return await db.execute({
      sql: 'INSERT INTO agent_pairing_codes (code, user_id, expires_at) VALUES (?, ?, ?)',
      args: [code, userId, expiresAt]
    });
  },

  async getPairingCode(code) {
    const db = getDb();
    const result = await db.execute({
      sql: 'SELECT * FROM agent_pairing_codes WHERE code = ?',
      args: [code]
    });
    return result.rows[0];
  },

  async deletePairingCode(code) {
    const db = getDb();
    return await db.execute({
      sql: 'DELETE FROM agent_pairing_codes WHERE code = ?',
      args: [code]
    });
  },

  async touchApiKey(id) {
    const db = getDb();
    return await db.execute({
      sql: "UPDATE agent_api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?",
      args: [id]
    });
  }
};

export default { getDatabase, initializeDatabase, closeDatabase, dbHelpers };
