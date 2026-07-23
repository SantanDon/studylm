import { createClient as createWebClient } from '@libsql/client/web';
import { construct as drizzle } from 'drizzle-orm/libsql/driver-core';
import { migrate } from 'drizzle-orm/libsql/migrator';
import * as schema from './schema.js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { eq, sql, and, or, desc, asc, inArray } from 'drizzle-orm';
import { logger } from '../utils/logger.js';
import { createSingleFlight } from '../utils/singleFlight.js';
import { withDatabaseRetry } from '../utils/databaseRetry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../../../.env') });

const isVercel = process.env.VERCEL === '1' || !!process.env.VERCEL;

// On Vercel, we absolutely MUST NOT fallback to a file: URL.
// Doing so causes @libsql/client to dynamically load better-sqlite3 native bindings,
// which causes a fatal process crash on Amazon Linux.
let url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken) {
  if (isVercel) {
    throw new Error('❌ [SECURITY] TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set in Vercel environment.');
  }
  // Local fallback logic if needed, but the secret MUST be removed
  logger.warn('Database credentials missing. Falling back to local configuration check.');
}

if (isVercel) {
  logger.info(`[VERCEL] Forcing Turso connection to ${url}`);
}


let client;
let dbInstance;

async function connectDatabase() {
  if (!dbInstance) {
    try {
      logger.info(`Connecting to database at: ${url}`);
      let createClientFn;
      if (url && (url.startsWith('libsql://') || url.startsWith('http://') || url.startsWith('https://'))) {
        logger.info('Using Web client (@libsql/client/web) for HTTP/libsql protocol');
        createClientFn = createWebClient;
      } else {
        logger.info('Using standard client (@libsql/client) for local file protocol');
        const stdClientPath = String('@libsql/client');
        const { createClient } = await import(stdClientPath);
        createClientFn = createClient;
      }
      client = createClientFn({
        url: url,
        authToken: authToken
      });
      dbInstance = drizzle(client, { schema });
      logger.info('Drizzle ORM initialized with LibSQL');
    } catch (error) {
      logger.error('Database load failure:', error);
      throw error;
    }
  }

  return dbInstance;
}

const databaseInitTimeoutMs = Number(process.env.DATABASE_INIT_TIMEOUT_MS || 30_000);
const initializeOnce = createSingleFlight(runDatabaseInitialization, {
  timeoutMs: databaseInitTimeoutMs,
  timeoutMessage: `Database initialization exceeded ${databaseInitTimeoutMs}ms`,
});

export async function getDatabase() {
  await initializeDatabase();
  return dbInstance;
}

export function initializeDatabase() {
  return initializeOnce();
}

async function runDatabaseInitialization() {
  logger.info('Initializing database schema...');
  const db = await connectDatabase();

  // A brand-new local file database has no schema at all. Apply the checked-in
  // baseline migration before the idempotent compatibility migrations below.
  // Remote Turso databases are intentionally excluded because many predate the
  // migration journal and already contain production data.
  if (url?.startsWith('file:')) {
    const usersTable = await db.run(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'`);
    const isBrandNewDatabase = !usersTable.rows || usersTable.rows.length === 0;
    if (isBrandNewDatabase) {
      await migrate(db, { migrationsFolder: join(__dirname, 'migrations') });
    } else {
      logger.info('Existing local schema detected; skipping baseline migration and applying compatibility checks.');
    }
  }

  try {
    const userAlters = [
      ['two_factor_secret', 'text'],
      ['two_factor_enabled', 'integer DEFAULT 0'],
      ['youtube_extractions_today', 'integer DEFAULT 0'],
      ['last_extraction_reset', 'integer'],
    ];
    for (const [col, decl] of userAlters) {
      try { await db.run(sql.raw(`ALTER TABLE users ADD COLUMN ${col} ${decl}`)); }
      catch (e) { logger.debug(`Schema migration (users.${col}): ${e.message}`); }
    }

    await db.run(sql`CREATE TABLE IF NOT EXISTS "api_keys" (
      "id" text PRIMARY KEY NOT NULL,
      "user_id" text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      "key_hash" text NOT NULL UNIQUE,
      "prefix" text NOT NULL,
      "label" text DEFAULT 'My Agent Key',
      "scopes" text DEFAULT '["notebooks:read","notes:create","chat:all"]',
      "notebook_ids" text,
      "expires_at" integer,
      "rate_limit" integer DEFAULT 0,
      "last_used_at" integer,
      "created_at" integer DEFAULT (strftime('%s', 'now'))
    )`);
    try { await db.run(sql`ALTER TABLE api_keys ADD COLUMN scopes text DEFAULT '["notebooks:read","notes:create","chat:all"]'`); } catch (e) { logger.debug(`Schema migration (scopes): ${e.message}`); }
    try { await db.run(sql`ALTER TABLE api_keys ADD COLUMN notebook_ids text`); } catch (e) { logger.debug(`Schema migration (notebook_ids): ${e.message}`); }
    try { await db.run(sql`ALTER TABLE api_keys ADD COLUMN expires_at integer`); } catch (e) { logger.debug(`Schema migration (expires_at): ${e.message}`); }
    try { await db.run(sql`ALTER TABLE api_keys ADD COLUMN rate_limit integer DEFAULT 0`); } catch (e) { logger.debug(`Schema migration (rate_limit): ${e.message}`); }
    await db.run(sql`CREATE TABLE IF NOT EXISTS "pairing_codes" (
      "code" text PRIMARY KEY NOT NULL,
      "user_id" text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      "expires_at" integer NOT NULL,
      "created_at" integer DEFAULT (strftime('%s', 'now'))
    )`);
    await db.run(sql`CREATE TABLE IF NOT EXISTS "agent_missions" (
      "id" text PRIMARY KEY NOT NULL,
      "user_id" text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      "notebook_id" text NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
      "goal" text NOT NULL,
      "cron" text,
      "max_notes" integer DEFAULT 5,
      "status" text DEFAULT 'active',
      "last_run_at" integer,
      "next_run_at" integer,
      "result" text,
      "created_at" integer DEFAULT (strftime('%s', 'now')),
      "updated_at" integer DEFAULT (strftime('%s', 'now'))
    )`);
    await db.run(sql`CREATE TABLE IF NOT EXISTS "agent_messages" (
      "id" text PRIMARY KEY NOT NULL,
      "notebook_id" text NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
      "from_agent_id" text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      "to_agent_id" text REFERENCES users(id) ON DELETE SET NULL,
      "message_type" text DEFAULT 'thought',
      "subject" text,
      "content" text NOT NULL,
      "read" integer DEFAULT 0,
      "created_at" integer DEFAULT (strftime('%s', 'now'))
    )`);
    await db.run(sql`CREATE TABLE IF NOT EXISTS "sync_data" (
      "id" text PRIMARY KEY NOT NULL,
      "user_id" text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      "type" text NOT NULL,
      "encrypted_data" text NOT NULL,
      "checksum" text NOT NULL,
      "version" integer DEFAULT 1,
      "created_at" integer DEFAULT (strftime('%s', 'now')),
      "updated_at" integer DEFAULT (strftime('%s', 'now'))
    )`);
    await db.run(sql`CREATE TABLE IF NOT EXISTS "deleted_notebooks" (
      "id" text PRIMARY KEY NOT NULL,
      "user_id" text NOT NULL,
      "deleted_at" integer DEFAULT (strftime('%s', 'now'))
    )`);
    await db.run(sql`CREATE TABLE IF NOT EXISTS "agent_uploads" (
      "id" text PRIMARY KEY NOT NULL,
      "user_id" text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      "notebook_id" text NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
      "file_name" text NOT NULL,
      "file_size" integer NOT NULL,
      "mime_type" text NOT NULL,
      "file_path" text NOT NULL,
      "status" text DEFAULT 'pending',
      "created_at" integer DEFAULT (strftime('%s', 'now'))
    )`);
    await db.run(sql`CREATE TABLE IF NOT EXISTS "tags" (
      "id" text PRIMARY KEY NOT NULL,
      "user_id" text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      "notebook_id" text REFERENCES notebooks(id) ON DELETE CASCADE,
      "name" text NOT NULL,
      "color" text DEFAULT '#6366f1',
      "created_at" integer DEFAULT (strftime('%s', 'now'))
    )`);
    await db.run(sql`CREATE TABLE IF NOT EXISTS "tasks" (
      "id" text PRIMARY KEY NOT NULL,
      "user_id" text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      "notebook_id" text NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
      "source_id" text REFERENCES sources(id) ON DELETE SET NULL,
      "content" text NOT NULL,
      "assignee" text DEFAULT 'human',
      "result" text,
      "status" text DEFAULT 'pending',
      "priority" text DEFAULT 'medium',
      "due_date" integer,
      "completed_at" integer,
      "created_at" integer DEFAULT (strftime('%s', 'now')),
      "updated_at" integer DEFAULT (strftime('%s', 'now'))
    )`);
    await db.run(sql`CREATE TABLE IF NOT EXISTS "activity_log" (
      "id" text PRIMARY KEY NOT NULL,
      "notebook_id" text NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
      "user_id" text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      "actor" text NOT NULL,
      "action_type" text NOT NULL,
      "content_preview" text,
      "created_at" integer DEFAULT (strftime('%s', 'now'))
    )`);
    await db.run(sql`CREATE TABLE IF NOT EXISTS "scratchpad" (
      "id" text PRIMARY KEY NOT NULL,
      "notebook_id" text NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
      "user_id" text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      "content" text NOT NULL,
      "ttl_expires_at" integer,
      "created_at" integer DEFAULT (strftime('%s', 'now'))
    )`);
    await db.run(sql`CREATE TABLE IF NOT EXISTS "webhooks" (
      "id" text PRIMARY KEY NOT NULL,
      "notebook_id" text NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
      "user_id" text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      "url" text NOT NULL,
      "events_json" text NOT NULL,
      "created_at" integer DEFAULT (strftime('%s', 'now'))
    )`);
    await db.run(sql`CREATE TABLE IF NOT EXISTS "documents" (
      "id" text PRIMARY KEY NOT NULL,
      "notebook_id" text NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
      "user_id" text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      "title" text NOT NULL,
      "content" text NOT NULL,
      "document_type" text DEFAULT 'general',
      "template" text DEFAULT 'general',
      "status" text DEFAULT 'draft',
      "source_ids" text DEFAULT '[]',
      "metadata" text DEFAULT '{}',
      "current_version" integer DEFAULT 1,
      "created_by" text,
      "created_at" integer DEFAULT (strftime('%s', 'now')),
      "updated_at" integer DEFAULT (strftime('%s', 'now'))
    )`);
    await db.run(sql`CREATE TABLE IF NOT EXISTS "document_versions" (
      "id" text PRIMARY KEY NOT NULL,
      "document_id" text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      "user_id" text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      "version" integer NOT NULL,
      "title" text NOT NULL,
      "content" text NOT NULL,
      "change_summary" text,
      "source_ids" text DEFAULT '[]',
      "created_by" text,
      "created_at" integer DEFAULT (strftime('%s', 'now'))
    )`);
    await db.run(sql`CREATE INDEX IF NOT EXISTS documents_notebook_idx ON documents(notebook_id, updated_at DESC)`);
    await db.run(sql`CREATE INDEX IF NOT EXISTS document_versions_document_idx ON document_versions(document_id, version DESC)`);
    await db.run(sql`CREATE TABLE IF NOT EXISTS "signal_queue" (
      "id" text PRIMARY KEY NOT NULL,
      "user_id" text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      "notebook_id" text REFERENCES notebooks(id) ON DELETE CASCADE,
      "source_id" text,
      "tweet_source_id" text,
      "platform" text NOT NULL,
      "content" text NOT NULL,
      "status" text DEFAULT 'draft',
      "scheduled_for" integer,
      "posted_at" integer,
      "note_id" text,
      "created_at" integer DEFAULT (strftime('%s', 'now')),
      "updated_at" integer DEFAULT (strftime('%s', 'now'))
    )`);
    await db.run(sql`CREATE TABLE IF NOT EXISTS "research_goals" (
      "id" text PRIMARY KEY NOT NULL,
      "user_id" text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      "notebook_id" text NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
      "title" text NOT NULL,
      "description" text,
      "parent_goal_id" text,
      "status" text DEFAULT 'active',
      "priority" text DEFAULT 'medium',
      "source_id" text,
      "source_chunk_id" text,
      "last_activity_at" integer,
      "progress_pct" integer DEFAULT 0,
      "linked_task_ids" text DEFAULT '[]',
      "linked_artifact_ids" text DEFAULT '[]',
      "created_at" integer DEFAULT (strftime('%s', 'now')),
      "updated_at" integer DEFAULT (strftime('%s', 'now'))
    )`);
    // Signal Queue + Research Goals schema is owned by Drizzle in ./schema.js.
    // Idempotent ALTER TABLE guards backfill new columns for existing prod DBs.
    const signalQueueAlters = [
      ['tweet_source_id', 'text'],
      ['updated_at', "integer DEFAULT (strftime('%s', 'now'))"],
    ];
    for (const [col, decl] of signalQueueAlters) {
      try { await db.run(sql.raw(`ALTER TABLE signal_queue ADD COLUMN ${col} ${decl}`)); }
      catch (e) { logger.debug(`Schema migration (signal_queue.${col}): ${e.message}`); }
    }

    const goalAlters = [
      ['parent_goal_id', 'text'],
      ['status', "text DEFAULT 'active'"],
      ['priority', "text DEFAULT 'medium'"],
      ['source_id', 'text'],
      ['source_chunk_id', 'text'],
      ['last_activity_at', 'integer'],
      ['progress_pct', "integer DEFAULT 0"],
      ['linked_task_ids', "text DEFAULT '[]'"],
      ['linked_artifact_ids', "text DEFAULT '[]'"],
      ['updated_at', 'integer'],
    ];
    for (const [col, decl] of goalAlters) {
      try { await db.run(sql.raw(`ALTER TABLE research_goals ADD COLUMN ${col} ${decl}`)); }
      catch (e) { logger.debug(`Schema migration (research_goals.${col}): ${e.message}`); }
    }

    // New: signal queue suggestions cache
    await db.run(sql`CREATE TABLE IF NOT EXISTS "signal_queue_suggestions" (
      "id" text PRIMARY KEY NOT NULL,
      "source_id" text NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      "notebook_id" text NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
      "user_id" text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      "title" text NOT NULL,
      "rationale" text,
      "source_chunk_indices" text DEFAULT '[]',
      "confidence" real DEFAULT 0.5,
      "status" text DEFAULT 'pending',
      "created_at" integer DEFAULT (strftime('%s', 'now'))
    )`);

    logger.info('Schema tables verified.');
  } catch (err) {
    logger.warn('Schema fallback creation skipped (tables may already exist via Drizzle):', err.message);
  }

  logger.info('Database initialization complete.');
}

export function closeDatabase() {
  client = null;
  dbInstance = null;
}

// dbHelpers migrated to Drizzle
export const dbHelpers = {
  // User operations
  async getUserByEmail(email) {
    const db = await getDatabase();
    const result = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
    return result[0];
  },

  async getUserByDisplayName(displayName) {
    const db = await getDatabase();
    const result = await db.select().from(schema.users).where(eq(schema.users.displayName, displayName)).limit(1);
    return result[0];
  },

  async getUserById(id) {
    const db = await getDatabase();
    const result = await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
    return result[0];
  },

  async getUserByVerificationToken(token) {
    const db = await getDatabase();
    const result = await db.select().from(schema.users).where(eq(schema.users.verificationToken, token)).limit(1);
    return result[0];
  },

  async createUser(id, email, passwordHash, displayName = null, accountType = 'human', webhookUrl = null, ownerId = null, isVerified = 0, emailConsent = 0) {
    const db = await getDatabase();
    return await db.insert(schema.users).values({
      id,
      email,
      passwordHash,
      displayName,
      accountType,
      webhookUrl,
      ownerId,
      isVerified: !!isVerified,
      emailConsent: !!emailConsent,
      emailConsentAt: emailConsent ? new Date() : null,
    });
  },

  async updateUser(id, updates) {
    const db = await getDatabase();
    // Map underscore keys to camelCase if needed, or handle partials
    const dbUpdates = { ...updates, updatedAt: new Date() };
    // Drizzle uses the schema object keys
    return await db.update(schema.users).set(dbUpdates).where(eq(schema.users.id, id));
  },

  // User preferences (Dummy handles for legacy compatibility)
  async createUserPreferences(id, userId) {
    logger.debug(`Preferences creation skipped for ${userId}`);
    return { success: true };
  },

  async createUserStats(id, userId) {
    logger.debug(`Stats creation skipped for ${userId}`);
    return { success: true };
  },

  async getUserStats(userId) {
    return { level: 1, xp: 0, notebooks_created: 0 };
  },

  // User preferences
  async getUserPreferences(userId) {
    return { theme: 'dark', language: 'en' }; 
  },

  // Recovery operations
  async storeRecoveryHash(userId, hash) {
    const db = await getDatabase();
    return await db.update(schema.users).set({ recoveryHash: hash, updatedAt: new Date() }).where(eq(schema.users.id, userId));
  },

  async getRecoveryTokenByHash(hash) {
    const db = await getDatabase();
    const result = await db.select().from(schema.recoveryTokens)
      .where(and(
        eq(schema.recoveryTokens.tokenHash, hash),
        eq(schema.recoveryTokens.used, false),
        sql`${schema.recoveryTokens.expiresAt} > CURRENT_TIMESTAMP`
      )).limit(1);
    return result[0];
  },

  async createRecoveryToken(id, userId, tokenHash, expiresAt) {
    const db = await getDatabase();
    return await db.insert(schema.recoveryTokens).values({
      id,
      userId,
      tokenHash,
      expiresAt: new Date(expiresAt),
    });
  },

  async markRecoveryTokenUsed(id) {
    const db = await getDatabase();
    return await db.update(schema.recoveryTokens).set({ used: true }).where(eq(schema.recoveryTokens.id, id));
  },

  async getUserByRecoveryHash(hash) {
    const db = await getDatabase();
    const result = await db.select().from(schema.users).where(eq(schema.users.recoveryHash, hash)).limit(1);
    return result[0];
  },

  // Notebooks
  async getNotebookById(id, userId) {
    const db = await getDatabase();
    
    // Joint check: user is either the owner OR a member
    const result = await db.select().from(schema.notebooks)
      .leftJoin(schema.notebookMembers, eq(schema.notebooks.id, schema.notebookMembers.notebookId))
      .where(and(
        eq(schema.notebooks.id, id),
        or(
          eq(schema.notebooks.userId, userId),
          eq(schema.notebookMembers.userId, userId)
        )
      )).limit(1);
    
    // Since we joined, the result contains metadata from both tables. 
    // We return just the notebook part for compatibility
    return result[0]?.notebooks;
  },

  async getNotebooksByUserId(userId) {
    const db = await getDatabase();
    
    // 1. Get notebooks owned or shared
    const rawNotebooks = await db.select().from(schema.notebooks)
      .leftJoin(schema.notebookMembers, eq(schema.notebooks.id, schema.notebookMembers.notebookId))
      .where(or(
        eq(schema.notebooks.userId, userId),
        eq(schema.notebookMembers.userId, userId)
      ))
      .orderBy(desc(schema.notebooks.updatedAt));

    // Deduplicate and extract IDs
    const seen = new Set();
    const notebooks = rawNotebooks.map(r => r.notebooks).filter(nb => {
      if (!nb || seen.has(nb.id)) return false;
      seen.add(nb.id);
      return true;
    });

    if (notebooks.length === 0) return [];

    // 2. Optimized batch count for all relevant notebooks
    const ids = notebooks.map(nb => nb.id);
    const countsResult = await db.select({
      notebookId: schema.sources.notebookId,
      count: sql`count(*)`.as('sources_count')
    })
    .from(schema.sources)
    .where(inArray(schema.sources.notebookId, ids))
    .groupBy(schema.sources.notebookId);

    const countsMap = Object.fromEntries(countsResult.map(c => [c.notebookId, Number(c.count)]));

    // 3. Map it back to the expected structure
    return notebooks.map(nb => ({
      ...nb,
      sources: [{ count: countsMap[nb.id] || 0 }]
    }));
  },

  async getNotebooksWithDeepContext(userId) {
    const db = await getDatabase();
    
    // 1. Get notebooks owned or shared
    const rawNotebooks = await db.select().from(schema.notebooks)
      .leftJoin(schema.notebookMembers, eq(schema.notebooks.id, schema.notebookMembers.notebookId))
      .where(or(
        eq(schema.notebooks.userId, userId),
        eq(schema.notebookMembers.userId, userId)
      ))
      .orderBy(desc(schema.notebooks.updatedAt));

    const seen = new Set();
    const notebooks = rawNotebooks.map(r => r.notebooks).filter(nb => {
      if (!nb || seen.has(nb.id)) return false;
      seen.add(nb.id);
      return true;
    });

    if (notebooks.length === 0) return [];

    const ids = notebooks.map(nb => nb.id);

    // 2. Fetch all sources and notes for these notebooks in parallel
    const [allSources, allNotes] = await Promise.all([
      db.select({
        id: schema.sources.id,
        notebookId: schema.sources.notebookId,
        title: schema.sources.title,
        type: schema.sources.type,
        processingStatus: schema.sources.processingStatus
      }).from(schema.sources).where(inArray(schema.sources.notebookId, ids)),
      
      db.select({
        id: schema.notes.id,
        notebookId: schema.notes.notebookId,
        content: schema.notes.content,
        updatedAt: schema.notes.updatedAt
      }).from(schema.notes).where(inArray(schema.notes.notebookId, ids))
    ]);

    // 3. Map sources and notes back to their notebooks
    return notebooks.map(nb => ({
      ...nb,
      sources: allSources.filter(s => s.notebookId === nb.id),
      notes: allNotes.filter(n => n.notebookId === nb.id)
    }));
  },

  async createNotebook(id, userId, title, description = null) {
    const db = await getDatabase();
    // Auto-generate a clean 6-character random join code
    const joinCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    return await db.insert(schema.notebooks).values({ 
      id, 
      userId, 
      title, 
      description,
      joinCode 
    });
  },

                async joinNotebookByCode(userId, joinCode) {
    const db = await getDatabase();
    
    // 1. Find the notebook
    const notebook = await db.select().from(schema.notebooks)
      .where(eq(schema.notebooks.joinCode, joinCode.toUpperCase()))
      .limit(1).then(r => r[0]);
      
    if (!notebook) throw new Error("INVALID_JOIN_CODE");
    
    // 2. Existence check
    const existing = await db.select().from(schema.notebookMembers)
      .where(and(
        eq(schema.notebookMembers.notebookId, notebook.id),
        eq(schema.notebookMembers.userId, userId)
      )).limit(1).then(r => r[0]);
      
    if (existing) return notebook;

    // 3. Insertion with explicit camelCase keys
    try {
      const memberId = "mem-" + Math.random().toString(36).substring(2, 12);
      await db.insert(schema.notebookMembers).values({
        id: memberId,
        notebookId: notebook.id,
        userId: userId,
        role: 'editor',
        joinedAt: new Date()
      });
      logger.debug('Final Join Successful');
    } catch (e) {
      logger.error("Join error:", e.message);
      if (e.message.includes('UNIQUE') || e.message.includes('already exists')) {
        return notebook;
      }
      throw e;
    }
    
    return notebook;
  },

  async updateNotebook(id, userId, updates) {
    const db = await getDatabase();
    return await db.update(schema.notebooks)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(
        eq(schema.notebooks.id, id),
        eq(schema.notebooks.userId, userId)
      ));
  },

  async isNotebookExplicitlyDeleted(id, userId) {
    const db = await getDatabase();
    const result = await db.select().from(schema.deletedNotebooks)
      .where(and(
        eq(schema.deletedNotebooks.id, id),
        eq(schema.deletedNotebooks.userId, userId)
      ))
      .limit(1);
    return result.length > 0;
  },

  async deleteNotebook(id, userId) {
    const db = await getDatabase();
    
    // 1. Check if user is the owner
    const notebook = await db.select().from(schema.notebooks)
      .where(and(eq(schema.notebooks.id, id), eq(schema.notebooks.userId, userId)))
      .limit(1).then(r => r[0]);

    if (notebook) {
      // User is the owner -> Full deletion (cascades handle the rest)
      const result = await db.delete(schema.notebooks).where(eq(schema.notebooks.id, id));
      try {
        await db.insert(schema.deletedNotebooks).values({ id, userId });
      } catch (err) {
        logger.debug(`deletedNotebooks record insertion fail/ignore: ${err.message}`);
      }
      return { changes: result.rowsAffected, action: 'deleted' };
    }

    // 2. Check if user is a member
    const membership = await db.delete(schema.notebookMembers)
      .where(and(eq(schema.notebookMembers.notebookId, id), eq(schema.notebookMembers.userId, userId)));
    
    if (membership.rowsAffected > 0) {
      return { changes: membership.rowsAffected, action: 'left' };
    }

    return { changes: 0, action: 'none' };
  },

  async batchDeleteNotebooks(ids, userId) {
    const db = await getDatabase();
    const result = await db.delete(schema.notebooks)
      .where(and(
        inArray(schema.notebooks.id, ids),
        eq(schema.notebooks.userId, userId)
      ));
    
    if (result.rowsAffected > 0) {
      for (const id of ids) {
        try {
          await db.insert(schema.deletedNotebooks).values({ id, userId });
        } catch (err) {
          logger.debug(`deletedNotebooks batch insertion fail/ignore: ${err.message}`);
        }
      }
    }
    return { changes: result.rowsAffected };
  },

  // Sources
  async getSourcesByNotebookId(notebookId, userId) {
    return withDatabaseRetry(async () => {
      const db = await getDatabase();
      // Verify access first (either owner or member)
      const access = await this.getNotebookById(notebookId, userId);
      if (!access) return [];

      // Return ALL sources for this notebook, as it's a team space
      return await db.select().from(schema.sources)
        .where(eq(schema.sources.notebookId, notebookId))
        .orderBy(desc(schema.sources.updatedAt));
    }, { label: `sources for notebook ${notebookId}` });
  },

  async createSource(id, notebookId, userId, title, type, content = null, url = null, metadata = null, filePath = null, fileSize = 0) {
    const db = await getDatabase();
    return await db.insert(schema.sources).values({
      id,
      notebookId,
      userId,
      title,
      type,
      content,
      url,
      metadata,
      filePath,
      fileSize,
      processingStatus: 'pending',
    });
  },

  async updateSource(id, userId, updates) {
    const db = await getDatabase();
    // Map camcelCase to snake_case if processingStatus is in updates
    const mappedUpdates = { ...updates };
    if (mappedUpdates.metadata && typeof mappedUpdates.metadata !== 'string') {
      mappedUpdates.metadata = JSON.stringify(mappedUpdates.metadata);
    }
    if (mappedUpdates.processing_status) {
      mappedUpdates.processingStatus = mappedUpdates.processing_status;
      delete mappedUpdates.processing_status;
    }
    if (mappedUpdates.file_path) {
      mappedUpdates.filePath = mappedUpdates.file_path;
      delete mappedUpdates.file_path;
    }
    if (mappedUpdates.file_size) {
      mappedUpdates.fileSize = mappedUpdates.file_size;
      delete mappedUpdates.file_size;
    }

    const result = await db.update(schema.sources)
      .set({ ...mappedUpdates, updatedAt: new Date() })
      .where(and(
        eq(schema.sources.id, id),
        eq(schema.sources.userId, userId)
      ));
    return { changes: result.rowsAffected };
  },

  async deleteSource(id, userId) {
    const db = await getDatabase();
    const result = await db.delete(schema.sources)
      .where(and(
        eq(schema.sources.id, id),
        eq(schema.sources.userId, userId)
      ));
    return { changes: result.rowsAffected };
  },

  // Chat
  async getChatMessagesByNotebookId(notebookId, userId) {
    return withDatabaseRetry(async () => {
      const db = await getDatabase();
      // Verify access
      const access = await this.getNotebookById(notebookId, userId);
      if (!access) return [];

      return await db.select().from(schema.chatMessages)
        .where(eq(schema.chatMessages.notebookId, notebookId))
        .orderBy(asc(schema.chatMessages.createdAt));
    }, { label: `messages for notebook ${notebookId}` });
  },

  async deleteChatMessagesByNotebookId(notebookId, userId) {
    const db = await getDatabase();
    // Verify access
    const access = await this.getNotebookById(notebookId, userId);
    if (!access) throw new Error("ACCESS_DENIED");

    return await db.delete(schema.chatMessages)
      .where(eq(schema.chatMessages.notebookId, notebookId));
  },

  async createChatMessage(id, notebookId, userId, role, content, groundedSources = null) {
    const db = await getDatabase();
    // Verify access before allowing chat creation
    const access = await this.getNotebookById(notebookId, userId);
    if (!access) throw new Error("ACCESS_DENIED");

    const groundedSourcesStr = groundedSources ? (typeof groundedSources === 'string' ? groundedSources : JSON.stringify(groundedSources)) : null;
    return await db.insert(schema.chatMessages).values({
      id,
      notebookId,
      userId,
      role,
      content,
      groundedSources: groundedSourcesStr
    });
  },

  // Notes
  async getNotesByNotebookId(notebookId, userId) {
    return withDatabaseRetry(async () => {
      const db = await getDatabase();
      // Verify access
      const access = await this.getNotebookById(notebookId, userId);
      if (!access) return [];

      return await db.select().from(schema.notes)
        .where(eq(schema.notes.notebookId, notebookId))
        .orderBy(desc(schema.notes.updatedAt));
    }, { label: `notes for notebook ${notebookId}` });
  },

  async createNote(id, notebookId, userId, content, authorId = null) {
    const db = await getDatabase();
    return await db.insert(schema.notes).values({
      id,
      notebookId,
      userId,
      content,
      authorId: authorId || userId,
    });
  },

  async deleteUser(id) {
    const db = await getDatabase();
    return await db.delete(schema.users).where(eq(schema.users.id, id));
  },

  // Sovereign Startup Injections (RALPH LOOP 2)
  async globalSearch(userId, query) {
    const db = await getDatabase();
    const cleanQuery = `%${query}%`;
    logger.debug(`Global search: User ${userId}, Query: ${query}`);

    // Query across notebooks, sources, and notes
    const results = {
      notebooks: await db.select().from(schema.notebooks)
        .where(and(eq(schema.notebooks.userId, userId), sql`${schema.notebooks.title} LIKE ${cleanQuery}`)),
      sources: await db.select().from(schema.sources)
        .where(and(eq(schema.sources.userId, userId), sql`${schema.sources.title} LIKE ${cleanQuery} OR ${schema.sources.content} LIKE ${cleanQuery}`)),
      notes: await db.select().from(schema.notes)
        .where(and(eq(schema.notes.userId, userId), sql`${schema.notes.content} LIKE ${cleanQuery}`))
    };

    return results;
  },

  async createTag(userId, notebookId, name, color = '#6366f1') {
    const db = await getDatabase();
    const id = "tag-" + Math.random().toString(36).substring(2, 12);
    return await db.insert(schema.tags).values({ id, userId, notebookId, name, color });
  },

  async getTagsByUserId(userId) {
    const db = await getDatabase();
    return await db.select().from(schema.tags).where(eq(schema.tags.userId, userId));
  },

  async createTask(userId, notebookId, content, assignee = 'human', priority = 'medium', sourceId = null, dueDate = null) {
    const db = await getDatabase();
    const id = "task-" + Math.random().toString(36).substring(2, 12);
    return await db.insert(schema.tasks).values({ id, userId, notebookId, content, assignee, priority, sourceId, dueDate: dueDate ? new Date(dueDate) : null });
  },

  async getTasksByNotebookId(notebookId) {
    const db = await getDatabase();
    return await db.select().from(schema.tasks).where(eq(schema.tasks.notebookId, notebookId))
      .orderBy(desc(schema.tasks.createdAt));
  },

  async updateTask(id, updates) {
    const db = await getDatabase();
    return await db.update(schema.tasks)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(schema.tasks.id, id));
  },

  async getTaskById(id) {
    const db = await getDatabase();
    const result = await db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).limit(1);
    return result[0] || null;
  },

  // Research Goals (v2 schema)
  async createGoal({ id, userId, notebookId, title, description = null, parentGoalId = null, status = 'active', priority = 'medium', sourceId = null, sourceChunkId = null }) {
    const db = await getDatabase();
    const goalId = id || ("goal-" + Math.random().toString(36).substring(2, 12));
    await db.insert(schema.researchGoals).values({
      id: goalId, userId, notebookId, title, description,
      parentGoalId, status, priority, sourceId, sourceChunkId,
      linkedTaskIds: '[]', linkedArtifactIds: '[]', progressPct: 0,
    });
    return goalId;
  },

  async getGoalsByNotebookId(notebookId, { includeArchived = false, parentGoalId = null } = {}) {
    const db = await getDatabase();
    const conds = [eq(schema.researchGoals.notebookId, notebookId)];
    if (!includeArchived) {
      conds.push(sql`${schema.researchGoals.status} != 'archived'`);
    }
    if (parentGoalId === null) {
      conds.push(sql`${schema.researchGoals.parentGoalId} IS NULL`);
    } else if (parentGoalId === '*') {
      // return all including children
    } else {
      conds.push(eq(schema.researchGoals.parentGoalId, parentGoalId));
    }
    const rows = await db.select().from(schema.researchGoals)
      .where(and(...conds))
      .orderBy(desc(schema.researchGoals.priority), desc(schema.researchGoals.lastActivityAt), desc(schema.researchGoals.createdAt));
    return rows.map(r => ({
      ...r,
      linkedTaskIds: r.linkedTaskIds ? JSON.parse(r.linkedTaskIds) : [],
      linkedArtifactIds: r.linkedArtifactIds ? JSON.parse(r.linkedArtifactIds) : [],
    }));
  },

  async getGoalById(id) {
    const db = await getDatabase();
    const result = await db.select().from(schema.researchGoals).where(eq(schema.researchGoals.id, id)).limit(1);
    if (!result[0]) return null;
    const r = result[0];
    return {
      ...r,
      linkedTaskIds: r.linkedTaskIds ? JSON.parse(r.linkedTaskIds) : [],
      linkedArtifactIds: r.linkedArtifactIds ? JSON.parse(r.linkedArtifactIds) : [],
    };
  },

  async updateGoal(id, updates) {
    const db = await getDatabase();
    const patch = { updatedAt: new Date() };
    const allowed = ['title', 'description', 'parentGoalId', 'status', 'priority', 'sourceId', 'sourceChunkId', 'lastActivityAt', 'progressPct'];
    for (const k of allowed) if (k in updates) patch[k] = updates[k];
    await db.update(schema.researchGoals).set(patch).where(eq(schema.researchGoals.id, id));
    return await this.getGoalById(id);
  },

  async deleteGoal(id) {
    const db = await getDatabase();
    await db.delete(schema.researchGoals).where(eq(schema.researchGoals.id, id));
  },

  async getGoalChildren(parentGoalId) {
    const db = await getDatabase();
    return await db.select().from(schema.researchGoals).where(eq(schema.researchGoals.parentGoalId, parentGoalId));
  },

  async linkTaskToGoal(goalId, taskId) {
    const db = await getDatabase();
    const goal = await this.getGoalById(goalId);
    if (!goal) return null;
    const ids = Array.from(new Set([...(goal.linkedTaskIds || []), taskId]));
    await db.update(schema.researchGoals)
      .set({ linkedTaskIds: JSON.stringify(ids), lastActivityAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.researchGoals.id, goalId));
    return await this.getGoalById(goalId);
  },

  async unlinkTaskFromGoal(goalId, taskId) {
    const db = await getDatabase();
    const goal = await this.getGoalById(goalId);
    if (!goal) return null;
    const ids = (goal.linkedTaskIds || []).filter(x => x !== taskId);
    await db.update(schema.researchGoals)
      .set({ linkedTaskIds: JSON.stringify(ids), lastActivityAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.researchGoals.id, goalId));
    return await this.getGoalById(goalId);
  },

  async linkArtifactToGoal(goalId, artifactId) {
    const db = await getDatabase();
    const goal = await this.getGoalById(goalId);
    if (!goal) return null;
    const ids = Array.from(new Set([...(goal.linkedArtifactIds || []), artifactId]));
    await db.update(schema.researchGoals)
      .set({ linkedArtifactIds: JSON.stringify(ids), lastActivityAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.researchGoals.id, goalId));
    return await this.getGoalById(goalId);
  },

  async computeGoalProgress(goalId) {
    const goal = await this.getGoalById(goalId);
    if (!goal) return null;
    const taskIds = goal.linkedTaskIds || [];
    if (taskIds.length === 0) return { ...goal, progressPct: 0, derivedFrom: 'no-tasks' };
    const db = await getDatabase();
    const placeholders = taskIds.map(() => '?').join(',');
    const rows = await db.all(sql.raw(`SELECT status FROM tasks WHERE id IN (${placeholders})`), taskIds);
    if (rows.length === 0) return { ...goal, progressPct: 0, derivedFrom: 'no-tasks' };
    const done = rows.filter(r => r.status === 'completed').length;
    const pct = Math.round((done / rows.length) * 100);
    await db.update(schema.researchGoals)
      .set({ progressPct: pct, lastActivityAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.researchGoals.id, goalId));
    return { ...goal, progressPct: pct, derivedFrom: 'tasks', totalTasks: rows.length, completedTasks: done };
  },

  // Signal queue suggestions (cache for active source)
  async upsertSignalQueueSuggestion({ id, sourceId, notebookId, userId, title, rationale, sourceChunkIndices, confidence = 0.5, status = 'pending' }) {
    const db = await getDatabase();
    const existing = await db.select().from(schema.signalQueueSuggestions)
      .where(and(eq(schema.signalQueueSuggestions.sourceId, sourceId), eq(schema.signalQueueSuggestions.title, title)))
      .limit(1);
    const indices = JSON.stringify(sourceChunkIndices || []);
    if (existing[0]) {
      await db.update(schema.signalQueueSuggestions)
        .set({ rationale, sourceChunkIndices: indices, confidence, status, updatedAt: new Date() })
        .where(eq(schema.signalQueueSuggestions.id, existing[0].id));
      return existing[0].id;
    }
    const sugId = id || ("sug-" + Math.random().toString(36).substring(2, 12));
    await db.insert(schema.signalQueueSuggestions).values({
      id: sugId, sourceId, notebookId, userId, title, rationale,
      sourceChunkIndices: indices, confidence, status,
    });
    return sugId;
  },

  async getSignalQueueSuggestionsBySource(sourceId) {
    const db = await getDatabase();
    return await db.select().from(schema.signalQueueSuggestions)
      .where(eq(schema.signalQueueSuggestions.sourceId, sourceId))
      .orderBy(desc(schema.signalQueueSuggestions.confidence), desc(schema.signalQueueSuggestions.createdAt));
  },

  // Sovereign Bridge - Activity Log
  async createActivityLog(notebookId, userId, actor, actionType, contentPreview = null) {
    const db = await getDatabase();
    const id = "act-" + Math.random().toString(36).substring(2, 12);
    return await db.insert(schema.activityLog).values({ id, notebookId, userId, actor, actionType, contentPreview });
  },

  async getActivityLogsByNotebookId(notebookId) {
    const db = await getDatabase();
    return await db.select().from(schema.activityLog).where(eq(schema.activityLog.notebookId, notebookId))
      .orderBy(desc(schema.activityLog.createdAt));
  },

  // Sovereign Bridge - Scratchpad
  async createScratchpadEntry(notebookId, userId, content, ttlExpiresAt = null) {
    const db = await getDatabase();
    const id = "scr-" + Math.random().toString(36).substring(2, 12);
    return await db.insert(schema.scratchpad).values({ id, notebookId, userId, content, ttlExpiresAt: ttlExpiresAt ? new Date(ttlExpiresAt) : null });
  },

  async getScratchpadByNotebookId(notebookId, userId) {
    const db = await getDatabase();
    return await db.select().from(schema.scratchpad).where(and(
      eq(schema.scratchpad.notebookId, notebookId),
      eq(schema.scratchpad.userId, userId)
    )).orderBy(desc(schema.scratchpad.createdAt));
  },

  async deleteScratchpadEntry(id) {
    const db = await getDatabase();
    return await db.delete(schema.scratchpad).where(eq(schema.scratchpad.id, id));
  },

  // Sovereign Bridge - Webhooks
  async createWebhook(notebookId, userId, url, eventsJson) {
    const db = await getDatabase();
    const id = "whk-" + Math.random().toString(36).substring(2, 12);
    return await db.insert(schema.webhooks).values({ id, notebookId, userId, url, eventsJson });
  },

  async getWebhooksByNotebookId(notebookId) {
    const db = await getDatabase();
    return await db.select().from(schema.webhooks).where(eq(schema.webhooks.notebookId, notebookId));
  },

  // ---- Missing CRUD Methods ----

  async createMemory(id, userId, notebookId, content, embedding, metadata = {}) {
    const db = await getDatabase();
    return await db.insert(schema.memories).values({
      id,
      userId,
      notebookId,
      content,
      embedding: JSON.stringify(embedding),
      metadata: JSON.stringify(metadata),
    });
  },

  async getSuggestedSources(notebookId, userId) {
    const db = await getDatabase();
    return await db.select().from(schema.sources)
      .where(and(
        eq(schema.sources.notebookId, notebookId),
        eq(schema.sources.userId, userId),
        eq(schema.sources.processingStatus, 'suggested')
      ))
      .orderBy(desc(schema.sources.createdAt));
  },

  async acceptSource(sourceId, userId) {
    const db = await getDatabase();
    return await db.update(schema.sources)
      .set({ processingStatus: 'pending', updatedAt: new Date() })
      .where(and(
        eq(schema.sources.id, sourceId),
        eq(schema.sources.userId, userId)
      ));
  },

  async rejectSource(sourceId, userId) {
    const db = await getDatabase();
    return await db.update(schema.sources)
      .set({ processingStatus: 'rejected', updatedAt: new Date() })
      .where(and(
        eq(schema.sources.id, sourceId),
        eq(schema.sources.userId, userId)
      ));
  },

  async getMemoriesByNotebook(notebookId) {
    const db = await getDatabase();
    return await db.select().from(schema.memories)
      .where(eq(schema.memories.notebookId, notebookId))
      .orderBy(desc(schema.memories.createdAt));
  },

  async createApiKey(id, userId, keyHash, prefix, label, scopes = null, notebookIds = null, expiresAt = null, rateLimit = 0) {
    const db = await getDatabase();
    return await db.insert(schema.apiKeys).values({
      id, userId, keyHash, prefix, label,
      scopes: scopes || '["notebooks:read","notes:create","chat:all"]',
      notebookIds: notebookIds ? JSON.stringify(notebookIds) : null,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      rateLimit
    });
  },

  async listApiKeys(userId) {
    const db = await getDatabase();
    return await db.select({
      id: schema.apiKeys.id,
      prefix: schema.apiKeys.prefix,
      label: schema.apiKeys.label,
      scopes: schema.apiKeys.scopes,
      notebookIds: schema.apiKeys.notebookIds,
      expiresAt: schema.apiKeys.expiresAt,
      rateLimit: schema.apiKeys.rateLimit,
      lastUsedAt: schema.apiKeys.lastUsedAt,
      createdAt: schema.apiKeys.createdAt,
    }).from(schema.apiKeys).where(eq(schema.apiKeys.userId, userId))
      .orderBy(desc(schema.apiKeys.createdAt));
  },

  async deleteApiKey(id, userId) {
    const db = await getDatabase();
    const result = await db.delete(schema.apiKeys)
      .where(and(eq(schema.apiKeys.id, id), eq(schema.apiKeys.userId, userId)));
    return { changes: result.rowsAffected };
  },

  async getApiKeyByHash(keyHash) {
    const db = await getDatabase();
    const result = await db.select().from(schema.apiKeys)
      .where(eq(schema.apiKeys.keyHash, keyHash)).limit(1);
    return result[0];
  },

  async touchApiKey(id) {
    const db = await getDatabase();
    return await db.update(schema.apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(schema.apiKeys.id, id));
  },

  async createPairingCode(code, userId, expiresAt) {
    const db = await getDatabase();
    return await db.insert(schema.pairingCodes).values({ code, userId, expiresAt: new Date(expiresAt) });
  },

  async getPairingCode(code) {
    const db = await getDatabase();
    const result = await db.select().from(schema.pairingCodes)
      .where(eq(schema.pairingCodes.code, code)).limit(1);
    return result[0];
  },

  async deletePairingCode(code) {
    const db = await getDatabase();
    return await db.delete(schema.pairingCodes).where(eq(schema.pairingCodes.code, code));
  },

  async getNoteById(noteId, userId) {
    const db = await getDatabase();
    const result = await db.select({
      id: schema.notes.id,
      notebookId: schema.notes.notebookId,
      content: schema.notes.content,
      version: schema.notes.version,
      authorId: schema.notes.authorId,
      createdAt: schema.notes.createdAt,
      updatedAt: schema.notes.updatedAt,
    }).from(schema.notes).where(and(
      eq(schema.notes.id, noteId),
      eq(schema.notes.userId, userId)
    )).limit(1);
    return result[0];
  },

  async updateNote(noteId, userId, content) {
    const db = await getDatabase();
    const result = await db.update(schema.notes)
      .set({ content, version: sql`version + 1`, updatedAt: new Date() })
      .where(and(eq(schema.notes.id, noteId), eq(schema.notes.userId, userId)));
    return { changes: result.rowsAffected };
  },

  // Agent Missions
  async createAgentMission(id, userId, notebookId, goal, cron = null, maxNotes = 5) {
    const db = await getDatabase();
    return await db.insert(schema.agentMissions).values({ id, userId, notebookId, goal, cron, maxNotes });
  },

  async getAgentMissionsByUserId(userId) {
    const db = await getDatabase();
    return await db.select().from(schema.agentMissions)
      .where(eq(schema.agentMissions.userId, userId))
      .orderBy(desc(schema.agentMissions.createdAt));
  },

  async getAgentMissionsByNotebookId(notebookId) {
    const db = await getDatabase();
    return await db.select().from(schema.agentMissions)
      .where(eq(schema.agentMissions.notebookId, notebookId))
      .orderBy(desc(schema.agentMissions.createdAt));
  },

  async getAgentMissionById(id) {
    const db = await getDatabase();
    const result = await db.select().from(schema.agentMissions)
      .where(eq(schema.agentMissions.id, id)).limit(1);
    return result[0];
  },

  async updateAgentMission(id, updates) {
    const db = await getDatabase();
    return await db.update(schema.agentMissions)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(schema.agentMissions.id, id));
  },

  async deleteAgentMission(id) {
    const db = await getDatabase();
    return await db.delete(schema.agentMissions).where(eq(schema.agentMissions.id, id));
  },

  // Agent-to-Agent Messages
  async createAgentMessage(id, notebookId, fromAgentId, content, toAgentId = null, messageType = 'thought', subject = null) {
    const db = await getDatabase();
    return await db.insert(schema.agentMessages).values({
      id, notebookId, fromAgentId, toAgentId, content, messageType, subject
    });
  },

  async getAgentMessages(notebookId, agentId = null) {
    const db = await getDatabase();
    const conditions = [eq(schema.agentMessages.notebookId, notebookId)];
    if (agentId) {
      conditions.push(or(
        eq(schema.agentMessages.toAgentId, agentId),
        eq(schema.agentMessages.fromAgentId, agentId)
      ));
    }
    return await db.select().from(schema.agentMessages)
      .where(and(...conditions))
      .orderBy(desc(schema.agentMessages.createdAt));
  },

  async getAgentMessageById(id) {
    const db = await getDatabase();
    const result = await db.select().from(schema.agentMessages)
      .where(eq(schema.agentMessages.id, id))
      .limit(1);
    return result[0];
  },

  async markAgentMessageRead(id, agentId = null) {
    const db = await getDatabase();
    const conditions = [eq(schema.agentMessages.id, id)];
    if (agentId) {
      conditions.push(or(
        eq(schema.agentMessages.toAgentId, agentId),
        eq(schema.agentMessages.fromAgentId, agentId)
      ));
    }
    return await db.update(schema.agentMessages)
      .set({ read: true })
      .where(and(...conditions));
  },

  async getUnreadAgentMessageCount(agentId) {
    const db = await getDatabase();
    const result = await db.select({ count: sql`count(*)` }).from(schema.agentMessages)
      .where(and(
        eq(schema.agentMessages.toAgentId, agentId),
        eq(schema.agentMessages.read, false)
      ));
    return Number(result[0]?.count || 0);
  },

  // ─── Signal Queue ─────────────────────────────────────────────────────────

  async createSignalQueueItem(id, userId, notebookId, platform, content, sourceId = null, tweetSourceId = null, scheduledFor = null, noteId = null) {
    const db = await getDatabase();
    return await db.run(sql`
      INSERT INTO signal_queue (id, user_id, notebook_id, platform, content, source_id, tweet_source_id, scheduled_for, note_id, status)
      VALUES (${id}, ${userId}, ${notebookId}, ${platform}, ${content}, ${sourceId}, ${tweetSourceId}, ${scheduledFor ? Math.floor(new Date(scheduledFor).getTime() / 1000) : null}, ${noteId}, 'draft')
    `);
  },

  async getSignalQueueByUserId(userId, { status, platform, notebookId, limit = 50 } = {}) {
    const db = await getDatabase();
    let query = sql`SELECT * FROM signal_queue WHERE user_id = ${userId}`;
    if (status) query = sql`${query} AND status = ${status}`;
    if (platform) query = sql`${query} AND platform = ${platform}`;
    if (notebookId) query = sql`${query} AND notebook_id = ${notebookId}`;
    query = sql`${query} ORDER BY created_at DESC LIMIT ${limit}`;
    const result = await db.all(query);
    return result || [];
  },

  async getSignalQueueItemById(id) {
    const db = await getDatabase();
    const result = await db.all(sql`SELECT * FROM signal_queue WHERE id = ${id} LIMIT 1`);
    return result[0] || null;
  },

  async updateSignalQueueItem(id, userId, updates) {
    const db = await getDatabase();
    const fields = [];
    const values = [];
    if (updates.content !== undefined) { fields.push('content = ?'); values.push(updates.content); }
    if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
    if (updates.platform !== undefined) { fields.push('platform = ?'); values.push(updates.platform); }
    if (updates.scheduled_for !== undefined) { fields.push('scheduled_for = ?'); values.push(updates.scheduled_for ? Math.floor(new Date(updates.scheduled_for).getTime() / 1000) : null); }
    if (updates.posted_at !== undefined) { fields.push('posted_at = ?'); values.push(updates.posted_at ? Math.floor(new Date(updates.posted_at).getTime() / 1000) : null); }
    fields.push('updated_at = strftime(\'%s\', \'now\')');
    if (fields.length === 1) return; // only timestamp, nothing to update
    values.push(id, userId);
    await db.$client.execute({ sql: `UPDATE signal_queue SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`, args: values });
  },

  async deleteSignalQueueItem(id, userId) {
    const db = await getDatabase();
    const result = await db.$client.execute({ sql: 'DELETE FROM signal_queue WHERE id = ? AND user_id = ?', args: [id, userId] });
    return { changes: result.rowsAffected || 0 };
  },

  async getSignalQueueStats(userId) {
    const db = await getDatabase();
    const result = await db.all(sql`
      SELECT status, platform, count(*) as count
      FROM signal_queue
      WHERE user_id = ${userId}
      GROUP BY status, platform
    `);
    return result || [];
  },
};

export { dbInstance as db, schema };
export default { getDatabase, initializeDatabase, closeDatabase, dbHelpers };
