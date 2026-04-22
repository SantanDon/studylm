const fs = require('fs');
const path = 'C:/Users/Don Santos/Dropbox/PC/Desktop/DocketDive/studylm/backend/src/db/schema.ts';

const content = fs.readFileSync(path, 'utf8');

// The 500 is likely caused by Drizzle ORM trying to serialize a Date object 
// for the joinedAt field, which in the DB is an 'integer' column.
// We'll remove the $defaultFn from joinedAt and handle the timestamp manually in the helper.

const oldLine = "joinedAt: integer('joined_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),";
const newLine = "joinedAt: integer('joined_at', { mode: 'timestamp' }),";

if (content.includes(oldLine)) {
  const result = content.replace(oldLine, newLine);
  fs.writeFileSync(path, result);
  console.log('SUCCESS: Schema joinedAt hardened.');
} else {
  console.error('Line not found in schema. Checking for variant...');
  const variant = "joinedAt: integer('joined_at', { mode: 'timestamp' }).$defaultFn(() => Date.now()),";
  if (content.includes(variant)) {
    const result = content.replace(variant, newLine);
    fs.writeFileSync(path, result);
    console.log('SUCCESS: Schema joinedAt hardened (variant).');
  } else {
    // Check if it's already fixed
    if (content.includes(newLine)) {
        console.log('Already fixed.');
    } else {
        process.exit(1);
    }
  }
}
