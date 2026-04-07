import app from '../backend/src/server.js';
import { initializeDatabase } from '../backend/src/db/database.js';

let initialized = false;

export default async (req, res) => {
  if (!initialized) {
    console.log('🚀 Bootstrapping serverless environment...');
    try {
      await initializeDatabase();
    } catch (e) {
      console.error('Failed to initialize database in serverless:', e);
    }
    initialized = true;
  }
  return app(req, res);
};
