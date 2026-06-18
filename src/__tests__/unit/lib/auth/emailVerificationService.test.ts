/**
 * Unit Tests for EmailVerificationService
 * 
 * Tests email verification token generation, email sending,
 * email verification, and resend logic.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { emailVerificationService } from '@/lib/auth/emailVerificationService';
import { localStorageService } from '@/services/localStorageService';

describe('EmailVerificationService', () => {
  const testUserId = 'test-user-123';
  const testEmail = 'test@example.com';

  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
    
    // Create a test user
    const testUser = {
      id: testUserId,
      email: testEmail,
      created_at: new Date().toISOString(),
    };
    
    localStorage.setItem('users', JSON.stringify([testUser]));
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('generateVerificationToken', () => {
    it('should generate a unique verification token', async () => {
      const token1 = await emailVerificationService.generateVerificationToken(testUserId);
      const token2 = await emailVerificationService.generateVerificationToken(testUserId);
      
      expect(token1).toBeDefined();
      expect(token2).toBeDefined();
      expect(token1).not.toBe(token2);
    });

    it('should generate a token with 64 characters (32 bytes hex)', async () => {
      const token = await emailVerificationService.generateVerificationToken(testUserId);
      
      expect(token).toHaveLength(64);
      expect(/^[a-f0-9]{64}$/.test(token)).toBe(true);
    });

    it('should store token in localStorage', async () => {
      await emailVerificationService.generateVerificationToken(testUserId);
      
      const storedTokens = localStorageService.getVerificationTokens();
      expect(storedTokens).toHaveLength(1);
      expect(storedTokens[0].userId).toBe(testUserId);
    });

    it('should set token expiration to 24 hours', async () => {
      const beforeTime = Date.now();
      await emailVerificationService.generateVerificationToken(testUserId);
      
      const storedTokens = localStorageService.getVerificationTokens();
      const expiresAt = new Date(storedTokens[0].expiresAt).getTime();
      
      // Should expire in approximately 24 hours (86400000 ms)
      const expirationTime = expiresAt - beforeTime;
      expect(expirationTime).toBeGreaterThan(24 * 60 * 60 * 1000 - 1000); // Allow 1 second margin
      expect(expirationTime).toBeLessThan(24 * 60 * 60 * 1000 + 1000);
    });

    it('should not store plaintext token in localStorage', async () => {
      const token = await emailVerificationService.generateVerificationToken(testUserId);
      
      const storedTokens = localStorageService.getVerificationTokens();
      expect(storedTokens[0].tokenHash).not.toBe(token);
      expect(storedTokens[0].tokenHash).toMatch(/^\$2[aby]\$/); // bcrypt hash format
    });
  });

  describe('sendVerificationEmail', () => {
    it('should log email to console', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      const token = 'test-token-123';
      
      await emailVerificationService.sendVerificationEmail(testEmail, token);
      
      expect(consoleSpy).toHaveBeenCalledWith('📧 Verification Email Sent:');
      expect(consoleSpy).toHaveBeenCalledWith('To:', testEmail);
      expect(consoleSpy).toHaveBeenCalledWith('Token:', token);
      
      consoleSpy.mockRestore();
    });

    it('should include verification link in email', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      const token = 'test-token-123';
      
      await emailVerificationService.sendVerificationEmail(testEmail, token);
      
      const calls = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      expect(calls).toContain(`/verify-email?token=${token}`);
      
      consoleSpy.mockRestore();
    });

    it('should include email address in template', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      const token = 'test-token-123';
      
      await emailVerificationService.sendVerificationEmail(testEmail, token);
      
      const calls = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      expect(calls).toContain(`Hello ${testEmail}`);
      
      consoleSpy.mockRestore();
    });

    it('should include 24-hour expiration notice', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      const token = 'test-token-123';
      
      await emailVerificationService.sendVerificationEmail(testEmail, token);
      
      const calls = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      expect(calls).toContain('24 hours');
      
      consoleSpy.mockRestore();
    });
  });

  describe('verifyEmail', () => {
    it('should verify email with valid token', async () => {
      const token = await emailVerificationService.generateVerificationToken(testUserId);
      
      const result = await emailVerificationService.verifyEmail(token);
      
      expect(result.success).toBe(true);
      expect(result.message).toContain('successfully');
      expect(result.userId).toBe(testUserId);
      expect(result.canSignIn).toBe(true);
    });

    it('should mark token as used after verification', async () => {
      const token = await emailVerificationService.generateVerificationToken(testUserId);
      
      await emailVerificationService.verifyEmail(token);
      
      const storedTokens = localStorageService.getVerificationTokens();
      expect(storedTokens[0].used).toBe(true);
      expect(storedTokens[0].usedAt).toBeDefined();
    });

    it('should update user emailVerified status', async () => {
      const token = await emailVerificationService.generateVerificationToken(testUserId);
      
      await emailVerificationService.verifyEmail(token);
      
      const users = localStorageService.getUsers();
      const user = users.find(u => u.id === testUserId);
      expect((user as { emailVerified?: boolean }).emailVerified).toBe(true);
    });

    it('should reject invalid token', async () => {
      const result = await emailVerificationService.verifyEmail('invalid-token-123');
      
      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid or expired');
      expect(result.canSignIn).toBe(false);
    });

    it('should reject expired token', async () => {
      // Generate a token and manually expire it
      const token = await emailVerificationService.generateVerificationToken(testUserId);
      const storedTokens = localStorageService.getVerificationTokens();
      
      // Set expiration to past
      localStorageService.updateVerificationToken(storedTokens[0].id, {
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      });
      
      const result = await emailVerificationService.verifyEmail(token);
      
      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid or expired');
      expect(result.canSignIn).toBe(false);
    });

    it('should reject already-used token', async () => {
      const token = await emailVerificationService.generateVerificationToken(testUserId);
      
      // First verification should succeed
      const result1 = await emailVerificationService.verifyEmail(token);
      expect(result1.success).toBe(true);
      
      // Second verification should fail
      const result2 = await emailVerificationService.verifyEmail(token);
      expect(result2.success).toBe(false);
      expect(result2.message).toContain('Invalid or expired');
    });

    it('should handle non-existent user gracefully', async () => {
      // Create token for non-existent user
      const token = await emailVerificationService.generateVerificationToken('non-existent-user');
      
      // Manually remove the user
      localStorage.setItem('users', JSON.stringify([]));
      
      const result = await emailVerificationService.verifyEmail(token);
      
      expect(result.success).toBe(false);
      expect(result.canSignIn).toBe(false);
    });
  });

  describe('resendVerificationEmail', () => {
    it('should generate new token on resend', async () => {
      await emailVerificationService.generateVerificationToken(testUserId);
      
      await emailVerificationService.resendVerificationEmail(testEmail);
      
      const storedTokens = localStorageService.getVerificationTokens();
      const newToken = storedTokens.find(t => !t.invalidatedAt && !t.used);
      
      expect(newToken).toBeDefined();
      expect(newToken?.id).not.toBe(storedTokens[0].id);
    });

    it('should invalidate old token on resend', async () => {
      await emailVerificationService.generateVerificationToken(testUserId);
      
      await emailVerificationService.resendVerificationEmail(testEmail);
      
      const storedTokens = localStorageService.getVerificationTokens();
      const oldToken = storedTokens.find(t => t.id === storedTokens[0].id);
      
      expect(oldToken?.invalidatedAt).toBeDefined();
    });

    it('should send new email on resend', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      
      await emailVerificationService.generateVerificationToken(testUserId);
      await emailVerificationService.resendVerificationEmail(testEmail);
      
      // Should have logged email sending
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('📧 Verification Email Sent'));
      
      consoleSpy.mockRestore();
    });

    it('should not resend if email already verified', async () => {
      // Mark user as verified
      const users = localStorageService.getUsers();
      users[0] = { ...users[0], emailVerified: true };
      localStorage.setItem('users', JSON.stringify(users));
      
      const consoleSpy = vi.spyOn(console, 'log');
      
      await emailVerificationService.resendVerificationEmail(testEmail);
      
      // Should log that email is already verified
      expect(consoleSpy).toHaveBeenCalledWith('Email already verified:', testEmail);
      
      consoleSpy.mockRestore();
    });

    it('should handle non-existent email gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      
      await emailVerificationService.resendVerificationEmail('non-existent@example.com');
      
      // Should log that user not found (but not reveal it)
      expect(consoleSpy).toHaveBeenCalledWith('User not found for email:', 'non-existent@example.com');
      
      consoleSpy.mockRestore();
    });
  });

  describe('isEmailVerified', () => {
    it('should return false for unverified email', async () => {
      const verified = await emailVerificationService.isEmailVerified(testUserId);
      
      expect(verified).toBe(false);
    });

    it('should return true for verified email', async () => {
      const token = await emailVerificationService.generateVerificationToken(testUserId);
      await emailVerificationService.verifyEmail(token);
      
      const verified = await emailVerificationService.isEmailVerified(testUserId);
      
      expect(verified).toBe(true);
    });

    it('should return false for non-existent user', async () => {
      const verified = await emailVerificationService.isEmailVerified('non-existent-user');
      
      expect(verified).toBe(false);
    });
  });

  describe('getVerificationStatus', () => {
    it('should return unverified status for new user', async () => {
      const status = await emailVerificationService.getVerificationStatus(testUserId);
      
      expect(status.verified).toBe(false);
      expect(status.email).toBe(testEmail);
    });

    it('should return verified status after verification', async () => {
      const token = await emailVerificationService.generateVerificationToken(testUserId);
      await emailVerificationService.verifyEmail(token);
      
      const status = await emailVerificationService.getVerificationStatus(testUserId);
      
      expect(status.verified).toBe(true);
      expect(status.email).toBe(testEmail);
    });

    it('should include token expiry for unverified users', async () => {
      await emailVerificationService.generateVerificationToken(testUserId);
      
      const status = await emailVerificationService.getVerificationStatus(testUserId);
      
      expect(status.verificationTokenExpiry).toBeDefined();
      expect(status.verificationTokenExpiry).toBeInstanceOf(Date);
    });

    it('should not include token expiry for verified users', async () => {
      const token = await emailVerificationService.generateVerificationToken(testUserId);
      await emailVerificationService.verifyEmail(token);
      
      const status = await emailVerificationService.getVerificationStatus(testUserId);
      
      expect(status.verificationTokenExpiry).toBeUndefined();
    });

    it('should return empty status for non-existent user', async () => {
      const status = await emailVerificationService.getVerificationStatus('non-existent-user');
      
      expect(status.verified).toBe(false);
      expect(status.email).toBeUndefined();
    });
  });

  describe('validateVerificationToken', () => {
    it('should validate valid token', async () => {
      const token = await emailVerificationService.generateVerificationToken(testUserId);
      
      const isValid = await emailVerificationService.validateVerificationToken(token);
      
      expect(isValid).toBe(true);
    });

    it('should reject invalid token', async () => {
      const isValid = await emailVerificationService.validateVerificationToken('invalid-token');
      
      expect(isValid).toBe(false);
    });

    it('should reject expired token', async () => {
      const token = await emailVerificationService.generateVerificationToken(testUserId);
      const storedTokens = localStorageService.getVerificationTokens();
      
      // Expire the token
      localStorageService.updateVerificationToken(storedTokens[0].id, {
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      });
      
      const isValid = await emailVerificationService.validateVerificationToken(token);
      
      expect(isValid).toBe(false);
    });

    it('should reject used token', async () => {
      const token = await emailVerificationService.generateVerificationToken(testUserId);
      
      // Use the token
      await emailVerificationService.verifyEmail(token);
      
      // Try to validate again
      const isValid = await emailVerificationService.validateVerificationToken(token);
      
      expect(isValid).toBe(false);
    });
  });

  describe('invalidateVerificationToken', () => {
    it('should invalidate a token', async () => {
      await emailVerificationService.generateVerificationToken(testUserId);
      const storedTokens = localStorageService.getVerificationTokens();
      const tokenId = storedTokens[0].id;
      
      const result = emailVerificationService.invalidateVerificationToken(tokenId);
      
      expect(result).toBe(true);
      
      const updatedTokens = localStorageService.getVerificationTokens();
      expect(updatedTokens[0].invalidatedAt).toBeDefined();
    });

    it('should return false for non-existent token', async () => {
      const result = emailVerificationService.invalidateVerificationToken('non-existent-id');
      
      expect(result).toBe(false);
    });
  });

  describe('invalidateAllVerificationTokens', () => {
    it('should invalidate all tokens for a user', async () => {
      await emailVerificationService.generateVerificationToken(testUserId);
      await emailVerificationService.generateVerificationToken(testUserId);
      
      const count = emailVerificationService.invalidateAllVerificationTokens(testUserId);
      
      expect(count).toBe(2);
      
      const storedTokens = localStorageService.getVerificationTokens();
      expect(storedTokens.every(t => t.invalidatedAt)).toBe(true);
    });

    it('should return 0 for user with no tokens', async () => {
      const count = emailVerificationService.invalidateAllVerificationTokens('user-with-no-tokens');
      
      expect(count).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle multiple verification attempts gracefully', async () => {
      const token = await emailVerificationService.generateVerificationToken(testUserId);
      
      const result1 = await emailVerificationService.verifyEmail(token);
      const result2 = await emailVerificationService.verifyEmail(token);
      const result3 = await emailVerificationService.verifyEmail(token);
      
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(false);
      expect(result3.success).toBe(false);
    });

    it('should handle concurrent token generation', async () => {
      const tokens = await Promise.all([
        emailVerificationService.generateVerificationToken(testUserId),
        emailVerificationService.generateVerificationToken(testUserId),
        emailVerificationService.generateVerificationToken(testUserId),
      ]);
      
      // All tokens should be unique
      const uniqueTokens = new Set(tokens);
      expect(uniqueTokens.size).toBe(3);
    });

    it('should handle token validation after expiration', async () => {
      const token = await emailVerificationService.generateVerificationToken(testUserId);
      const storedTokens = localStorageService.getVerificationTokens();
      
      // Manually expire the token
      localStorageService.updateVerificationToken(storedTokens[0].id, {
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      });
      
      const result = await emailVerificationService.verifyEmail(token);
      
      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid or expired');
    });
  });
});
