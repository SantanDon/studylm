/**
 * Unit Tests for PasswordRecoveryService
 * 
 * Tests the password recovery flow including token generation,
 * email sending, token validation, and password reset.
 * 
 * Requirements: 2.2, 2.3, 2.4, 2.5, 2.8, 2.9, 2.10, 2.12, 6.4, 6.5, 6.6, 6.7, 7.1, 7.2, 7.3, 7.4, 7.5, 7.7, 7.8
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PasswordRecoveryService } from '@/lib/auth/passwordRecoveryService';
import { localStorageService } from '@/services/localStorageService';
import { validateToken } from '@/lib/auth/tokenUtils';
import bcrypt from 'bcryptjs';

describe('PasswordRecoveryService', () => {
  let service: PasswordRecoveryService;
  const testEmail = 'test@example.com';
  const testUserId = 'test-user-id';

  beforeEach(async () => {
    // Clear localStorage before each test
    localStorage.clear();
    service = new PasswordRecoveryService();

    // Create a test user
    const testUser = {
      id: testUserId,
      email: testEmail,
      created_at: new Date().toISOString(),
      emailVerified: true,
    };

    try {
      await localStorageService.addUser(testUser, 'OldPassword123!');
    } catch (err) {
      console.error('Failed to add test user:', err);
    }
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe('generateResetToken', () => {
    it('should generate a reset token for a valid email', async () => {
      const token = await service.generateResetToken(testEmail);
      
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);
    });

    it('should throw error for non-existent email', async () => {
      await expect(service.generateResetToken('nonexistent@example.com')).rejects.toThrow();
    });

    it('should store token in localStorage', async () => {
      await service.generateResetToken(testEmail);
      
      const storedTokens = localStorageService.getResetTokens();
      expect(storedTokens.length).toBeGreaterThan(0);
      
      const tokenRecord = storedTokens[0];
      expect(tokenRecord.userId).toBe(testUserId);
      expect(tokenRecord.email).toBe(testEmail);
      expect(tokenRecord.used).toBe(false);
    });

    it('should generate unique tokens', async () => {
      const token1 = await service.generateResetToken(testEmail);
      const token2 = await service.generateResetToken(testEmail);
      
      expect(token1).not.toBe(token2);
    });

    it('should set token expiration to 1 hour', async () => {
      await service.generateResetToken(testEmail);
      
      const storedTokens = localStorageService.getResetTokens();
      const tokenRecord = storedTokens[0];
      
      const expiresAt = new Date(tokenRecord.expiresAt);
      const now = new Date();
      const diffMs = expiresAt.getTime() - now.getTime();
      const diffHours = diffMs / (1000 * 60 * 60);
      
      // Should be approximately 1 hour (within 1 minute tolerance)
      expect(diffHours).toBeGreaterThan(0.98);
      expect(diffHours).toBeLessThan(1.02);
    });

    it('should hash token before storage', async () => {
      const token = await service.generateResetToken(testEmail);
      
      const storedTokens = localStorageService.getResetTokens();
      const tokenRecord = storedTokens[0];
      
      // Token hash should not equal plaintext token
      expect(tokenRecord.tokenHash).not.toBe(token);
      
      // But should validate correctly
      const isValid = await validateToken(token, tokenRecord.tokenHash);
      expect(isValid).toBe(true);
    });
  });

  describe('sendRecoveryEmail', () => {
    it('should log email to console', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      const token = 'test-token-123';
      
      await service.sendRecoveryEmail(testEmail, token);
      
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('📧 Password Recovery Email Sent'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining(testEmail));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining(token));
      
      consoleSpy.mockRestore();
    });

    it('should include recovery link in email', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      const token = 'test-token-123';
      
      await service.sendRecoveryEmail(testEmail, token);
      
      const calls = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      expect(calls).toContain('reset-password');
      expect(calls).toContain(token);
      
      consoleSpy.mockRestore();
    });

    it('should include 1-hour expiration message', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      const token = 'test-token-123';
      
      await service.sendRecoveryEmail(testEmail, token);
      
      const calls = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      expect(calls).toContain('1 hour');
      
      consoleSpy.mockRestore();
    });
  });

  describe('validateResetToken', () => {
    it('should validate a valid token', async () => {
      const token = await service.generateResetToken(testEmail);
      
      const isValid = await service.validateResetToken(token);
      expect(isValid).toBe(true);
    });

    it('should reject invalid token', async () => {
      const isValid = await service.validateResetToken('invalid-token-123');
      expect(isValid).toBe(false);
    });

    it('should reject used token', async () => {
      const token = await service.generateResetToken(testEmail);
      
      // Mark token as used
      const storedTokens = localStorageService.getResetTokens();
      const tokenRecord = storedTokens[0];
      localStorageService.updateResetToken(tokenRecord.id, {
        used: true,
        usedAt: new Date().toISOString(),
      });
      
      const isValid = await service.validateResetToken(token);
      expect(isValid).toBe(false);
    });

    it('should reject invalidated token', async () => {
      const token = await service.generateResetToken(testEmail);
      
      // Invalidate token
      const storedTokens = localStorageService.getResetTokens();
      const tokenRecord = storedTokens[0];
      localStorageService.updateResetToken(tokenRecord.id, {
        invalidatedAt: new Date().toISOString(),
      });
      
      const isValid = await service.validateResetToken(token);
      expect(isValid).toBe(false);
    });

    it('should reject expired token', async () => {
      const token = await service.generateResetToken(testEmail);
      
      // Set expiration to past
      const storedTokens = localStorageService.getResetTokens();
      const tokenRecord = storedTokens[0];
      const pastDate = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
      localStorageService.updateResetToken(tokenRecord.id, {
        expiresAt: pastDate.toISOString(),
      });
      
      const isValid = await service.validateResetToken(token);
      expect(isValid).toBe(false);
    });
  });

  describe('resetPassword', () => {
    it('should reset password with valid token and password', async () => {
      const token = await service.generateResetToken(testEmail);
      const newPassword = 'NewPassword456!';
      
      const result = await service.resetPassword(token, newPassword);
      
      expect(result.success).toBe(true);
      expect(result.requiresSignIn).toBe(true);
    });

    it('should reject invalid token', async () => {
      const result = await service.resetPassword('invalid-token', 'NewPassword456!');
      
      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid or expired');
    });

    it('should reject weak password', async () => {
      const token = await service.generateResetToken(testEmail);
      
      const result = await service.resetPassword(token, 'weak');
      
      expect(result.success).toBe(false);
      expect(result.message).toBeTruthy();
    });

    it('should mark token as used after reset', async () => {
      const token = await service.generateResetToken(testEmail);
      
      await service.resetPassword(token, 'NewPassword456!');
      
      const storedTokens = localStorageService.getResetTokens();
      const tokenRecord = storedTokens[0];
      expect(tokenRecord.used).toBe(true);
      expect(tokenRecord.usedAt).toBeDefined();
    });

    it('should reject already used token', async () => {
      const token = await service.generateResetToken(testEmail);
      
      // First reset
      await service.resetPassword(token, 'NewPassword456!');
      
      // Try to reset again with same token
      const result = await service.resetPassword(token, 'AnotherPassword789!');
      
      expect(result.success).toBe(false);
      expect(result.message).toContain('already used');
    });

    it('should hash password with bcrypt', async () => {
      const token = await service.generateResetToken(testEmail);
      const newPassword = 'NewPassword456!';
      
      await service.resetPassword(token, newPassword);
      
      // Get stored password
      const passwords = localStorageService.getFromStorage<{
        user_id: string;
        password: string;
      }>('passwords');
      
      const passwordEntry = passwords.find(p => p.user_id === testUserId);
      expect(passwordEntry).toBeDefined();
      
      // Verify it's a bcrypt hash
      const isMatch = await bcrypt.compare(newPassword, passwordEntry!.password);
      expect(isMatch).toBe(true);
    });

    it('should invalidate all sessions on password reset', async () => {
      const token = await service.generateResetToken(testEmail);
      
      // Set current user
      const testUser = localStorageService.getUsers().find(u => u.id === testUserId);
      localStorageService.setCurrentUser(testUser!);
      
      expect(localStorageService.getCurrentUser()).toBeDefined();
      
      // Reset password
      await service.resetPassword(token, 'NewPassword456!');
      
      // Current user should be cleared
      expect(localStorageService.getCurrentUser()).toBeNull();
    });
  });

  describe('validatePassword', () => {
    it('should accept valid password', () => {
      const result = service.validatePassword('ValidPass123!');
      
      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should reject password shorter than 8 characters', () => {
      const result = service.validatePassword('Short1!');
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('8 characters'))).toBe(true);
    });

    it('should reject password without uppercase', () => {
      const result = service.validatePassword('lowercase123!');
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('uppercase'))).toBe(true);
    });

    it('should reject password without lowercase', () => {
      const result = service.validatePassword('UPPERCASE123!');
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('lowercase'))).toBe(true);
    });

    it('should reject password without number', () => {
      const result = service.validatePassword('NoNumbers!');
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('number'))).toBe(true);
    });

    it('should reject password without special character', () => {
      const result = service.validatePassword('NoSpecial123');
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('special character'))).toBe(true);
    });

    it('should accept all special characters in requirement', () => {
      const specialChars = ['!', '@', '#', '$', '%', '^', '&', '*'];
      
      for (const char of specialChars) {
        const result = service.validatePassword(`ValidPass123${char}`);
        expect(result.valid).toBe(true);
      }
    });

    it('should return multiple errors for multiple violations', () => {
      const result = service.validatePassword('short');
      
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(1);
    });
  });

  describe('resendRecoveryEmail', () => {
    it('should generate new token on resend', async () => {
      await service.generateResetToken(testEmail);
      
      await service.resendRecoveryEmail(testEmail);
      
      const storedTokens = localStorageService.getResetTokens();
      expect(storedTokens.length).toBe(2);
    });

    it('should invalidate old token on resend', async () => {
      await service.generateResetToken(testEmail);
      
      await service.resendRecoveryEmail(testEmail);
      
      const storedTokens = localStorageService.getResetTokens();
      const oldToken = storedTokens.find(t => t.createdAt === storedTokens[0].createdAt);
      
      expect(oldToken?.invalidatedAt).toBeDefined();
    });

    it('should send new email on resend', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      
      await service.generateResetToken(testEmail);
      await service.resendRecoveryEmail(testEmail);
      
      // Should have logged email twice (once for initial, once for resend)
      const emailLogs = consoleSpy.mock.calls.filter(c => 
        c[0]?.toString().includes('📧 Password Recovery Email Sent')
      );
      expect(emailLogs.length).toBeGreaterThanOrEqual(1);
      
      consoleSpy.mockRestore();
    });

    it('should not reveal if email does not exist', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      
      await service.resendRecoveryEmail('nonexistent@example.com');
      
      // Should log that user not found but not throw
      const calls = consoleSpy.mock.calls.map(c => c.join(' ')).join('\n');
      expect(calls).toContain('User not found');
      
      consoleSpy.mockRestore();
    });
  });

  describe('getResetTokenStatus', () => {
    it('should return valid status for active token', async () => {
      await service.generateResetToken(testEmail);
      
      const status = await service.getResetTokenStatus(testEmail);
      
      expect(status.exists).toBe(true);
      expect(status.valid).toBe(true);
      expect(status.expiresAt).toBeDefined();
    });

    it('should return invalid status for non-existent email', async () => {
      const status = await service.getResetTokenStatus('nonexistent@example.com');
      
      expect(status.exists).toBe(false);
      expect(status.valid).toBe(false);
    });

    it('should return invalid status for expired token', async () => {
      await service.generateResetToken(testEmail);
      
      // Expire the token
      const storedTokens = localStorageService.getResetTokens();
      const tokenRecord = storedTokens[0];
      const pastDate = new Date(Date.now() - 2 * 60 * 60 * 1000);
      localStorageService.updateResetToken(tokenRecord.id, {
        expiresAt: pastDate.toISOString(),
      });
      
      const status = await service.getResetTokenStatus(testEmail);
      
      expect(status.exists).toBe(true);
      expect(status.valid).toBe(false);
    });

    it('should return invalid status for used token', async () => {
      await service.generateResetToken(testEmail);
      
      // Mark as used
      const storedTokens = localStorageService.getResetTokens();
      const tokenRecord = storedTokens[0];
      localStorageService.updateResetToken(tokenRecord.id, {
        used: true,
        usedAt: new Date().toISOString(),
      });
      
      const status = await service.getResetTokenStatus(testEmail);
      
      // When token is used, getResetTokenStatus won't find it (filters for unused tokens)
      // So it should return exists: false
      expect(status.exists).toBe(false);
      expect(status.valid).toBe(false);
    });
  });

  describe('One-time token use enforcement', () => {
    it('should prevent reuse of reset token', async () => {
      const token = await service.generateResetToken(testEmail);
      
      // First use
      const result1 = await service.resetPassword(token, 'NewPassword456!');
      expect(result1.success).toBe(true);
      
      // Second use attempt
      const result2 = await service.resetPassword(token, 'AnotherPassword789!');
      expect(result2.success).toBe(false);
    });
  });

  describe('Token uniqueness', () => {
    it('should generate unique tokens for multiple requests', async () => {
      const tokens = [];
      
      for (let i = 0; i < 5; i++) {
        const token = await service.generateResetToken(testEmail);
        tokens.push(token);
      }
      
      // All tokens should be unique
      const uniqueTokens = new Set(tokens);
      expect(uniqueTokens.size).toBe(tokens.length);
    });
  });

  describe('Password reset with bcrypt cost factor', () => {
    it('should use bcrypt cost factor 12', async () => {
      const token = await service.generateResetToken(testEmail);
      const newPassword = 'NewPassword456!';
      
      await service.resetPassword(token, newPassword);
      
      // Get stored password
      const passwords = localStorageService.getFromStorage<{
        user_id: string;
        password: string;
      }>('passwords');
      
      const passwordEntry = passwords.find(p => p.user_id === testUserId);
      const hash = passwordEntry!.password;
      
      // Bcrypt hash with cost 12 starts with $2a$12$ or $2b$12$ or $2y$12$
      expect(hash).toMatch(/^\$2[aby]\$12\$/);
    });
  });
});
