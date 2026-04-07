import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default async (req, res) => {
  try {
    const rootDir = process.cwd();
    const serverPath = path.resolve(rootDir, 'backend/src/server.js');
    
    if (!fs.existsSync(serverPath)) {
      return res.status(500).json({
        error: 'Backend initialization failed',
        message: 'server.js not found at ' + serverPath,
        cwd: rootDir,
        apiDir: __dirname,
        rootContents: fs.readdirSync(rootDir)
      });
    }

    // Dynamic import of the Express app
    const module = await import(serverPath);
    const app = module.default || module;
    
    // Bridge the Vercel request/response to the Express app
    return app(req, res);
  } catch (error) {
    console.error('Fatal API Bridge Error:', error);
    return res.status(500).json({
      error: 'API Bridge Crash',
      message: error.message,
      stack: error.stack,
      code: error.code
    });
  }
};
