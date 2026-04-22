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

// 5TH OVERTO: Absolute Bare Minimum - No Date, No snake_case, No complex logic.
const cleanFunction = `async joinNotebookByCode(userId, joinCode) {
    const db = await getDatabase();
    
    // Find notebook
    const notebook = await db.select().from(schema.notebooks)
      .where(eq(schema.notebooks.joinCode, joinCode.toUpperCase()))
      .limit(1).then(r => r[0]);
      
    if (!notebook) throw new Error("INVALID_JOIN_CODE");
    
    // Existence check
    try {
        const existing = await db.select().from(schema.notebookMembers)
          .where(and(
            eq(schema.notebookMembers.notebookId, notebook.id),
            eq(schema.notebookMembers.userId, userId)
          )).limit(1).then(r => r[0]);
          
        if (existing) return notebook;

        const memberId = "mem-" + Math.random().toString(36).substring(2, 15);
        
        await db.insert(schema.notebookMembers).values({
            id: memberId,
            notebookId: notebook.id,
            userId: userId,
            role: 'editor'
        });
        
        console.log('[DB] Final stabilized join successful');
    } catch (e) {
        console.error('[DB] STABILIZED JOIN ERROR:', e.message);
        if (e.message.includes('UNIQUE') || e.message.includes('already exists')) return notebook;
        throw e;
    }
    
    return notebook;
  },

  `;

const result = content.substring(0, start) + cleanFunction + content.substring(end);
fs.writeFileSync(path, result);
console.log('SUCCESS: Barebones stabilized join restored.');
