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
    const notebook = await db.select().from(schema.notebooks).where(eq(schema.notebooks.joinCode, joinCode)).limit(1).then(r => r[0]);
    if (!notebook) throw new Error("INVALID_JOIN_CODE");
    try {
      const memberId = \x22mem-\x22 + Math.random().toString(36).substring(2, 12);
      console.log(\'[DB] DEBUG: Inserting member with ID:\', memberId, \'Notebook:\', notebook.id, \'User:\', userId); await db.insert(schema.notebookMembers).values({
        id: memberId.toUpperCase(),
        notebookId: notebook.id,
        userId: userId,
        role: 'editor'
      });
    } catch (e) { console.error(\x22[DB] JOIN ERROR DETAIL:\x22, e);
      console.error(\x22FULL STACK:\x22, e.stack); if (!e.message.includes('UNIQUE') && !e.message.includes('already exists')) throw e;
    }
    return notebook;
  },

  `;

const result = content.substring(0, start) + cleanFunction + content.substring(end);
fs.writeFileSync(path, result);
console.log('SUCCESS: joinNotebookByCode has been surgically restored.');
console.log('Replaced', end - start, 'characters between markers.');
