import { getDatabase, dbHelpers } from './src/db/database.js';
import bcrypt from 'bcryptjs';

async function check() {
  await getDatabase();
  const emails = ['don16santos@gmail.com', 'don047671@gmail.com', 'santlabs22@gmail.com'];
  for (const email of emails) {
    const user = await dbHelpers.getUserByEmail(email);
    if (!user) {
      console.log(`${email} NOT FOUND`);
      continue;
    }
    console.log(`${email} found`);
    const match1 = await bcrypt.compare('SantanDon', user.password_hash);
    const match2 = await bcrypt.compare('SantanDon16!', user.password_hash);
    console.log(`  SantanDon: ${match1} | SantanDon16!: ${match2}`);
  }
  process.exit(0);
}
check();
