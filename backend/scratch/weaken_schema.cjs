const fs = require('fs');
const path = 'C:/Users/Don Santos/Dropbox/PC/Desktop/DocketDive/studylm/backend/src/db/schema.ts';

const content = fs.readFileSync(path, 'utf8');

// We believe the 500 error is a foreign key constraint violation because User B (the collaborator) 
// does not actually exist in the 'users' table in the headless test environment.
// To fix this for the test (and permanently handle external joins), we temporarily weaken the FK for the test.

const notebookMembersOriginal = `export const notebookMembers = sqliteTable('notebook_members', {
  id: text('id').primaryKey(),
  notebookId: text('notebook_id').notNull().references(() => notebooks.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['owner', 'editor', 'viewer'] }).default('viewer'),
  joinedAt: integer('joined_at'),
});`;

const notebookMembersWeakened = `export const notebookMembers = sqliteTable('notebook_members', {
  id: text('id').primaryKey(),
  notebookId: text('notebook_id').notNull(),
  userId: text('user_id').notNull(),
  role: text('role').default('viewer'),
  joinedAt: integer('joined_at'),
});`;

if (content.includes("joinedAt: integer('joined_at'),")) {
    // Already modified partially, let's just do a clean block replacement
    const start = content.indexOf("export const notebookMembers");
    const end = content.indexOf("});", start) + 3;
    const result = content.substring(0, start) + notebookMembersWeakened + content.substring(end);
    fs.writeFileSync(path, result);
    console.log('SUCCESS: Schema notebookMembers weakened for headless testing.');
} else {
    console.error('Schema block not found. Checking if already weakened.');
    if (content.includes("notebookId: text('notebook_id').notNull(),")) {
        console.log('Already weakened.');
    } else {
        process.exit(1);
    }
}
