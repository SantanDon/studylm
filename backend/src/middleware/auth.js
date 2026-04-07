import jwt from 'jsonwebtoken';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { dbHelpers, getDatabase } from '../db/database.js';

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.warn('⚠️ [AUTH] JWT_SECRET is not set. Token verification will fail, but the server is booting...');
}

export function hashApiKey(rawKey) {
  return createHash('sha256').update(rawKey).digest('hex');
}

export async function authenticateToken(req, res, next) {
   const authHeader = req.headers['authorization'];
   const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
 
   // ZERO-FRICTION DEV BYPASS:
   // If running in development and requested via localhost, auto-login the primary user.
   if (process.env.DEV_AUTO_LOGIN === 'true' && (req.hostname === 'localhost' || req.hostname === '127.0.0.1')) {
     console.log('🛡️ [AUTH] Zero-Friction Dev Bypass active. Auto-login for localhost...');
     // Attempt to get the first human user in the system (typically the developer)
     try {
        const db = await getDatabase();
        const result = await db.execute('SELECT id, email, display_name FROM users ORDER BY created_at ASC LIMIT 1');
        const primaryUser = result.rows[0];
        
        if (primaryUser) {
          req.user = { userId: primaryUser.id, email: primaryUser.email, displayName: primaryUser.display_name };
          return next();
        } else {
          // Fallback if no users exist yet
          req.user = { userId: 'dev-zero-friction', email: 'dev@studypod.local', displayName: 'Local Developer' };
          return next();
        }
     } catch (dbError) {
        console.warn('⚠️ [AUTH] Zero-Friction Bypass failed to query DB (Providing Mock User):', dbError.message);
        req.user = { userId: 'dev-zero-friction', email: 'dev@studypod.local', displayName: 'Local Developer' };
        return next();
     }
   }

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
