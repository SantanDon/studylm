// API BRIDGE v1.0.4
import app from '../backend/src/server.js';

// Force Vercel to bundle dynamic/optional and backend dependencies
import 'cookie-parser';
import 'cors';
import 'helmet';
import 'express-rate-limit';
import 'dotenv';
import 'express';
import 'jsonwebtoken';
import 'bcryptjs';
import '@libsql/client/web';
import 'drizzle-orm';
import 'uuid';
import 'qrcode';
import 'otplib';
import 'cheerio';
import 'epub';
import '@google/genai';
import 'node-fetch';
import 'mammoth';
import 'multer';

export default async (req, res) => {
  try {
    // Bridge the Vercel request/response directly to the statically imported Express app
    return app(req, res);
  } catch (error) {
    console.error('Fatal API Bridge Error:', error);
    return res.status(500).json({
      error: 'API Bridge Crash',
      message: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message
    });
  }
};
