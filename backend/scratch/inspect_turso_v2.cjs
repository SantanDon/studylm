const { createClient } = require('@libsql/client');
const fs = require('fs');

// Root file system check for .env
const envPath = 'C:/Users/Don Santos/Dropbox/PC/Desktop/DocketDive/studylm/.env';
const envContent = fs.readFileSync(envPath, 'utf8');

function getEnvValue(key) {
    const match = envContent.match(new RegExp(\`^\${key}=(.*)$\`, 'm'));
    return match ? match[1].trim() : null;
}

const dbUrl = getEnvValue('TURSO_DATABASE_URL');
const dbToken = getEnvValue('TURSO_AUTH_TOKEN');

async function inspect() {
    if (!dbUrl) {
        console.error('TURSO_DATABASE_URL not found in .env');
        process.exit(1);
    }

    const client = createClient({
        url: dbUrl,
        authToken: dbToken,
    });

    console.log('--- TURSO SCHEMA INSPECTION ---');
    try {
        const tableInfo = await client.execute('PRAGMA table_info(notebook_members)');
        console.log('Table Info (notebook_members):');
        console.table(tableInfo.rows);
    } catch (e) {
        console.error('Inspection failed:', e);
    } finally {
        process.exit(0);
    }
}

inspect();
