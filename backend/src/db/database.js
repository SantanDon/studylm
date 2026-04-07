import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema.js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { eq, sql, and, or, desc, asc } from 'drizzle-orm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../../.env') });

const isVercel = process.env.VERCEL === '1' || !!process.env.VERCEL;

// On Vercel, we absolutely MUST NOT fallback to a file: URL.
// Doing so causes @libsql/client to dynamically load better-sqlite3 native bindings,
// which causes a fatal process crash on Amazon Linux.
let url = process.env.TURSO_DATABASE_URL;
if (!url && isVercel) {
  // We use a dummy libsql address here to prevent native driver loads. 
  // It will fail on connection, but gracefully, allowing us to return a 500 JSON.
  console.error("CRITICAL: TURSO_DATABASE_URL is missing in Vercel ENV. Using dummy URL to prevent native crash.");
  url = 'libsql://dummy-prevent-crash.turso.io'; 
} else if (!url) {
  url = 'file:backend/studypod.db';
}

const authToken = process.env.TURSO_AUTH_TOKEN || (isVercel ? 'missing-token' : '');

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

  // User preferences
  async getUserPreferences(userId) {
    const db = await getDatabase();
    // This table is not yet in schema.ts, needs to be added or managed
    return null; 
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
  async getNotebooksByUserId(userId) {
    const db = await getDatabase();
    return await db.select().from(schema.notebooks)
      .where(or(
        eq(schema.notebooks.userId, userId),
        sql`user_id IN (SELECT id FROM users WHERE owner_id = ${userId})`
      ))
      .orderBy(desc(schema.notebooks.updatedAt));
  },

  async createNotebook(id, userId, title, description = null) {
    const db = await getDatabase();
    return await db.insert(schema.notebooks).values({ id, userId, title, description });
  },

  // Notes
  async getNotesByNotebookId(notebookId, userId) {
    const db = await getDatabase();
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
  }
};

export { dbInstance as db, schema };
export default { getDatabase, initializeDatabase, closeDatabase, dbHelpers };
