import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Correct path from backend/scripts to backend/src/db/data/insights.db
const dbPath = path.resolve(__dirname, '..', 'src', 'db', 'data', 'insights.db');
const db = new Database(dbPath);

async function setup() {
    const displayName = 'Human Tester';
    const passphrase = 'password123';
    const email = 'tester@human.local';

    console.log(`Setting up test human: ${displayName}`);

    const user = db.prepare('SELECT id FROM users WHERE display_name = ?').get(displayName);
    if (user) {
        console.log('User exists. Updating password...');
        const hash = await bcrypt.hash(passphrase, 10);
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
    } else {
        console.log('Creating new user...');
        const userId = uuidv4();
        const hash = await bcrypt.hash(passphrase, 10);
        db.prepare(`
            INSERT INTO users (id, email, password_hash, display_name, account_type)
            VALUES (?, ?, ?, ?, ?)
        `).run(userId, email, hash, displayName, 'human');
        
        db.prepare('INSERT INTO user_preferences (id, user_id) VALUES (?, ?)').run(uuidv4(), userId);
        db.prepare('INSERT INTO user_stats (id, user_id) VALUES (?, ?)').run(uuidv4(), userId);
    }
    console.log('✅ Base user ready for stress test.');
}

setup().catch(console.error);
