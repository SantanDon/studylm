let initialized = false;
let appInstance = null;
let dbInitializer = null;

export default async (req, res) => {
  try {
    if (!initialized) {
      console.log('🚀 Bootstrapping serverless environment with dynamic imports...');
      
      // Step 1: Dynamically import database initializer to find top-level crashes
      console.log('-> Loading DB helper...');
      const dbModule = await import('../backend/src/db/database.js');
      dbInitializer = dbModule.initializeDatabase;
      await dbInitializer();

      // Step 2: Dynamically import the main server app
      console.log('-> Loading Express app...');
      const serverModule = await import('../backend/src/server.js');
      appInstance = serverModule.default;
      
      initialized = true;
      console.log('✅ Bootstrapped successfully.');
    }
    
    return appInstance(req, res);
  } catch (error) {
    console.error('SERVERLESS_BOOT_ERROR:', error);
    res.status(500).json({
      error: 'Module Import or Architecture Error',
      message: error.message,
      stack: error.stack,
      hint: 'This stack trace should tell us exactly which file (e.g., server.js, sync.js) triggered the 500 boot crash on Vercel.'
    });
  }
};
