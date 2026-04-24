import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../../.env') });

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken) {
  console.error('❌ Missing database credentials in .env');
  process.exit(1);
}

const client = createClient({ url, authToken });

async function patchSchema() {
  console.log('⚡ Starting Sovereignty Patch: Injecting extraction telemetry into users table...');
  
  try {
    // 1. Check current columns
    const columns = await client.execute('PRAGMA table_info(users)');
    const columnNames = columns.rows.map(r => r.name);
    
    console.log('Current columns:', columnNames);

    const patches = [
      { name: 'youtube_extractions_today', sql: 'ALTER TABLE users ADD COLUMN youtube_extractions_today INTEGER DEFAULT 0' },
      { name: 'last_extraction_reset', sql: 'ALTER TABLE users ADD COLUMN last_extraction_reset INTEGER' }
    ];

    for (const patch of patches) {
      if (!columnNames.includes(patch.name)) {
        console.log(`Infecting ${patch.name}...`);
        await client.execute(patch.sql);
        console.log(`✅ ${patch.name} injected.`);
      } else {
        console.log(`⏭️ ${patch.name} already exists.`);
      }
    }

    console.log('✨ Sovereignty Patch Complete. The login barrier should be shattered.');
  } catch (error) {
    console.error('❌ Patch Failure:', error.message);
  } finally {
    process.exit(0);
  }
}

patchSchema();
