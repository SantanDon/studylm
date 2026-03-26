import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, 'backend', 'data', 'insights.db');

try {
  console.log('Opening database:', dbPath);
  const db = new DatabaseSync(dbPath);
  const users = db.prepare('SELECT id, email, is_verified, display_name FROM users').all();
  console.log('USER_LIST_START');
  console.log(JSON.stringify(users, null, 2));
  console.log('USER_LIST_END');
} catch (e) {
  console.error('DATABASE_ERROR:', e);
}
