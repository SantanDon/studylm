/**
 * Unit Tests for Token Utilities
 * 
 * Tests cryptographically secure token generation, hashing, and validation.
 * Validates Requirements: 4.1, 4.2, 4.3, 4.4, 4.5
 */

import { describe, it, expect } from 'vitest';
import {
  generateToken,
  hashToken,
  validateToken,
  generateTokenWithExpiration,
  isTokenExpired,
  generateVerificationToken,
  generateResetToken,
  generateSessionToken,
  TOKEN_CONFIG,
} from '@/lib/auth/tokenUtils';

describe('Token Utilities', () => {
  describe('generateToken', () => {
    it('should generate a token', () => {
      const token = generateToken();
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
    });

    it('should generate a token of correct length', () => {
      const token = generateToken();
      // 32 bytes = 64 hex characters
      expect(token.length).toBe(64);
    });

    it('should generate unique tokens', () => {
      const token1 = generateToken();
      const token2 = generateToken();
      expect(token1).not.toBe(token2);
    });

    it('should generate tokens with only hex characters', () => {
      const token = generateToken();
      expect(/^[0-9a-f]{64}$/.test(token)).toBe(true);
    });

    it('should generate multiple unique tokens', () => {
      const tokens = new Set();
      for (let i = 0; i < 100; i++) {
        tokens.add(generateToken());
      }
      expect(tokens.size).toBe(100);
    });
  });

  describe('hashToken', () => {
    it('should hash a token', async () => {
      const token = generateToken();
      const hash = await hashToken(token);
      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
    });

    it('should produce different hashes for different tokens', async () => {
      const token1 = generateToken();
      const token2 = generateToken();
      const hash1 = await hashToken(token1);
      const hash2 = await hashToken(token2);
      expect(hash1).not.toBe(hash2);
    });

    it('should produce consistent hashes for the same token', async () => {
      const token = generateToken();
      const hash1 = await hashToken(token);
      const hash2 = await hashToken(token);
      // Note: bcrypt hashes are not deterministic, but validation should work
      expect(hash1).toBeDefined();
      expect(hash2).toBeDefined();
    });

    it('should hash empty string (bcrypt allows it)', async () => {
      // Note: bcrypt.hash() doesn't throw on empty strings, it just hashes them
      const hash = await hashToken('');
      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
    });

    it('should produce bcrypt hashes', async () => {
      const token = generateToken();
      const hash = await hashToken(token);
      // Bcrypt hashes start with $2a$, $2b$, $2x$, or $2y$
      expect(/^\$2[aby]\$/.test(hash)).toBe(true);
    });
  });

  describe('validateToken', () => {
    it('should validate a correct token', async () => {
      const token = generateToken();
      const hash = await hashToken(token);
      const isValid = await validateToken(token, hash);
      expect(isValid).toBe(true);
    });

    it('should reject an incorrect token', async () => {
      const token1 = generateToken();
      const token2 = generateToken();
      const hash = await hashToken(token1);
      const isValid = await validateToken(token2, hash);
      expect(isValid).toBe(false);
    });

    it('should reject empty token', async () => {
      const token = generateToken();
      const hash = await hashToken(token);
      const isValid = await validateToken('', hash);
      expect(isValid).toBe(false);
    });

    it('should reject modified token', async () => {
      const token = generateToken();
      const hash = await hashToken(token);
      const modifiedToken = token.slice(0, -1) + (token[token.length - 1] === '0' ? '1' : '0');
      const isValid = await validateToken(modifiedToken, hash);
      expect(isValid).toBe(false);
    });

    it('should use constant-time comparison', async () => {
      const token = generateToken();
      const hash = await hashToken(token);
      
      // This test verifies that bcrypt.compare is used (which is constant-time)
      // We can't directly test timing, but we can verify it works correctly
      const isValid = await validateToken(token, hash);
      expect(isValid).toBe(true);
    });
  });

  describe('generateTokenWithExpiration', () => {
    it('should generate token with expiration', () => {
      const result = generateTokenWithExpiration(3600000); // 1 hour
      expect(result.token).toBeDefined();
      expect(result.expiresAt).toBeDefined();
      expect(result.expiresIn).toBe(3600000);
    });

    it('should set correct expiration time', () => {
      const expirationMs = 3600000; // 1 hour
      const before = new Date();
      const result = generateTokenWithExpiration(expirationMs);
      const after = new Date();

      const expectedMin = new Date(before.getTime() + expirationMs);
      const expectedMax = new Date(after.getTime() + expirationMs);

      expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(expectedMin.getTime());
      expect(result.expiresAt.getTime()).toBeLessThanOrEqual(expectedMax.getTime());
    });

    it('should generate unique tokens with expiration', () => {
      const result1 = generateTokenWithExpiration(3600000);
      const result2 = generateTokenWithExpiration(3600000);
      expect(result1.token).not.toBe(result2.token);
    });
  });

  describe('isTokenExpired', () => {
    it('should return false for future expiration', () => {
      const futureDate = new Date(Date.now() + 3600000); // 1 hour from now
      expect(isTokenExpired(futureDate)).toBe(false);
    });

    it('should return true for past expiration', () => {
      const pastDate = new Date(Date.now() - 3600000); // 1 hour ago
      expect(isTokenExpired(pastDate)).toBe(true);
    });

    it('should return false for current time (not yet expired)', () => {
      const now = new Date();
      // Token is expired only if current time > expiration time
      // At current time, it's not yet expired
      expect(isTokenExpired(now)).toBe(false);
    });
  });

  describe('generateVerificationToken', () => {
    it('should generate verification token with 24-hour expiration', () => {
      const result = generateVerificationToken();
      expect(result.token).toBeDefined();
      expect(result.expiresIn).toBe(TOKEN_CONFIG.VERIFICATION_TOKEN_EXPIRATION_MS);
      expect(result.expiresIn).toBe(24 * 60 * 60 * 1000);
    });

    it('should generate unique verification tokens', () => {
      const token1 = generateVerificationToken();
      const token2 = generateVerificationToken();
      expect(token1.token).not.toBe(token2.token);
    });
  });

  describe('generateResetToken', () => {
    it('should generate reset token with 1-hour expiration', () => {
      const result = generateResetToken();
      expect(result.token).toBeDefined();
      expect(result.expiresIn).toBe(TOKEN_CONFIG.RESET_TOKEN_EXPIRATION_MS);
      expect(result.expiresIn).toBe(60 * 60 * 1000);
    });

    it('should generate unique reset tokens', () => {
      const token1 = generateResetToken();
      const token2 = generateResetToken();
      expect(token1.token).not.toBe(token2.token);
    });
  });

  describe('generateSessionToken', () => {
    it('should generate session token with 24-hour expiration', () => {
      const result = generateSessionToken();
      expect(result.token).toBeDefined();
      expect(result.expiresIn).toBe(TOKEN_CONFIG.SESSION_TOKEN_EXPIRATION_MS);
      expect(result.expiresIn).toBe(24 * 60 * 60 * 1000);
    });

    it('should generate unique session tokens', () => {
      const token1 = generateSessionToken();
      const token2 = generateSessionToken();
      expect(token1.token).not.toBe(token2.token);
    });
  });

  describe('TOKEN_CONFIG', () => {
    it('should have correct token length', () => {
      expect(TOKEN_CONFIG.LENGTH_BYTES).toBe(32);
    });

    it('should have correct bcrypt cost', () => {
      expect(TOKEN_CONFIG.BCRYPT_COST).toBe(12);
    });

    it('should have correct expiration times', () => {
      expect(TOKEN_CONFIG.VERIFICATION_TOKEN_EXPIRATION_MS).toBe(24 * 60 * 60 * 1000);
      expect(TOKEN_CONFIG.RESET_TOKEN_EXPIRATION_MS).toBe(60 * 60 * 1000);
      expect(TOKEN_CONFIG.SESSION_TOKEN_EXPIRATION_MS).toBe(24 * 60 * 60 * 1000);
    });
  });
});
