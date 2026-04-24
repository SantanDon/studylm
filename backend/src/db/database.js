import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema.js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { eq, sql, and, or, desc, asc, inArray } from 'drizzle-orm';

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
  console.warn('⚠️ [SECURITY] Database credentials missing. Falling back to local configuration check.');
}

if (isVercel) {
  console.log(`📂 [VERCEL] Forcing Turso connection to ${url}`);
}


let client;
let dbInstance;

export async function getDatabase() {
  if (!dbInstance) {
    try {
      console.log(`📂 Connecting to database at: ${url}`);
      client = createClient({
        url: url,
        authToken: authToken
      });
      dbInstance = drizzle(client, { schema });
      console.log('✅ Drizzle ORM initialized with LibSQL');
    } catch (error) {
      console.error('❌ Database load failure:', error);
      throw error;
    }
  }
  return dbInstance;
}

export async function initializeDatabase() {
  console.log('Initializing database schema (Drizzle mode)...');
  await getDatabase();
  // Tables are managed via schema.ts and push/migrate
  console.log('Database initialization complete.');
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

  async updateUserApiKeys(userId, apiKeys) {
    const db = await getDatabase();
    const keysJson = typeof apiKeys === 'string' ? apiKeys : JSON.stringify(apiKeys);
    return await db.update(schema.users).set({ apiKeys: keysJson, updatedAt: new Date() }).where(eq(schema.users.id, userId));
  },

  // User preferences (Dummy handles for legacy compatibility)
  async createUserPreferences(id, userId) {
    console.log(`[DB] Preferences creation skipped for ${userId} (Table not in schema)`);
    return { success: true };
  },

  async createUserStats(id, userId) {
    console.log(`[DB] Stats creation skipped for ${userId} (Table not in schema)`);
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
      console.log('[DB] Final Join Successful');
    } catch (e) {
      console.error("[DB] ULTIMATE JOIN ERROR:", e.message);
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

  async deleteNotebook(id, userId) {
    const db = await getDatabase();
    
    // 1. Check if user is the owner
    const notebook = await db.select().from(schema.notebooks)
      .where(and(eq(schema.notebooks.id, id), eq(schema.notebooks.userId, userId)))
      .limit(1).then(r => r[0]);

    if (notebook) {
      // User is the owner -> Full deletion (cascades handle the rest)
      const result = await db.delete(schema.notebooks).where(eq(schema.notebooks.id, id));
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
    return { changes: result.rowsAffected };
  },

  // Sources
  async getSourcesByNotebookId(notebookId, userId) {
    const db = await getDatabase();
    // Verify access first (either owner or member)
    const access = await this.getNotebookById(notebookId, userId);
    if (!access) return [];

    // Return ALL sources for this notebook, as it's a team space
    return await db.select().from(schema.sources)
      .where(eq(schema.sources.notebookId, notebookId))
      .orderBy(desc(schema.sources.updatedAt));
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

  // Chat
  async getChatMessagesByNotebookId(notebookId, userId) {
    const db = await getDatabase();
    // Verify access
    const access = await this.getNotebookById(notebookId, userId);
    if (!access) return [];

    return await db.select().from(schema.chatMessages)
      .where(eq(schema.chatMessages.notebookId, notebookId))
      .orderBy(asc(schema.chatMessages.createdAt));
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
    const db = await getDatabase();
    // Verify access
    const access = await this.getNotebookById(notebookId, userId);
    if (!access) return [];

    return await db.select().from(schema.notes)
      .where(eq(schema.notes.notebookId, notebookId))
      .orderBy(desc(schema.notes.updatedAt));
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
    console.log(`🔍 [GLOBAL SEARCH] User: ${userId}, Query: ${query}`);

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

  async createTask(userId, notebookId, content, priority = 'medium', sourceId = null) {
    const db = await getDatabase();
    const id = "task-" + Math.random().toString(36).substring(2, 12);
    return await db.insert(schema.tasks).values({ id, userId, notebookId, content, priority, sourceId });
  },

  async getTasksByNotebookId(notebookId) {
    const db = await getDatabase();
    return await db.select().from(schema.tasks).where(eq(schema.tasks.notebookId, notebookId))
      .orderBy(desc(schema.tasks.createdAt));
  }
};

export { dbInstance as db, schema };
export default { getDatabase, initializeDatabase, closeDatabase, dbHelpers };
