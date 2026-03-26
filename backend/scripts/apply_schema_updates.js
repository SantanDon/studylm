import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.resolve(__dirname, '..', 'src', 'db', 'data', 'insights.db');
const db = new Database(dbPath);

console.log(`Applying schema updates to: ${dbPath}`);

try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_api_keys (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        label TEXT NOT NULL,
        key_hash TEXT NOT NULL,
        prefix TEXT NOT NULL,
        last_used_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);
    console.log('✅ table agent_api_keys ready.');

    db.exec(`
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
    console.log('✅ table agent_uploads ready.');

    console.log('🌟 All schema updates applied successfully.');
} catch (error) {
    console.error('❌ Failed to apply schema updates:', error);
} finally {
    db.close();
}
