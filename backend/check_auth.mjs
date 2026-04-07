import { dbHelpers, getDatabase } from './src/db/database.js';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

async function run() {
  await getDatabase();
  const email = 'don16santos@gmail.com';
  console.log(`Checking user: ${email}...`);
  try {
    const user = await dbHelpers.getUserByEmail(email);
    if (!user) {
      console.log('User not found in Turso.');
      return;
    }
    console.log('User found:', { id: user.id, email: user.email, hasPassword: !!user.password_hash });
    
    const testPassword = 'SantanDon16!';
    console.log(`Testing password: ${testPassword}`);
    
    if (user.password_hash) {
      const isMatch = await bcrypt.compare(testPassword, user.password_hash);
      console.log(`Password match result: ${isMatch}`);
      
      if (!isMatch) {
         console.log("Forcing password reset...");
         const newHash = await bcrypt.hash(testPassword, 10);
         await dbHelpers.updateUser(user.id, { password_hash: newHash });
         console.log("Password successfully reset to SantanDon16!");
      }
    } else {
      console.log("User has no password hash!");
    }
  } catch (error) {
    console.error("Error connecting to database:", error);
  }
}

run().then(() => process.exit(0));
