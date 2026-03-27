import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken) {
  console.error('❌ TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set in .env');
  process.exit(1);
}

const client = createClient({ url, authToken });

async function migrate() {
  console.log('🚀 Starting migration to Turso (with clean reset)...');
  
  try {
    // Drop existing tables for a clean reset (since we are in test phase)
    const tables = ['agent_uploads', 'agent_keys', 'chat_messages', 'notes', 'sources', 'notebooks', 'user_preferences', 'users'];
    for (const table of tables) {
      console.log(`🗑️ Dropping ${table} table...`);
      await client.execute(`DROP TABLE IF EXISTS ${table}`);
    }

    // Create users table
    console.log('📦 Creating users table...');
    await client.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        display_name TEXT,
        avatar_url TEXT,
        bio TEXT,
        account_type TEXT DEFAULT 'human',
        webhook_url TEXT,
        owner_id TEXT,
        active_agent_id TEXT,
        is_verified INTEGER DEFAULT 0,
        verification_token TEXT,
        token_expires_at DATETIME,
        email_consent INTEGER DEFAULT 0,
        email_consent_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create user_preferences table
    console.log('📦 Creating user_preferences table...');
    await client.execute(`
      CREATE TABLE IF NOT EXISTS user_preferences (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        theme TEXT DEFAULT 'dark',
        accent_color TEXT DEFAULT 'indigo',
        compact_mode INTEGER DEFAULT 0,
        default_model TEXT DEFAULT 'gemini-1.5-flash',
        ai_temperature REAL DEFAULT 0.7,
        auto_title_generation INTEGER DEFAULT 1,
        show_example_questions INTEGER DEFAULT 1,
        email_notifications INTEGER DEFAULT 0,
        browser_notifications INTEGER DEFAULT 1,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      )
    `);

    // Create notebooks table
    console.log('📦 Creating notebooks table...');
    await client.execute(`
      CREATE TABLE IF NOT EXISTS notebooks (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        icon TEXT,
        example_questions TEXT,
        generation_status TEXT DEFAULT 'idle',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      )
    `);

    // Create sources table
    console.log('📦 Creating sources table...');
    await client.execute(`
      CREATE TABLE IF NOT EXISTS sources (
        id TEXT PRIMARY KEY,
        notebook_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT,
        url TEXT,
        metadata TEXT,
        processing_status TEXT DEFAULT 'pending',
        file_path TEXT,
        file_size INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (notebook_id) REFERENCES notebooks (id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      )
    `);

    // Create notes table
    console.log('📦 Creating notes table...');
    await client.execute(`
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        notebook_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        content TEXT NOT NULL,
        author_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (notebook_id) REFERENCES notebooks (id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (author_id) REFERENCES users (id) ON DELETE CASCADE
      )
    `);

    // Create chat_messages table
    console.log('📦 Creating chat_messages table...');
    await client.execute(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        notebook_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        grounded_sources TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (notebook_id) REFERENCES notebooks (id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      )
    `);

    // Create agent_keys table
    console.log('📦 Creating agent_keys table...');
    await client.execute(`
      CREATE TABLE IF NOT EXISTS agent_keys (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        key_name TEXT NOT NULL,
        key_hash TEXT UNIQUE NOT NULL,
        last_used DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      )
    `);

    // Create agent_uploads table
    console.log('📦 Creating agent_uploads table...');
    await client.execute(`
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
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (notebook_id) REFERENCES notebooks (id) ON DELETE CASCADE
      )
    `);

    console.log('✅ Migration completed successfully!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    client.close();
  }
}

migrate();
