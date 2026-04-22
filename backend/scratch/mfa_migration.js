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
  console.log('🚀 Running MFA migration...');
  
  try {
    // Add two_factor_secret column
    console.log('📦 Adding two_factor_secret to users...');
    try {
      await client.execute('ALTER TABLE users ADD COLUMN two_factor_secret TEXT');
      console.log('✅ Added two_factor_secret');
    } catch (e) {
      if (e.message.includes('duplicate column name')) {
        console.log('ℹ️ two_factor_secret already exists');
      } else {
        throw e;
      }
    }

    // Add two_factor_enabled column
    console.log('📦 Adding two_factor_enabled to users...');
    try {
      await client.execute('ALTER TABLE users ADD COLUMN two_factor_enabled INTEGER DEFAULT 0');
      console.log('✅ Added two_factor_enabled');
    } catch (e) {
      if (e.message.includes('duplicate column name')) {
        console.log('ℹ️ two_factor_enabled already exists');
      } else {
        throw e;
      }
    }

    console.log('✅ MFA Migration completed successfully!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    client.close();
  }
}

migrate();
