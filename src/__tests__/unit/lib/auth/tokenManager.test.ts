/**
 * Unit Tests for Token Manager
 * 
 * Tests token lifecycle management including creation, validation,
 * expiration, and invalidation.
 * Validates Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TokenManager } from '@/lib/auth/tokenManager';

describe('TokenManager', () => {
  let manager: TokenManager;
  const userId = 'test-user-123';

  beforeEach(() => {
    manager = new TokenManager();
  });

  describe('createToken', () => {
    it('should create a verification token', async () => {
      const result = await manager.createToken(userId, 'verification');
      expect(result).toBeDefined();
      expect(result.token).toBeDefined();
      expect(result.tokenHash).toBeDefined();
      expect(result.userId).toBe(userId);
      expect(result.type).toBe('verification');
      expect(result.used).toBe(false);
    });

    it('should create a reset token', async () => {
      const result = await manager.createToken(userId, 'reset');
      expect(result).toBeDefined();
      expect(result.token).toBeDefined();
      expect(result.type).toBe('reset');
    });

    it('should create a session token', async () => {
      const result = await manager.createToken(userId, 'session');
      expect(result).toBeDefined();
      expect(result.token).toBeDefined();
      expect(result.type).toBe('session');
    });

    it('should generate unique tokens', async () => {
      const token1 = await manager.createToken(userId, 'verification');
      const token2 = await manager.createToken(userId, 'verification');
      expect(token1.token).not.toBe(token2.token);
      expect(token1.tokenHash).not.toBe(token2.tokenHash);
    });

    it('should set correct expiration for verification token', async () => {
      const before = new Date();
      const result = await manager.createToken(userId, 'verification');
      const after = new Date();

      // 24 hours = 86400000 ms
      const expectedMin = new Date(before.getTime() + 24 * 60 * 60 * 1000);
      const expectedMax = new Date(after.getTime() + 24 * 60 * 60 * 1000);

      expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(expectedMin.getTime());
      expect(result.expiresAt.getTime()).toBeLessThanOrEqual(expectedMax.getTime());
    });

    it('should set correct expiration for reset token', async () => {
      const before = new Date();
      const result = await manager.createToken(userId, 'reset');
      const after = new Date();

      // 1 hour = 3600000 ms
      const expectedMin = new Date(before.getTime() + 60 * 60 * 1000);
      const expectedMax = new Date(after.getTime() + 60 * 60 * 1000);

      expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(expectedMin.getTime());
      expect(result.expiresAt.getTime()).toBeLessThanOrEqual(expectedMax.getTime());
    });

    it('should store token in manager', async () => {
      const result = await manager.createToken(userId, 'verification');
      const stored = manager.getToken(result.id);
      expect(stored).toBeDefined();
      expect(stored?.id).toBe(result.id);
    });

    it('should index token by user ID', async () => {
      const result = await manager.createToken(userId, 'verification');
      const userTokens = manager.getUserTokens(userId);
      expect(userTokens.length).toBeGreaterThan(0);
      expect(userTokens.some(t => t.id === result.id)).toBe(true);
    });
  });

  describe('validateToken', () => {
    it('should validate a correct token', async () => {
      const created = await manager.createToken(userId, 'verification');
      const result = await manager.validateToken(created.token);
      expect(result.valid).toBe(true);
      expect(result.token).toBeDefined();
    });

    it('should reject an incorrect token', async () => {
      await manager.createToken(userId, 'verification');
      const result = await manager.validateToken('invalid-token-12345678901234567890123456789012');
      expect(result.valid).toBe(false);
    });

    it('should reject expired token', async () => {
      const created = await manager.createToken(userId, 'verification');
      
      // Manually set expiration to past
      const token = manager.getToken(created.id);
      if (token) {
        token.expiresAt = new Date(Date.now() - 1000);
      }

      const result = await manager.validateToken(created.token);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Token expired');
    });

    it('should reject used verification token', async () => {
      const created = await manager.createToken(userId, 'verification');
      manager.markTokenAsUsed(created.id);

      const result = await manager.validateToken(created.token);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Token already used');
    });

    it('should reject used reset token', async () => {
      const created = await manager.createToken(userId, 'reset');
      manager.markTokenAsUsed(created.id);

      const result = await manager.validateToken(created.token);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Token already used');
    });

    it('should allow reuse of session tokens', async () => {
      const created = await manager.createToken(userId, 'session');
      manager.markTokenAsUsed(created.id);

      const result = await manager.validateToken(created.token);
      expect(result.valid).toBe(true);
    });

    it('should reject invalidated token', async () => {
      const created = await manager.createToken(userId, 'verification');
      manager.invalidateToken(created.id);

      const result = await manager.validateToken(created.token);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Token invalidated');
    });
  });

  describe('markTokenAsUsed', () => {
    it('should mark token as used', async () => {
      const created = await manager.createToken(userId, 'verification');
      const success = manager.markTokenAsUsed(created.id);
      expect(success).toBe(true);

      const token = manager.getToken(created.id);
      expect(token?.used).toBe(true);
      expect(token?.usedAt).toBeDefined();
    });

    it('should return false for non-existent token', () => {
      const success = manager.markTokenAsUsed('non-existent-id');
      expect(success).toBe(false);
    });
  });

  describe('invalidateToken', () => {
    it('should invalidate a token', async () => {
      const created = await manager.createToken(userId, 'verification');
      const success = manager.invalidateToken(created.id);
      expect(success).toBe(true);

      const token = manager.getToken(created.id);
      expect(token?.invalidatedAt).toBeDefined();
    });

    it('should return false for non-existent token', () => {
      const success = manager.invalidateToken('non-existent-id');
      expect(success).toBe(false);
    });
  });

  describe('invalidateUserTokensByType', () => {
    it('should invalidate all tokens of a type for a user', async () => {
      const token1 = await manager.createToken(userId, 'verification');
      const token2 = await manager.createToken(userId, 'verification');
      const token3 = await manager.createToken(userId, 'reset');

      const count = manager.invalidateUserTokensByType(userId, 'verification');
      expect(count).toBe(2);

      const result1 = await manager.validateToken(token1.token);
      const result2 = await manager.validateToken(token2.token);
      const result3 = await manager.validateToken(token3.token);

      expect(result1.valid).toBe(false);
      expect(result2.valid).toBe(false);
      expect(result3.valid).toBe(true);
    });

    it('should return 0 for non-existent user', () => {
      const count = manager.invalidateUserTokensByType('non-existent-user', 'verification');
      expect(count).toBe(0);
    });
  });

  describe('invalidateAllUserTokens', () => {
    it('should invalidate all tokens for a user', async () => {
      const token1 = await manager.createToken(userId, 'verification');
      const token2 = await manager.createToken(userId, 'reset');
      const token3 = await manager.createToken(userId, 'session');

      const count = manager.invalidateAllUserTokens(userId);
      expect(count).toBe(3);

      const result1 = await manager.validateToken(token1.token);
      const result2 = await manager.validateToken(token2.token);
      const result3 = await manager.validateToken(token3.token);

      expect(result1.valid).toBe(false);
      expect(result2.valid).toBe(false);
      expect(result3.valid).toBe(false);
    });

    it('should return 0 for non-existent user', () => {
      const count = manager.invalidateAllUserTokens('non-existent-user');
      expect(count).toBe(0);
    });
  });

  describe('isExpired', () => {
    it('should return false for non-expired token', async () => {
      const created = await manager.createToken(userId, 'verification');
      expect(manager.isExpired(created.id)).toBe(false);
    });

    it('should return true for expired token', async () => {
      const created = await manager.createToken(userId, 'verification');
      
      // Manually set expiration to past
      const token = manager.getToken(created.id);
      if (token) {
        token.expiresAt = new Date(Date.now() - 1000);
      }

      expect(manager.isExpired(created.id)).toBe(true);
    });

    it('should return true for non-existent token', () => {
      expect(manager.isExpired('non-existent-id')).toBe(true);
    });
  });

  describe('getToken', () => {
    it('should get a token by ID', async () => {
      const created = await manager.createToken(userId, 'verification');
      const token = manager.getToken(created.id);
      expect(token).toBeDefined();
      expect(token?.id).toBe(created.id);
    });

    it('should return undefined for non-existent token', () => {
      const token = manager.getToken('non-existent-id');
      expect(token).toBeUndefined();
    });
  });

  describe('getUserTokens', () => {
    it('should get all tokens for a user', async () => {
      const token1 = await manager.createToken(userId, 'verification');
      const token2 = await manager.createToken(userId, 'reset');
      const token3 = await manager.createToken(userId, 'session');

      const tokens = manager.getUserTokens(userId);
      expect(tokens.length).toBe(3);
      expect(tokens.map(t => t.id)).toContain(token1.id);
      expect(tokens.map(t => t.id)).toContain(token2.id);
      expect(tokens.map(t => t.id)).toContain(token3.id);
    });

    it('should return empty array for non-existent user', () => {
      const tokens = manager.getUserTokens('non-existent-user');
      expect(tokens).toEqual([]);
    });
  });

  describe('getActiveUserTokens', () => {
    it('should get only active tokens for a user', async () => {
      const token1 = await manager.createToken(userId, 'verification');
      const token2 = await manager.createToken(userId, 'reset');
      const token3 = await manager.createToken(userId, 'session');

      // Invalidate one token
      manager.invalidateToken(token2.id);

      // Expire one token
      const expiredToken = manager.getToken(token3.id);
      if (expiredToken) {
        expiredToken.expiresAt = new Date(Date.now() - 1000);
      }

      const activeTokens = manager.getActiveUserTokens(userId);
      expect(activeTokens.length).toBe(1);
      expect(activeTokens[0].id).toBe(token1.id);
    });

    it('should return empty array for non-existent user', () => {
      const tokens = manager.getActiveUserTokens('non-existent-user');
      expect(tokens).toEqual([]);
    });
  });

  describe('cleanupExpiredTokens', () => {
    it('should remove expired tokens', async () => {
      const token1 = await manager.createToken(userId, 'verification');
      const token2 = await manager.createToken(userId, 'reset');

      // Expire one token
      const expiredToken = manager.getToken(token1.id);
      if (expiredToken) {
        expiredToken.expiresAt = new Date(Date.now() - 1000);
      }

      const count = manager.cleanupExpiredTokens();
      expect(count).toBe(1);

      const token1After = manager.getToken(token1.id);
      const token2After = manager.getToken(token2.id);

      expect(token1After).toBeUndefined();
      expect(token2After).toBeDefined();
    });

    it('should return 0 if no expired tokens', async () => {
      await manager.createToken(userId, 'verification');
      const count = manager.cleanupExpiredTokens();
      expect(count).toBe(0);
    });
  });

  describe('Integration scenarios', () => {
    it('should handle complete verification flow', async () => {
      // Create token
      const created = await manager.createToken(userId, 'verification');
      expect(created.token).toBeDefined();

      // Validate token
      let result = await manager.validateToken(created.token);
      expect(result.valid).toBe(true);

      // Mark as used
      manager.markTokenAsUsed(created.id);

      // Try to use again
      result = await manager.validateToken(created.token);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Token already used');
    });

    it('should handle token replacement', async () => {
      // Create first token
      const token1 = await manager.createToken(userId, 'verification');

      // Invalidate old token and create new one
      manager.invalidateUserTokensByType(userId, 'verification');
      const token2 = await manager.createToken(userId, 'verification');

      // Old token should be invalid
      let result = await manager.validateToken(token1.token);
      expect(result.valid).toBe(false);

      // New token should be valid
      result = await manager.validateToken(token2.token);
      expect(result.valid).toBe(true);
    });

    it('should handle multiple users', async () => {
      const user1 = 'user-1';
      const user2 = 'user-2';

      const token1 = await manager.createToken(user1, 'verification');
      const token2 = await manager.createToken(user2, 'verification');

      // Invalidate user1 tokens
      manager.invalidateAllUserTokens(user1);

      // User1 token should be invalid
      let result = await manager.validateToken(token1.token);
      expect(result.valid).toBe(false);

      // User2 token should still be valid
      result = await manager.validateToken(token2.token);
      expect(result.valid).toBe(true);
    });
  });
});
