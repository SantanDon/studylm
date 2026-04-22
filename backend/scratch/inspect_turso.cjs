const { createClient } = require('@libsql/client');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

async function inspect() {
    const client = createClient({
        url: process.env.TURSO_DATABASE_URL,
        authToken: process.env.TURSO_AUTH_TOKEN,
    });

    console.log('--- TURSO SCHEMA INSPECTION ---');
    try {
        const tableInfo = await client.execute('PRAGMA table_info(notebook_members)');
        console.log('Table Info (notebook_members):');
        console.table(tableInfo.rows);

        const notebooks = await client.execute('SELECT id, join_code FROM notebooks LIMIT 1');
        console.log('Sample Notebook:', notebooks.rows[0]);
    } catch (e) {
        console.error('Inspection failed:', e);
    } finally {
        process.exit(0);
    }
}

inspect();
