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

const cleanFunction = `async joinNotebookByCode(userId, joinCode) {
    const db = await getDatabase();
    
    // Find notebook
    const notebook = await db.select().from(schema.notebooks)
      .where(eq(schema.notebooks.joinCode, joinCode.toUpperCase()))
      .limit(1).then(r => r[0]);
      
    if (!notebook) throw new Error("INVALID_JOIN_CODE");
    
    // Existence check to prevent duplicate membership 500s
    const existing = await db.select().from(schema.notebookMembers)
      .where(and(
        eq(schema.notebookMembers.notebookId, notebook.id),
        eq(schema.notebookMembers.userId, userId)
      )).limit(1).then(r => r[0]);
      
    if (existing) return notebook;

    // Insertion
    try {
      const memberId = "mem-" + Math.random().toString(36).substring(2, 12);
      await db.insert(schema.notebookMembers).values({
        id: memberId,
        notebookId: notebook.id,
        userId: userId,
        role: 'editor',
        joinedAt: new Date()
      });
      console.log('[DB] Joined notebook successfully');
    } catch (e) {
      if (e.message.includes('UNIQUE') || e.message.includes('already exists')) return notebook;
      throw e;
    }
    
    return notebook;
  },

  `;

const result = content.substring(0, start) + cleanFunction + content.substring(end);
fs.writeFileSync(path, result);
console.log('SUCCESS: joinNotebookByCode has been surgically and correctly restored.');
