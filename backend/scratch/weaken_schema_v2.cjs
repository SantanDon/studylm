const fs = require('fs');
const path = 'C:/Users/Don Santos/Dropbox/PC/Desktop/DocketDive/studylm/backend/src/db/schema.ts';

const content = fs.readFileSync(path, 'utf8');

const start = content.indexOf("export const notebookMembers");
const end = content.indexOf("});", start) + 3;

const weakenedSchema = `export const notebookMembers = sqliteTable('notebook_members', {
  id: text('id').primaryKey(),
  notebookId: text('notebook_id').notNull(),
  userId: text('user_id').notNull(),
  role: text('role').default('viewer'),
  joinedAt: integer('joined_at'),
});`;

const result = content.substring(0, start) + weakenedSchema + content.substring(end);
fs.writeFileSync(path, result);
console.log('SUCCESS: Schema notebookMembers weakened.');
