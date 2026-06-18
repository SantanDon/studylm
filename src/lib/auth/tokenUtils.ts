/**
 * Token Utilities for Authentication System
 * 
 * Provides cryptographically secure token generation, hashing, and validation.
 * Implements bcrypt-based token hashing for secure storage.
 * 
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5
 */

import bcrypt from 'bcryptjs';

/**
 * Token configuration constants
 */
export const TOKEN_CONFIG = {
  // Token length in bytes (32 bytes = 256 bits for strong security)
  LENGTH_BYTES: 32,
  // Bcrypt cost factor for token hashing (12 is recommended for security)
  BCRYPT_COST: 12,
  // Default expiration times
  VERIFICATION_TOKEN_EXPIRATION_MS: 24 * 60 * 60 * 1000, // 24 hours
  RESET_TOKEN_EXPIRATION_MS: 60 * 60 * 1000, // 1 hour
  SESSION_TOKEN_EXPIRATION_MS: 24 * 60 * 60 * 1000, // 24 hours
};

/**
 * Token with expiration metadata
 */
export interface TokenWithExpiration {
  token: string;
  expiresAt: Date;
  expiresIn: number; // milliseconds
}

/**
 * Generates a cryptographically secure random token
 * 
 * Uses crypto.randomBytes() for secure random generation.
 * Returns a hex-encoded string of 64 characters (32 bytes).
 * 
 * **Validates: Requirements 4.1, 4.2, 4.3**
 * 
 * @returns A cryptographically secure random token string
 * @throws Error if crypto.randomBytes is not available
 */
export function generateToken(): string {
  try {
    // Generate 32 bytes of cryptographically secure random data
    const randomBytes = crypto.getRandomValues(new Uint8Array(TOKEN_CONFIG.LENGTH_BYTES));
    
    // Convert to hex string
    const token = Array.from(randomBytes)
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('');
    
    return token;
  } catch {
    throw new Error('Failed to generate secure token: crypto.randomBytes not available');
  }
}

/**
 * Hashes a token using bcrypt for secure storage
 * 
 * Uses bcrypt with cost factor 12 for strong security.
 * The hash is deterministic for the same token, allowing validation.
 * 
 * **Validates: Requirements 4.4**
 * 
 * @param token - The plaintext token to hash
 * @returns Promise resolving to the bcrypt hash
 * @throws Error if hashing fails
 */
export async function hashToken(token: string): Promise<string> {
  try {
    // Hash the token using bcrypt with cost factor 12
    const hash = await bcrypt.hash(token, TOKEN_CONFIG.BCRYPT_COST);
    return hash;
  } catch (error) {
    throw new Error(`Failed to hash token: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Validates a token against its hash using bcrypt comparison
 * 
 * Uses bcrypt.compare() for constant-time comparison to prevent timing attacks.
 * Returns true only if the token matches the hash.
 * 
 * **Validates: Requirements 4.5**
 * 
 * @param token - The plaintext token to validate
 * @param hash - The bcrypt hash to compare against
 * @returns Promise resolving to true if token matches hash, false otherwise
 * @throws Error if comparison fails
 */
export async function validateToken(token: string, hash: string): Promise<boolean> {
  try {
    // Use bcrypt.compare for constant-time comparison
    const isValid = await bcrypt.compare(token, hash);
    return isValid;
  } catch (error) {
    throw new Error(`Failed to validate token: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Generates a token with expiration time
 * 
 * Creates a new token and calculates its expiration time.
 * 
 * @param expirationMs - Expiration time in milliseconds from now
 * @returns Object containing token, expiresAt date, and expiresIn milliseconds
 */
export function generateTokenWithExpiration(expirationMs: number): TokenWithExpiration {
  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expirationMs);
  
  return {
    token,
    expiresAt,
    expiresIn: expirationMs,
  };
}

/**
 * Checks if a token has expired
 * 
 * @param expiresAt - The expiration date of the token
 * @returns true if token has expired, false otherwise
 */
export function isTokenExpired(expiresAt: Date): boolean {
  return new Date() > expiresAt;
}

/**
 * Generates a verification token with 24-hour expiration
 * 
 * @returns Token with expiration metadata
 */
export function generateVerificationToken(): TokenWithExpiration {
  return generateTokenWithExpiration(TOKEN_CONFIG.VERIFICATION_TOKEN_EXPIRATION_MS);
}

/**
 * Generates a password reset token with 1-hour expiration
 * 
 * @returns Token with expiration metadata
 */
export function generateResetToken(): TokenWithExpiration {
  return generateTokenWithExpiration(TOKEN_CONFIG.RESET_TOKEN_EXPIRATION_MS);
}

/**
 * Generates a session token with 24-hour expiration
 * 
 * @returns Token with expiration metadata
 */
export function generateSessionToken(): TokenWithExpiration {
  return generateTokenWithExpiration(TOKEN_CONFIG.SESSION_TOKEN_EXPIRATION_MS);
}
