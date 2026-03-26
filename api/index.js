import { app, initializeRoutes } from '../backend/src/server.js';
import { initializeDatabase } from '../backend/src/db/database.js';

let initialized = false;

export default async (req, res) => {
  if (!initialized) {
    console.log('🚀 Bootstrapping serverless environment...');
    await initializeDatabase();
    await initializeRoutes();
    initialized = true;
  }
  return app(req, res);
};
