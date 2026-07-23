import { getDatabase } from '../db/database.js';

let tableReady;

async function ensureTable() {
  if (!tableReady) {
    tableReady = (async () => {
      const db = await getDatabase();
      await db.$client.execute(`
        CREATE TABLE IF NOT EXISTS app_key_value (
          namespace TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          expires_at INTEGER,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (namespace, key)
        )
      `);
      await db.$client.execute(
        'CREATE INDEX IF NOT EXISTS app_key_value_expiry_idx ON app_key_value(expires_at)'
      );
    })().catch((error) => {
      tableReady = undefined;
      throw error;
    });
  }
  return tableReady;
}

export class LibsqlKeyValueStore {
  constructor(namespace) {
    this.namespace = namespace;
  }

  async get(key) {
    await ensureTable();
    const db = await getDatabase();
    const now = Date.now();
    const result = await db.$client.execute({
      sql: 'SELECT value, expires_at FROM app_key_value WHERE namespace = ? AND key = ? LIMIT 1',
      args: [this.namespace, key],
    });
    const row = result.rows?.[0];
    if (!row) return undefined;
    if (row.expires_at != null && Number(row.expires_at) <= now) {
      await this.delete(key);
      return undefined;
    }
    try {
      return JSON.parse(String(row.value));
    } catch {
      await this.delete(key);
      return undefined;
    }
  }

  async set(key, value, options = {}) {
    await ensureTable();
    const db = await getDatabase();
    const now = Date.now();
    const expiresAt = options.ttlMs == null ? null : now + Math.max(0, options.ttlMs);
    await db.$client.execute({
      sql: `
        INSERT INTO app_key_value (namespace, key, value, expires_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(namespace, key) DO UPDATE SET
          value = excluded.value,
          expires_at = excluded.expires_at,
          updated_at = excluded.updated_at
      `,
      args: [this.namespace, key, JSON.stringify(value), expiresAt, now],
    });
  }

  async delete(key) {
    await ensureTable();
    const db = await getDatabase();
    await db.$client.execute({
      sql: 'DELETE FROM app_key_value WHERE namespace = ? AND key = ?',
      args: [this.namespace, key],
    });
  }
}
