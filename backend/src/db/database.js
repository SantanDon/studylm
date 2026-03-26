import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Standardized DB path
// On Vercel, we must use /tmp because the default project directory is read-only
const isVercel = process.env.VERCEL === '1' || !!process.env.VERCEL;
const DB_PATH = isVercel 
  ? '/tmp/insights.db' 
  : (process.env.DB_PATH || join(__dirname, '..', '..', 'data', 'insights.db'));

// Ensure data directory exists (skipped on Vercel as /tmp always exists)
if (!isVercel) {
  const dataDir = dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
} else {
  console.log('🌐 Vercel environment detected. Using ephemeral database at /tmp/insights.db');
}

// Global db instance
let database;

/**
 * Initializes the database connection once.
 * Should be called and awaited at server startup.
 */
export async function getDatabase() {
  if (!database) {
    try {
      const { default: Database } = await import('better-sqlite3');
      database = new Database(DB_PATH);
      database.pragma('foreign_keys = ON');
      database.pragma('journal_mode = WAL');
    } catch (error) {
      console.error('❌ Database load failure:', error.message);
      throw error;
    }
  }
  return database;
}

/**
 * Synchronous getter for internal helpers.
 * ASSUMES getDatabase() has already been called and awaited!
 */
function getDb() {
  if (!database) {
    throw new Error('Database not initialized! Call initializeDatabase() first.');
  }
  return database;
}

/**
 * Replaces the old initialization logic. 
 * Migrates existing schemas and creates new tables.
 */
export async function initializeDatabase() {
  console.log('Initializing database schema...');
  const db = await getDatabase();
  
  // 1. Create Core Tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
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
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_display_name ON users(display_name);

    CREATE TABLE IF NOT EXISTS recovery_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      used INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agent_api_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT 'My Agent Key',
      key_hash TEXT NOT NULL UNIQUE,
      prefix TEXT NOT NULL,
      last_used_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_preferences (
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
    );

    CREATE TABLE IF NOT EXISTS user_stats (
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
    );

    CREATE TABLE IF NOT EXISTS notebooks (
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
    );

    CREATE TABLE IF NOT EXISTS sources (
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
    );

    CREATE TABLE IF NOT EXISTS notes (
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
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      notebook_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      sources TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sync_data (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      encrypted_data TEXT NOT NULL,
      checksum TEXT NOT NULL,
      version INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agent_pairing_codes (
      code TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agent_uploads (
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
    );
  `);

  // 2. Run Automatic Migrations (Add missing columns)
  const usersCols = [
    "account_type TEXT DEFAULT 'human'",
    "webhook_url TEXT",
    "owner_id TEXT",
    "recovery_key_hash TEXT",
    "is_verified INTEGER DEFAULT 0",
    "verification_token TEXT",
    "token_expires_at DATETIME",
    "email_consent INTEGER DEFAULT 0",
    "email_consent_at DATETIME"
  ];

  for (const col of usersCols) {
    try { db.exec(`ALTER TABLE users ADD COLUMN ${col}`); } catch (e) {}
  }

  try { db.exec(`ALTER TABLE sources ADD COLUMN file_path TEXT`); } catch (e) {}
  try { db.exec(`ALTER TABLE sources ADD COLUMN file_size INTEGER`); } catch (e) {}
  try { db.exec(`ALTER TABLE sources ADD COLUMN processing_status TEXT DEFAULT 'pending'`); } catch (e) {}
  try { db.exec(`ALTER TABLE notebooks ADD COLUMN example_questions TEXT`); } catch (e) {}
  try { db.exec(`ALTER TABLE notebooks ADD COLUMN generation_status TEXT DEFAULT 'pending'`); } catch (e) {}
  try { db.exec(`ALTER TABLE notebooks ADD COLUMN icon TEXT`); } catch (e) {}
  try { db.exec(`ALTER TABLE notes ADD COLUMN author_id TEXT`); } catch (e) {}

  // 3. Create Supporting Indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_notebooks_user_id ON notebooks(user_id);
    CREATE INDEX IF NOT EXISTS idx_sources_notebook_id ON sources(notebook_id);
    CREATE INDEX IF NOT EXISTS idx_sources_user_id ON sources(user_id);
    CREATE INDEX IF NOT EXISTS idx_notes_notebook_id ON notes(notebook_id);
    CREATE INDEX IF NOT EXISTS idx_notes_user_id ON notes(user_id);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_notebook_id ON chat_messages(notebook_id);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_user_id ON chat_messages(user_id);
    CREATE INDEX IF NOT EXISTS idx_sync_data_user_id ON sync_data(user_id);
    CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON agent_api_keys(user_id);
  `);

  console.log('Database initialization complete.');
}

export function closeDatabase() {
  if (database) {
    database.close();
    database = null;
  }
}

// Helper functions for common database operations
export const dbHelpers = {
  // User operations
  getUserByEmail(email) {
    const db = getDb();
    return db.prepare('SELECT id, email, password_hash, display_name, account_type, bio, avatar_url, is_verified, verification_token, token_expires_at, email_consent, email_consent_at, created_at, updated_at FROM users WHERE email = ?').get(email);
  },

  getUserByDisplayName(displayName) {
    const db = getDb();
    return db.prepare('SELECT id, email, password_hash, display_name, account_type, bio, avatar_url, is_verified, verification_token, token_expires_at, email_consent, email_consent_at, created_at, updated_at FROM users WHERE display_name = ?').get(displayName);
  },

  getUserById(id) {
    const db = getDb();
    return db.prepare('SELECT id, email, display_name, account_type, bio, avatar_url, is_verified, email_consent, created_at, updated_at FROM users WHERE id = ?').get(id);
  },

  getUserByVerificationToken(token) {
    const db = getDb();
    return db.prepare('SELECT id, email, is_verified, token_expires_at FROM users WHERE verification_token = ?').get(token);
  },

  createUser(id, email, passwordHash, displayName = null, accountType = 'human', webhookUrl = null, ownerId = null, isVerified = 0, emailConsent = 0) {
    const db = getDb();
    const consentAt = emailConsent ? new Date().toISOString() : null;
    const stmt = db.prepare(`
      INSERT INTO users (id, email, password_hash, display_name, account_type, webhook_url, owner_id, is_verified, email_consent, email_consent_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(id, email, passwordHash, displayName, accountType, webhookUrl, ownerId, isVerified, emailConsent, consentAt);
  },

  updateUser(id, updates) {
    const db = getDb();
    const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = [...Object.values(updates), id];
    const stmt = db.prepare(`
      UPDATE users
      SET ${fields}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    return stmt.run(...values);
  },

  // User preferences
  getUserPreferences(userId) {
    const db = getDb();
    return db.prepare('SELECT * FROM user_preferences WHERE user_id = ?').get(userId);
  },

  createUserPreferences(id, userId) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO user_preferences (id, user_id)
      VALUES (?, ?)
    `);
    return stmt.run(id, userId);
  },

  updateUserPreferences(userId, updates) {
    const db = getDb();
    const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = [...Object.values(updates), userId];
    const stmt = db.prepare(`
      UPDATE user_preferences
      SET ${fields}, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `);
    return stmt.run(...values);
  },

  // User stats
  getUserStats(userId) {
    const db = getDb();
    return db.prepare('SELECT * FROM user_stats WHERE user_id = ?').get(userId);
  },

  createUserStats(id, userId) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO user_stats (id, user_id)
      VALUES (?, ?)
    `);
    return stmt.run(id, userId);
  },

  updateUserStats(userId, updates) {
    const db = getDb();
    const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = [...Object.values(updates), userId];
    const stmt = db.prepare(`
      UPDATE user_stats
      SET ${fields}, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `);
    return stmt.run(...values);
  },

  // Notebooks
  getNotebooksByUserId(userId) {
    const db = getDb();
    return db.prepare(`
      SELECT * FROM notebooks 
      WHERE user_id = ? 
      OR user_id IN (SELECT id FROM users WHERE owner_id = ?)
      ORDER BY updated_at DESC
    `).all(userId, userId);
  },

  getNotebookById(id, userId) {
    const db = getDb();
    return db.prepare(`
      SELECT * FROM notebooks 
      WHERE id = ? 
      AND (user_id = ? OR user_id IN (SELECT id FROM users WHERE owner_id = ?))
    `).get(id, userId, userId);
  },

  createNotebook(id, userId, title, description = null) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO notebooks (id, user_id, title, description)
      VALUES (?, ?, ?, ?)
    `);
    return stmt.run(id, userId, title, description);
  },

  updateNotebook(id, userId, updates) {
    const db = getDb();
    const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = [...Object.values(updates), id, userId];
    const stmt = db.prepare(`
      UPDATE notebooks
      SET ${fields}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `);
    return stmt.run(...values);
  },

  deleteNotebook(id, userId) {
    const db = getDb();
    const stmt = db.prepare('DELETE FROM notebooks WHERE id = ? AND user_id = ?');
    return stmt.run(id, userId);
  },

  // Sources
  getSourcesByNotebookId(notebookId, userId) {
    const db = getDb();
    return db.prepare(`
      SELECT s.*, u.display_name as author_name 
      FROM sources s
      LEFT JOIN users u ON s.user_id = u.id
      WHERE s.notebook_id = ? 
      AND (s.user_id = ? OR s.user_id IN (SELECT id FROM users WHERE owner_id = ?))
      ORDER BY s.created_at DESC
    `).all(notebookId, userId, userId);
  },

  createSource(id, notebookId, userId, title, type, content = null, url = null, metadata = null, filePath = null, fileSize = null) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO sources (id, notebook_id, user_id, title, type, content, url, metadata, file_path, file_size)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const metaStr = metadata ? (typeof metadata === 'string' ? metadata : JSON.stringify(metadata)) : null;
    return stmt.run(id, notebookId, userId, title, type, content, url, metaStr, filePath, fileSize);
  },

  updateSource(id, userId, updates) {
    const db = getDb();
    const updateFields = [];
    const values = [];
    
    if (updates.title !== undefined) { updateFields.push('title = ?'); values.push(updates.title); }
    if (updates.content !== undefined) { updateFields.push('content = ?'); values.push(updates.content); }
    if (updates.url !== undefined) { updateFields.push('url = ?'); values.push(updates.url); }
    if (updates.file_path !== undefined) { updateFields.push('file_path = ?'); values.push(updates.file_path); }
    if (updates.processing_status !== undefined) { updateFields.push('processing_status = ?'); values.push(updates.processing_status); }
    if (updates.metadata !== undefined) { updateFields.push('metadata = ?'); values.push(updates.metadata ? JSON.stringify(updates.metadata) : null); }

    if (updateFields.length === 0) return { changes: 0 };

    updateFields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id, userId);

    const stmt = db.prepare(`
      UPDATE sources
      SET ${updateFields.join(', ')}
      WHERE id = ? AND user_id = ?
    `);
    
    return stmt.run(...values);
  },

  deleteSource(id, userId) {
    const db = getDb();
    const stmt = db.prepare('DELETE FROM sources WHERE id = ? AND user_id = ?');
    return stmt.run(id, userId);
  },

  getAgentsByOwnerId(ownerId) {
    const db = getDb();
    return db.prepare('SELECT * FROM users WHERE owner_id = ?').all(ownerId);
  },

  // Notes
  getNotesByNotebookId(notebookId, userId) {
    const db = getDb();
    return db.prepare(`
      SELECT n.*, u.display_name as author_name
      FROM notes n
      LEFT JOIN users u ON n.author_id = u.id
      WHERE n.notebook_id = ? 
      AND (n.user_id = ? OR n.user_id IN (SELECT id FROM users WHERE owner_id = ?))
      ORDER BY n.updated_at DESC
    `).all(notebookId, userId, userId);
  },

  createNote(id, notebookId, userId, content, authorId = null) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO notes (id, notebook_id, user_id, content, author_id)
      VALUES (?, ?, ?, ?, ?)
    `);
    return stmt.run(id, notebookId, userId, content, authorId || userId);
  },

  updateNote(id, userId, content) {
    const db = getDb();
    const stmt = db.prepare(`
      UPDATE notes
      SET content = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `);
    return stmt.run(content, id, userId);
  },

  deleteNote(id, userId) {
    const db = getDb();
    const stmt = db.prepare('DELETE FROM notes WHERE id = ? AND user_id = ?');
    return stmt.run(id, userId);
  },

  getNoteById(id, userId) {
    const db = getDb();
    return db.prepare('SELECT * FROM notes WHERE id = ? AND user_id = ?').get(id, userId);
  },

  // Chat Messages
  getChatMessagesByNotebookId(notebookId, userId) {
    const db = getDb();
    return db.prepare(`
      SELECT * FROM chat_messages 
      WHERE notebook_id = ? 
      AND (user_id = ? OR user_id IN (SELECT id FROM users WHERE owner_id = ?))
      ORDER BY created_at ASC
    `).all(notebookId, userId, userId);
  },

  createChatMessage(id, notebookId, userId, role, content, sources = null) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO chat_messages (id, notebook_id, user_id, role, content, sources)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const sourcesStr = sources ? JSON.stringify(sources) : null;
    return stmt.run(id, notebookId, userId, role, content, sourcesStr);
  },

  // Account Recovery
  storeRecoveryKeyHash(userId, hash) {
    const db = getDb();
    const stmt = db.prepare('UPDATE users SET recovery_key_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    return stmt.run(hash, userId);
  },

  getRecoveryTokenByHash(hash) {
    const db = getDb();
    return db.prepare('SELECT * FROM recovery_tokens WHERE token_hash = ? AND used = 0 AND expires_at > CURRENT_TIMESTAMP').get(hash);
  },

  createRecoveryToken(id, userId, tokenHash, expiresAt) {
    const db = getDb();
    const stmt = db.prepare('INSERT INTO recovery_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)');
    return stmt.run(id, userId, tokenHash, expiresAt);
  },

  markRecoveryTokenUsed(id) {
    const db = getDb();
    const stmt = db.prepare('UPDATE recovery_tokens SET used = 1 WHERE id = ?');
    return stmt.run(id);
  },

  getUserByRecoveryKeyHash(hash) {
    const db = getDb();
    return db.prepare('SELECT id, display_name FROM users WHERE recovery_key_hash = ?').get(hash);
  },

  // Agent API keys
  createApiKey(id, userId, keyHash, prefix, label) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO agent_api_keys (id, user_id, key_hash, prefix, label)
      VALUES (?, ?, ?, ?, ?)
    `);
    return stmt.run(id, userId, keyHash, prefix, label);
  },

  getApiKeyByHash(keyHash) {
    const db = getDb();
    return db.prepare('SELECT * FROM agent_api_keys WHERE key_hash = ?').get(keyHash);
  },

  listApiKeys(userId) {
    const db = getDb();
    return db.prepare('SELECT id, label, prefix, created_at, last_used_at FROM agent_api_keys WHERE user_id = ? ORDER BY created_at DESC').all(userId);
  },

  deleteApiKey(id) {
    const db = getDb();
    return db.prepare('DELETE FROM agent_api_keys WHERE id = ?').run(id);
  },

  // Agent Pairing Codes
  createPairingCode(code, userId, expiresAt) {
    const db = getDb();
    return db.prepare('INSERT INTO agent_pairing_codes (code, user_id, expires_at) VALUES (?, ?, ?)').run(code, userId, expiresAt);
  },

  getPairingCode(code) {
    const db = getDb();
    return db.prepare('SELECT * FROM agent_pairing_codes WHERE code = ?').get(code);
  },

  deletePairingCode(code) {
    const db = getDb();
    return db.prepare('DELETE FROM agent_pairing_codes WHERE code = ?').run(code);
  },

  touchApiKey(id) {
    const db = getDb();
    return db.prepare("UPDATE agent_api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
  }
};

export default { getDatabase, initializeDatabase, closeDatabase, dbHelpers };
