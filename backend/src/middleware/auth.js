import jwt from 'jsonwebtoken';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { dbHelpers, getDatabase, schema } from '../db/database.js';
import { eq, asc } from 'drizzle-orm';

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.warn('⚠️ [AUTH] JWT_SECRET is not set. Token verification will fail, but the server is booting...');
}

export function hashApiKey(rawKey) {
  return createHash('sha256').update(rawKey).digest('hex');
}

export async function authenticateToken(req, res, next) {
   const authHeader = req.headers['authorization'];
   let token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
   
   // If token is a cookie-sentinel, treat it as no token so the cookie fallback executes
   const SENTINELS = ['COOKIE_SESSION', 'SESSION_MANAGED_BY_COOKIE', 'managed_by_cookie'];
   if (SENTINELS.includes(token)) {
     token = null;
   }
   
   // Cookie fallback for Web App
   if (!token && req.cookies && req.cookies.accessToken) {
     token = req.cookies.accessToken;
   }
 
   // Authentication mandatory for all requests

   if (!token) {
     return res.status(401).json({ error: 'Access token required' });
   }

  // API key path — starts with spm_
  if (token.startsWith('spm_')) {
    try {
      const keyHash = hashApiKey(token);
      const keyRow = await dbHelpers.getApiKeyByHash(keyHash);
      if (!keyRow) {
        return res.status(401).json({ error: 'Invalid API key' });
      }
      await dbHelpers.touchApiKey(keyRow.id);
      const user = await dbHelpers.getUserById(keyRow.user_id);
      if (!user) {
        return res.status(401).json({ error: 'User not found' });
      }
      req.user = { userId: user.id, email: user.email };
      return next();
    } catch (err) {
      return res.status(500).json({ error: 'API key validation failed' });
    }
  }

  // JWT path
  try {
    const user = jwt.verify(token, JWT_SECRET);
    
    // VERCEL WORKAROUND: If user exists in JWT but not in DB (DB reset)
    // We auto-provision a shell record so Foreign Keys don't break across isolated endpoints
    const userId = user.userId || user.id;
    if (userId) {
      const existing = await dbHelpers.getUserById(userId);
      if (!existing) {
        console.log(`🛠️ Auto-provisioning missing user ${userId} after DB reset...`);
        try {
          const fallbackEmail = user.email || `recovered_${userId.substring(0, 8)}@studypod.local`;
          await dbHelpers.createUser(userId, fallbackEmail, 'AUTOPROVISIONED_SESSION_RECOVERY', user.displayName || 'Recovered User', user.accountType || 'human');
        } catch (provisionError) {
          console.error('Failed to auto-provision user:', provisionError);
        }
      }
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      console.log(`--> [AUTH] Token expired for token starting with: ${token ? token.substring(0, 10) : 'none'}`);
      return res.status(401).json({ error: 'Token expired' });
    }
    console.error(`--> [AUTH] Invalid token precisely because: ${error.name} - ${error.message}. Token string: '${token}'`);
    return res.status(403).json({ error: 'Invalid token' });
  }
}

export function generateToken(userId, email) {
  return jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: '7d' });
}

export function generateRefreshToken(userId, email) {
  return jwt.sign({ userId, email, type: 'refresh' }, JWT_SECRET, { expiresIn: '30d' });
}

export function verifyRefreshToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.type !== 'refresh') throw new Error('Invalid token type');
    return decoded;
  } catch {
    throw new Error('Invalid refresh token');
  }
}
