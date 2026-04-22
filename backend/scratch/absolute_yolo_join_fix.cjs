const fs = require('fs');
const path = 'C:/Users/Don Santos/Dropbox/PC/Desktop/DocketDive/studylm/backend/src/db/database.js';

const content = fs.readFileSync(path, 'utf8');

const startMarker = 'async joinNotebookByCode';
const endMarker = 'async updateNotebook';

const start = content.indexOf(startMarker);
const end = content.indexOf(endMarker);

if (start === -1 || end === -1) {
  console.error('Markers not found! start:', start, 'end:', end);
  process.exit(1);
}

// THE FINAL HARDENING: 
// 1. Case-insensitive join code search
// 2. Existence check with camelCase (Drizzle style)
// 3. Absolute RAW SQL insertion to bypass ALL Drizzle/Naming/Date confusion
// 4. Verification logging
const cleanFunction = `async joinNotebookByCode(userId, joinCode) {
    const db = await getDatabase();
    
    // 1. Find the notebook
    const notebook = await db.select().from(schema.notebooks)
      .where(eq(sql\`upper(\${schema.notebooks.joinCode})\`, joinCode.toUpperCase()))
      .limit(1).then(r => r[0]);
      
    if (!notebook) throw new Error("INVALID_JOIN_CODE");
    
    // 2. Check if membership already exists (Drizzle select uses schema names)
    const existing = await db.select().from(schema.notebookMembers)
      .where(and(
        eq(schema.notebookMembers.notebookId, notebook.id),
        eq(schema.notebookMembers.userId, userId)
      )).limit(1).then(r => r[0]);
      
    if (existing) return notebook;

    // 3. Absolute SQL insertion bypass
    try {
      const memberId = "mem-" + Math.random().toString(36).substring(2, 15);
      const joinedAt = Date.now();
      
      await db.run(sql\`
        INSERT INTO notebook_members (id, notebook_id, user_id, role, joined_at) 
        VALUES (\${memberId}, \${notebook.id}, \${userId}, 'editor', \${joinedAt})
      \`);
      
      console.log('[DB] RAW JOIN SUCCESSFUL:', notebook.id);
    } catch (e) {
      console.error("[DB] FINAL JOIN ERROR:", e.message);
      if (e.message.includes('UNIQUE') || e.message.includes('already exists')) {
        return notebook;
      }
      throw e;
    }
    
    return notebook;
  },

  `;

const result = content.substring(0, start) + cleanFunction + content.substring(end);
fs.writeFileSync(path, result);
console.log('SUCCESS: joinNotebookByCode has been hardened with Absolute RAW SQL Bypass.');
