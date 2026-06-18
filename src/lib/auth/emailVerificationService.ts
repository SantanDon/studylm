/**
 * Email Verification Service
 * 
 * Manages the email verification flow including token generation,
 * email sending, and email verification.
 * 
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10
 */

import { generateVerificationToken, hashToken, validateToken, isTokenExpired } from './tokenUtils';
import { localStorageService, LocalUser } from '@/services/localStorageService';

/**
 * Result of email verification
 */
export interface VerificationResult {
  success: boolean;
  message: string;
  userId?: string;
  canSignIn: boolean;
}

/**
 * Email verification service for managing email verification flow
 */
export class EmailVerificationService {
  /**
   * Generates a verification token for a user
   * 
   * Creates a new verification token with 24-hour expiration
   * and stores it in localStorage.
   * 
   * **Validates: Requirements 1.2**
   * 
   * @param userId - The user ID to generate token for
   * @returns Promise resolving to the verification token
   */
  async generateVerificationToken(userId: string): Promise<string> {
    // Generate token with 24-hour expiration
    const tokenWithExpiration = generateVerificationToken();
    
    // Hash the token for storage
    const tokenHash = await hashToken(tokenWithExpiration.token);
    
    // Create verification token record
    const verificationToken = {
      id: this.generateId(),
      userId: userId,
      tokenHash: tokenHash,
      expiresAt: tokenWithExpiration.expiresAt.toISOString(),
      createdAt: new Date().toISOString(),
      used: false,
    };
    
    // Store in localStorage
    localStorageService.saveVerificationToken(verificationToken);
    
    // Return the plaintext token (only returned once)
    return tokenWithExpiration.token;
  }

  /**
   * Sends a verification email to the user
   * 
   * Creates an email with a verification link containing the token.
   * For now, this is a mock implementation that logs to console.
   * In production, this would send an actual email.
   * 
   * **Validates: Requirements 1.3**
   * 
   * @param email - The email address to send to
   * @param token - The verification token
   * @returns Promise resolving when email is sent
   */
  async sendVerificationEmail(email: string, token: string): Promise<void> {
    // Create verification link
    const verificationLink = `${window.location.origin}/verify-email?token=${token}`;
    
    // Email template
    const emailTemplate = `
Subject: Verify Your Email Address

Hello ${email},

Please verify your email address by clicking the link below:
${verificationLink}

This link will expire in 24 hours.

If you didn't create this account, please ignore this email.
    `.trim();
    
    // Mock email sending - log to console
    console.log('📧 Verification Email Sent:');
    console.log('To:', email);
    console.log('---');
    console.log(emailTemplate);
    console.log('---');
    console.log('Token:', token);
    console.log('Link:', verificationLink);
  }

  /**
   * Verifies an email using a verification token
   * 
   * Validates the token, marks it as used, and updates the user's
   * email verification status.
   * 
   * **Validates: Requirements 1.4, 1.6**
   * 
   * @param token - The verification token from the email link
   * @returns Promise resolving to verification result
   */
  async verifyEmail(token: string): Promise<VerificationResult> {
    try {
      // Find the token record in localStorage
      const storedTokens = localStorageService.getVerificationTokens();
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
          message: 'Invalid or expired verification link',
          canSignIn: false,
        };
      }
      
      // Check if token is expired
      if (isTokenExpired(new Date(tokenRecord.expiresAt))) {
        return {
          success: false,
          message: 'Invalid or expired verification link',
          canSignIn: false,
        };
      }
      
      // Check if token has been used
      if (tokenRecord.used) {
        return {
          success: false,
          message: 'Invalid or expired verification link',
          canSignIn: false,
        };
      }
      
      // Check if token has been invalidated
      if (tokenRecord.invalidatedAt) {
        return {
          success: false,
          message: 'Invalid or expired verification link',
          canSignIn: false,
        };
      }
      
      // Mark token as used
      localStorageService.updateVerificationToken(tokenRecord.id, {
        used: true,
        usedAt: new Date().toISOString(),
      });
      
      // Get the user and mark as verified
      const users = localStorageService.getUsers();
      const userIndex = users.findIndex(u => u.id === tokenRecord.userId);
      
      if (userIndex === -1) {
        return {
          success: false,
          message: 'User not found',
          canSignIn: false,
        };
      }
      
      // Update user's email verification status
      const user = users[userIndex];
      const updatedUser: LocalUser = {
        ...user,
        emailVerified: true,
      };
      
      // Save updated user directly to localStorage
      users[userIndex] = updatedUser;
      localStorage.setItem('users', JSON.stringify(users));
      
      return {
        success: true,
        message: 'Email verified successfully',
        userId: tokenRecord.userId,
        canSignIn: true,
      };
    } catch (error) {
      console.error('Email verification error:', error);
      return {
        success: false,
        message: 'Invalid or expired verification link',
        canSignIn: false,
      };
    }
  }

  /**
   * Resends a verification email to the user
   * 
   * Generates a new verification token, invalidates the old one,
   * and sends a new verification email.
   * 
   * **Validates: Requirements 1.9**
   * 
   * @param email - The email address to resend to
   * @returns Promise resolving when email is resent
   */
  async resendVerificationEmail(email: string): Promise<void> {
    // Find user by email
    const users = localStorageService.getUsers();
    const user = users.find(u => u.email === email);
    
    if (!user) {
      // Don't reveal if email exists (security best practice)
      console.log('User not found for email:', email);
      return;
    }
    
    // Check if already verified
    const userWithVerification = user as LocalUser & { emailVerified?: boolean };
    if (userWithVerification.emailVerified) {
      console.log('Email already verified:', email);
      return;
    }
    
    // Invalidate old verification tokens
    const tokens = localStorageService.getVerificationTokens();
    const userTokens = tokens.filter(t => t.userId === user.id);
    
    for (const token of userTokens) {
      if (!token.invalidatedAt) {
        localStorageService.updateVerificationToken(token.id, {
          invalidatedAt: new Date().toISOString(),
        });
      }
    }
    
    // Generate new token
    const newToken = await this.generateVerificationToken(user.id);
    
    // Send new email
    await this.sendVerificationEmail(email, newToken);
  }

  /**
   * Checks if a user's email is verified
   * 
   * @param userId - The user ID to check
   * @returns Promise resolving to true if email is verified, false otherwise
   */
  async isEmailVerified(userId: string): Promise<boolean> {
    const users = localStorageService.getUsers();
    const user = users.find(u => u.id === userId);
    
    if (!user) {
      return false;
    }
    
    const userWithVerification = user as LocalUser & { emailVerified?: boolean };
    return userWithVerification.emailVerified === true;
  }

  /**
   * Gets the verification status for a user
   * 
   * @param userId - The user ID to check
   * @returns Promise resolving to verification status object
   */
  async getVerificationStatus(userId: string): Promise<{
    verified: boolean;
    email?: string;
    verificationTokenExpiry?: Date;
  }> {
    const users = localStorageService.getUsers();
    const user = users.find(u => u.id === userId);
    
    if (!user) {
      return { verified: false };
    }
    
    const userWithVerification = user as LocalUser & { emailVerified?: boolean };
    const verified = userWithVerification.emailVerified === true;
    
    // Get active verification token if not verified
    let verificationTokenExpiry: Date | undefined;
    if (!verified) {
      const tokens = localStorageService.getVerificationTokens();
      const activeToken = tokens.find(
        t => t.userId === userId && !t.used && !t.invalidatedAt
      );
      if (activeToken) {
        verificationTokenExpiry = new Date(activeToken.expiresAt);
      }
    }
    
    return {
      verified,
      email: user.email,
      verificationTokenExpiry,
    };
  }

  /**
   * Validates a verification token without marking it as used
   * 
   * Used for checking if a token is valid before attempting verification.
   * 
   * @param token - The verification token to validate
   * @returns Promise resolving to true if token is valid, false otherwise
   */
  async validateVerificationToken(token: string): Promise<boolean> {
    try {
      const storedTokens = localStorageService.getVerificationTokens();
      
      for (const stored of storedTokens) {
        try {
          const isValid = await validateToken(token, stored.tokenHash);
          if (isValid && !isTokenExpired(new Date(stored.expiresAt)) && !stored.used && !stored.invalidatedAt) {
            return true;
          }
        } catch {
          continue;
        }
      }
      
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Invalidates a verification token
   * 
   * @param tokenId - The token ID to invalidate
   * @returns true if successfully invalidated, false otherwise
   */
  invalidateVerificationToken(tokenId: string): boolean {
    const result = localStorageService.updateVerificationToken(tokenId, {
      invalidatedAt: new Date().toISOString(),
    });
    return result !== null;
  }

  /**
   * Invalidates all verification tokens for a user
   * 
   * @param userId - The user ID
   * @returns Number of tokens invalidated
   */
  invalidateAllVerificationTokens(userId: string): number {
    const tokens = localStorageService.getVerificationTokens();
    let count = 0;
    
    for (const token of tokens) {
      if (token.userId === userId && !token.invalidatedAt) {
        localStorageService.updateVerificationToken(token.id, {
          invalidatedAt: new Date().toISOString(),
        });
        count++;
      }
    }
    
    return count;
  }

  /**
   * Generates a unique ID for token records
   * 
   * @returns A unique ID string
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * Global email verification service instance
 */
export const emailVerificationService = new EmailVerificationService();
