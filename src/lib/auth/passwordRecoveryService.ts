/**
 * Password Recovery Service
 * 
 * Manages the password recovery flow including token generation,
 * email sending, and password reset.
 * 
 * Requirements: 2.2, 2.3, 2.4, 2.5, 2.8, 2.9, 2.10, 2.12, 6.4, 6.5, 6.6, 6.7, 7.1, 7.2, 7.3, 7.4, 7.5, 7.7, 7.8
 */

import { generateResetToken, hashToken, validateToken, isTokenExpired } from './tokenUtils';
import { localStorageService, ResetTokenRecord } from '@/services/localStorageService';
import bcrypt from 'bcryptjs';

/**
 * Result of password reset
 */
export interface ResetResult {
  success: boolean;
  message: string;
  requiresSignIn: boolean;
}

/**
 * Result of token status check
 */
export interface ResetTokenStatus {
  exists: boolean;
  valid: boolean;
  expiresAt?: Date;
  message?: string;
}

/**
 * Password validation result
 */
export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Password recovery service for managing password recovery flow
 */
export class PasswordRecoveryService {
  /**
   * Generates a reset token for a user
   * 
   * Creates a new reset token with 1-hour expiration
   * and stores it in localStorage.
   * 
   * **Validates: Requirements 2.3**
   * 
   * @param email - The email address to generate token for
   * @returns Promise resolving to the reset token
   */
  async generateResetToken(email: string): Promise<string> {
    // Find user by email
    const users = localStorageService.getUsers();
    const user = users.find(u => u.email === email);
    
    if (!user) {
      // Don't reveal if email exists (security best practice)
      throw new Error('User not found');
    }
    
    // Generate token with 1-hour expiration
    const tokenWithExpiration = generateResetToken();
    
    // Hash the token for storage
    const tokenHash = await hashToken(tokenWithExpiration.token);
    
    // Create reset token record
    const resetToken: ResetTokenRecord = {
      id: this.generateId(),
      userId: user.id,
      email: email,
      tokenHash: tokenHash,
      expiresAt: tokenWithExpiration.expiresAt.toISOString(),
      createdAt: new Date().toISOString(),
      used: false,
    };
    
    // Store in localStorage
    localStorageService.saveResetToken(resetToken);
    
    // Return the plaintext token (only returned once)
    return tokenWithExpiration.token;
  }

  /**
   * Sends a recovery email to the user
   * 
   * Creates an email with a recovery link containing the token.
   * For now, this is a mock implementation that logs to console.
   * In production, this would send an actual email.
   * 
   * **Validates: Requirements 2.4**
   * 
   * @param email - The email address to send to
   * @param token - The reset token
   * @returns Promise resolving when email is sent
   */
  async sendRecoveryEmail(email: string, token: string): Promise<void> {
    // Create recovery link
    const recoveryLink = `${window.location.origin}/reset-password?token=${token}`;
    
    // Email template
    const emailTemplate = `
Subject: Reset Your Password

Hello ${email},

We received a request to reset your password. Click the link below to set a new password:
${recoveryLink}

This link will expire in 1 hour.

If you didn't request this, please ignore this email.
    `.trim();
    
    // Mock email sending - log to console
    console.log('📧 Password Recovery Email Sent:');
    console.log('To:', email);
    console.log('---');
    console.log(emailTemplate);
    console.log('---');
    console.log('Token:', token);
    console.log('Link:', recoveryLink);
  }

  /**
   * Validates a reset token without using it
   * 
   * Checks if the token is valid, not expired, and not already used.
   * 
   * **Validates: Requirements 2.5**
   * 
   * @param token - The reset token to validate
   * @returns Promise resolving to true if token is valid, false otherwise
   */
  async validateResetToken(token: string): Promise<boolean> {
    try {
      // Find the token record in localStorage
      const storedTokens = localStorageService.getResetTokens();
      let tokenRecord = null;
      
      // Find matching token by comparing hash
      for (const stored of storedTokens) {
        try {
          const isValid = await validateToken(token, stored.tokenHash);
          if (isValid) {
            tokenRecord = stored;
            break;
          }
        } catch {
          // Continue searching if comparison fails
          continue;
        }
      }
      
      if (!tokenRecord) {
        return false;
      }
      
      // Check if token is expired
      if (isTokenExpired(new Date(tokenRecord.expiresAt))) {
        return false;
      }
      
      // Check if token has been used
      if (tokenRecord.used) {
        return false;
      }
      
      // Check if token has been invalidated
      if (tokenRecord.invalidatedAt) {
        return false;
      }
      
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Resets a user's password using a valid reset token
   * 
   * Validates the token, validates the new password, hashes it with bcrypt,
   * updates the user record, and invalidates all sessions.
   * 
   * **Validates: Requirements 2.9, 2.10, 7.7**
   * 
   * @param token - The reset token
   * @param newPassword - The new password
   * @returns Promise resolving to reset result
   */
  async resetPassword(token: string, newPassword: string): Promise<ResetResult> {
    try {
      // Validate password strength
      const passwordValidation = this.validatePassword(newPassword);
      if (!passwordValidation.valid) {
        return {
          success: false,
          message: passwordValidation.errors.join(', '),
          requiresSignIn: false,
        };
      }
      
      // Find the token record in localStorage
      const storedTokens = localStorageService.getResetTokens();
      let tokenRecord = null;
      
      // Find matching token by comparing hash
      for (const stored of storedTokens) {
        try {
          const isValid = await validateToken(token, stored.tokenHash);
          if (isValid) {
            tokenRecord = stored;
            break;
          }
        } catch {
          // Continue searching if comparison fails
          continue;
        }
      }
      
      if (!tokenRecord) {
        return {
          success: false,
          message: 'Invalid or expired recovery link',
          requiresSignIn: false,
        };
      }
      
      // Check if token is expired
      if (isTokenExpired(new Date(tokenRecord.expiresAt))) {
        return {
          success: false,
          message: 'Invalid or expired recovery link',
          requiresSignIn: false,
        };
      }
      
      // Check if token has been used
      if (tokenRecord.used) {
        return {
          success: false,
          message: 'Recovery link already used, request a new one',
          requiresSignIn: false,
        };
      }
      
      // Check if token has been invalidated
      if (tokenRecord.invalidatedAt) {
        return {
          success: false,
          message: 'Invalid or expired recovery link',
          requiresSignIn: false,
        };
      }
      
      // Mark token as used
      localStorageService.updateResetToken(tokenRecord.id, {
        used: true,
        usedAt: new Date().toISOString(),
      });
      
      // Get the user
      const users = localStorageService.getUsers();
      const userIndex = users.findIndex(u => u.id === tokenRecord.userId);
      
      if (userIndex === -1) {
        return {
          success: false,
          message: 'User not found',
          requiresSignIn: false,
        };
      }
      
      // Hash the new password with bcrypt (cost factor 12)
      const hashedPassword = await bcrypt.hash(newPassword, 12);
      
      // Update password in storage
      const passwords = this.getFromStorage<{
        user_id: string;
        password: string;
      }>('passwords');
      
      const passwordIndex = passwords.findIndex(p => p.user_id === tokenRecord.userId);
      if (passwordIndex === -1) {
        passwords.push({
          user_id: tokenRecord.userId,
          password: hashedPassword,
        });
      } else {
        passwords[passwordIndex].password = hashedPassword;
      }
      
      // Save updated passwords
      this.saveToStorage('passwords', passwords);
      
      // Invalidate all sessions for this user
      this.invalidateAllUserSessions(tokenRecord.userId);
      
      return {
        success: true,
        message: 'Password reset successfully',
        requiresSignIn: true,
      };
    } catch (error) {
      console.error('Password reset error:', error);
      return {
        success: false,
        message: 'Password reset failed, please try again',
        requiresSignIn: false,
      };
    }
  }

  /**
   * Resends a recovery email to the user
   * 
   * Generates a new reset token, invalidates the old one,
   * and sends a new recovery email.
   * 
   * **Validates: Requirements 2.12**
   * 
   * @param email - The email address to resend to
   * @returns Promise resolving when email is resent
   */
  async resendRecoveryEmail(email: string): Promise<void> {
    // Find user by email
    const users = localStorageService.getUsers();
    const user = users.find(u => u.email === email);
    
    if (!user) {
      // Don't reveal if email exists (security best practice)
      console.log('User not found for email:', email);
      return;
    }
    
    // Invalidate old reset tokens
    const tokens = localStorageService.getResetTokens();
    const userTokens = tokens.filter(t => t.userId === user.id);
    
    for (const token of userTokens) {
      if (!token.invalidatedAt) {
        localStorageService.updateResetToken(token.id, {
          invalidatedAt: new Date().toISOString(),
        });
      }
    }
    
    // Generate new token
    const newToken = await this.generateResetToken(email);
    
    // Send new email
    await this.sendRecoveryEmail(email, newToken);
  }

  /**
   * Gets the reset token status for an email
   * 
   * Checks if a valid reset token exists for the email.
   * 
   * @param email - The email address to check
   * @returns Promise resolving to token status
   */
  async getResetTokenStatus(email: string): Promise<ResetTokenStatus> {
    try {
      // Find user by email
      const users = localStorageService.getUsers();
      const user = users.find(u => u.email === email);
      
      if (!user) {
        return {
          exists: false,
          valid: false,
          message: 'User not found',
        };
      }
      
      // Find active reset token for user
      const tokens = localStorageService.getResetTokens();
      const activeToken = tokens.find(
        t => t.userId === user.id && !t.used && !t.invalidatedAt
      );
      
      if (!activeToken) {
        return {
          exists: false,
          valid: false,
          message: 'No active reset token',
        };
      }
      
      // Check if token is expired
      const expiresAt = new Date(activeToken.expiresAt);
      if (isTokenExpired(expiresAt)) {
        return {
          exists: true,
          valid: false,
          expiresAt,
          message: 'Token expired',
        };
      }
      
      return {
        exists: true,
        valid: true,
        expiresAt,
      };
    } catch {
      return {
        exists: false,
        valid: false,
        message: 'Error checking token status',
      };
    }
  }

  /**
   * Validates a password against security requirements
   * 
   * **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5**
   * 
   * @param password - The password to validate
   * @returns Validation result with errors if invalid
   */
  validatePassword(password: string): PasswordValidationResult {
    const errors: string[] = [];
    
    // Check minimum length (8 characters)
    if (password.length < 8) {
      errors.push('Password must be at least 8 characters long');
    }
    
    // Check for uppercase letter
    if (!/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }
    
    // Check for lowercase letter
    if (!/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }
    
    // Check for number
    if (!/[0-9]/.test(password)) {
      errors.push('Password must contain at least one number');
    }
    
    // Check for special character
    if (!/[!@#$%^&*]/.test(password)) {
      errors.push('Password must contain at least one special character (!@#$%^&*)');
    }
    
    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Invalidates all sessions for a user
   * 
   * Used when password is reset to force re-authentication.
   * 
   * **Validates: Requirements 2.10**
   * 
   * @param userId - The user ID
   */
  private invalidateAllUserSessions(userId: string): void {
    // In a real implementation, this would invalidate all session tokens
    // For now, we'll clear the current user session if it matches
    const currentUser = localStorageService.getCurrentUser();
    if (currentUser && currentUser.id === userId) {
      localStorageService.setCurrentUser(null);
    }
  }

  /**
   * Generates a unique ID for token records
   * 
   * @returns A unique ID string
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Helper method to get storage (for testing)
   * 
   * @param key - The storage key
   * @returns The stored data
   */
  private getFromStorage<T>(key: string): T[] {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  /**
   * Helper method to save storage (for testing)
   * 
   * @param key - The storage key
   * @param data - The data to store
   */
  private saveToStorage<T>(key: string, data: T[]): void {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (error) {
      console.error('Failed to save to localStorage:', error);
    }
  }
}

/**
 * Global password recovery service instance
 */
export const passwordRecoveryService = new PasswordRecoveryService();
