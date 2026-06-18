/**
 * Token Manager for Authentication System
 * 
 * Manages the lifecycle of authentication tokens including creation,
 * validation, expiration, and invalidation.
 * 
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8
 */

import {
  hashToken,
  validateToken,
  isTokenExpired,
  generateVerificationToken,
  generateResetToken,
  generateSessionToken,
} from './tokenUtils';

/**
 * Record of a stored token with metadata
 */
export interface TokenRecord {
  id: string;
  token: string;
  tokenHash: string;
  userId: string;
  type: 'verification' | 'reset' | 'session';
  expiresAt: Date;
  createdAt: Date;
  used: boolean;
  usedAt?: Date;
  invalidatedAt?: Date;
}

/**
 * Result of token validation
 */
export interface TokenValidationResult {
  valid: boolean;
  reason?: string;
  token?: TokenRecord;
}

/**
 * Token Manager class for managing token lifecycle
 * 
 * Handles:
 * - Token creation with expiration
 * - Token validation against stored hashes
 * - Token expiration checking
 * - One-time token use enforcement
 * - Token invalidation
 */
export class TokenManager {
  private tokens: Map<string, TokenRecord> = new Map();
  private tokensByUserId: Map<string, TokenRecord[]> = new Map();

  /**
   * Creates a new token record
   * 
   * Generates a new token, hashes it, and stores the record.
   * 
   * @param userId - The user ID associated with the token
   * @param type - The type of token (verification, reset, session)
   * @returns Promise resolving to the token record with plaintext token
   */
  async createToken(
    userId: string,
    type: 'verification' | 'reset' | 'session'
  ): Promise<TokenRecord & { token: string }> {
    let tokenWithExpiration;

    // Generate token with appropriate expiration based on type
    switch (type) {
      case 'verification':
        tokenWithExpiration = generateVerificationToken();
        break;
      case 'reset':
        tokenWithExpiration = generateResetToken();
        break;
      case 'session':
        tokenWithExpiration = generateSessionToken();
        break;
    }

    // Hash the token for storage
    const tokenHash = await hashToken(tokenWithExpiration.token);

    // Create token record
    const record: TokenRecord = {
      id: this.generateId(),
      token: tokenWithExpiration.token,
      tokenHash,
      userId,
      type,
      expiresAt: tokenWithExpiration.expiresAt,
      createdAt: new Date(),
      used: false,
    };

    // Store the record
    this.tokens.set(record.id, record);

    // Index by user ID for quick lookup
    if (!this.tokensByUserId.has(userId)) {
      this.tokensByUserId.set(userId, []);
    }
    this.tokensByUserId.get(userId)!.push(record);

    // Return record with plaintext token (only returned once)
    return {
      ...record,
      token: tokenWithExpiration.token,
    };
  }

  /**
   * Validates a token against stored hash
   * 
   * Checks:
   * - Token exists
   * - Token is not expired
   * - Token has not been used (for verification/reset tokens)
   * - Token has not been invalidated
   * 
   * **Validates: Requirements 4.5, 4.6, 4.8**
   * 
   * @param token - The plaintext token to validate
   * @returns Promise resolving to validation result
   */
  async validateToken(token: string): Promise<TokenValidationResult> {
    // Find token record by plaintext token
    let record: TokenRecord | undefined;

    for (const tokenRecord of this.tokens.values()) {
      try {
        const isValid = await validateToken(token, tokenRecord.tokenHash);
        if (isValid) {
          record = tokenRecord;
          break;
        }
      } catch {
        // Continue searching if comparison fails
        continue;
      }
    }

    if (!record) {
      return {
        valid: false,
        reason: 'Token not found',
      };
    }

    // Check if token is expired
    if (isTokenExpired(record.expiresAt)) {
      return {
        valid: false,
        reason: 'Token expired',
        token: record,
      };
    }

    // Check if token has been used (for verification/reset tokens)
    if ((record.type === 'verification' || record.type === 'reset') && record.used) {
      return {
        valid: false,
        reason: 'Token already used',
        token: record,
      };
    }

    // Check if token has been invalidated
    if (record.invalidatedAt) {
      return {
        valid: false,
        reason: 'Token invalidated',
        token: record,
      };
    }

    return {
      valid: true,
      token: record,
    };
  }

  /**
   * Marks a token as used (for one-time use tokens)
   * 
   * **Validates: Requirements 4.8**
   * 
   * @param tokenId - The ID of the token record
   * @returns true if successfully marked as used, false if not found
   */
  markTokenAsUsed(tokenId: string): boolean {
    const record = this.tokens.get(tokenId);
    if (!record) {
      return false;
    }

    record.used = true;
    record.usedAt = new Date();
    return true;
  }

  /**
   * Invalidates a token
   * 
   * **Validates: Requirements 4.7**
   * 
   * @param tokenId - The ID of the token record
   * @returns true if successfully invalidated, false if not found
   */
  invalidateToken(tokenId: string): boolean {
    const record = this.tokens.get(tokenId);
    if (!record) {
      return false;
    }

    record.invalidatedAt = new Date();
    return true;
  }

  /**
   * Invalidates all tokens of a specific type for a user
   * 
   * Used when replacing tokens (e.g., resending verification email).
   * 
   * **Validates: Requirements 4.7**
   * 
   * @param userId - The user ID
   * @param type - The token type to invalidate
   * @returns Number of tokens invalidated
   */
  invalidateUserTokensByType(userId: string, type: 'verification' | 'reset' | 'session'): number {
    const userTokens = this.tokensByUserId.get(userId) || [];
    let count = 0;

    for (const token of userTokens) {
      if (token.type === type && !token.invalidatedAt) {
        token.invalidatedAt = new Date();
        count++;
      }
    }

    return count;
  }

  /**
   * Invalidates all tokens for a user
   * 
   * Used when user changes password or performs sensitive operations.
   * 
   * @param userId - The user ID
   * @returns Number of tokens invalidated
   */
  invalidateAllUserTokens(userId: string): number {
    const userTokens = this.tokensByUserId.get(userId) || [];
    let count = 0;

    for (const token of userTokens) {
      if (!token.invalidatedAt) {
        token.invalidatedAt = new Date();
        count++;
      }
    }

    return count;
  }

  /**
   * Checks if a token is expired
   * 
   * **Validates: Requirements 4.6**
   * 
   * @param tokenId - The ID of the token record
   * @returns true if token is expired, false otherwise
   */
  isExpired(tokenId: string): boolean {
    const record = this.tokens.get(tokenId);
    if (!record) {
      return true; // Treat missing tokens as expired
    }

    return isTokenExpired(record.expiresAt);
  }

  /**
   * Gets a token record by ID
   * 
   * @param tokenId - The ID of the token record
   * @returns The token record or undefined if not found
   */
  getToken(tokenId: string): TokenRecord | undefined {
    return this.tokens.get(tokenId);
  }

  /**
   * Gets all tokens for a user
   * 
   * @param userId - The user ID
   * @returns Array of token records for the user
   */
  getUserTokens(userId: string): TokenRecord[] {
    return this.tokensByUserId.get(userId) || [];
  }

  /**
   * Gets all active (non-expired, non-invalidated) tokens for a user
   * 
   * @param userId - The user ID
   * @returns Array of active token records
   */
  getActiveUserTokens(userId: string): TokenRecord[] {
    const userTokens = this.getUserTokens(userId);
    return userTokens.filter(
      token => !isTokenExpired(token.expiresAt) && !token.invalidatedAt
    );
  }

  /**
   * Cleans up expired tokens
   * 
   * Removes tokens that have expired from memory.
   * 
   * @returns Number of tokens cleaned up
   */
  cleanupExpiredTokens(): number {
    let count = 0;

    for (const [tokenId, record] of this.tokens.entries()) {
      if (isTokenExpired(record.expiresAt)) {
        this.tokens.delete(tokenId);
        count++;

        // Also remove from user index
        const userTokens = this.tokensByUserId.get(record.userId);
        if (userTokens) {
          const index = userTokens.indexOf(record);
          if (index > -1) {
            userTokens.splice(index, 1);
          }
        }
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
 * Global token manager instance
 */
export const tokenManager = new TokenManager();
