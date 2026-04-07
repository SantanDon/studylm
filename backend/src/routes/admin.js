import express from 'express';
import { sql } from 'drizzle-orm';
import { getDatabase, schema } from '../db/database.js';

const router = express.Router();

// Administrative Migration Trigger
router.get('/migrate', async (req, res) => {
  try {
    const db = await getDatabase();
    console.log('🚀 Starting Runtime Schema Synchronization...');
    
    // We can't run drizzle-kit push easily in a serverless env, 
    // but we can ensure the core table exists manually if needed, 
    // or use drizzle-orm to 'sync' if we had migrations.
    // For now, we'll try a raw check and return status.
    
    const tableCheck = await db.run(sql`SELECT name FROM sqlite_master WHERE type='table' AND name='users'`);
    
    if (tableCheck.rows.length === 0) {
      console.log('⚠️ users table missing. Manual initialization required.');
      // Since we're using Drizzle, the tables SHOULD be there if we ran push.
      // If not, we can try to run a raw CREATE TABLE as a fallback.
      await db.run(sql`
        CREATE TABLE IF NOT EXISTS "users" (
          "id" text PRIMARY KEY NOT NULL,
          "email" text NOT NULL,
          "password_hash" text NOT NULL,
          "display_name" text,
          "bio" text,
          "avatar_url" text,
          "account_type" text DEFAULT 'human',
          "webhook_url" text,
          "owner_id" text,
          "is_verified" integer DEFAULT 0,
          "verification_token" text,
          "token_expires_at" integer,
          "email_consent" integer DEFAULT 0,
          "email_consent_at" integer,
          "recovery_hash" text,
          "created_at" integer DEFAULT (strftime('%s', 'now')),
          "updated_at" integer DEFAULT (strftime('%s', 'now'))
        );
      `);
      
      await db.run(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS "users_email_unique" ON "users" ("email");
      `);
      
       await db.run(sql`
        CREATE TABLE IF NOT EXISTS "notebooks" (
          "id" text PRIMARY KEY NOT NULL,
          "user_id" text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          "title" text NOT NULL,
          "description" text,
          "created_at" integer DEFAULT (strftime('%s', 'now')),
          "updated_at" integer DEFAULT (strftime('%s', 'now'))
        );
      `);

      return res.json({ 
        status: 'Tables Initialized', 
        message: 'The users and notebooks tables have been manually created in the cloud.',
        tables: ['users', 'notebooks']
      });
    }

    return res.json({ 
      status: 'Ready', 
      message: 'The users table already exists.',
      details: tableCheck.rows 
    });
  } catch (error) {
    console.error('Migration Error:', error);
    return res.status(500).json({ 
      error: 'Migration Failed', 
      message: error.message,
      stack: error.stack
    });
  }
});

export default router;
