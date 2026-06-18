/**
 * Data integrity verification using SHA-256 checksums
 * 
 * Checksums ensure data hasn't been corrupted during storage or transmission.
 * Used to verify encrypted data integrity after download from cloud.
 */

import { arrayBufferToBase64 } from './utils';

/**
 * Generate SHA-256 checksum for data
 * 
 * @param data - String data to checksum
 * @returns Base64-encoded SHA-256 hash
 */
export async function generateChecksum(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  
  return arrayBufferToBase64(hashBuffer);
}

/**
 * Verify data matches expected checksum
 * 
 * @param data - String data to verify
 * @param expectedChecksum - Base64-encoded expected checksum
 * @returns True if checksum matches, false otherwise
 */
export async function verifyChecksum(
  data: string,
  expectedChecksum: string
): Promise<boolean> {
  const actualChecksum = await generateChecksum(data);
  
  // Constant-time comparison to prevent timing attacks
  return constantTimeCompare(actualChecksum, expectedChecksum);
}

/**
 * Constant-time string comparison
 * Prevents timing attacks by always comparing all characters
 * 
 * @param a - First string
 * @param b - Second string
 * @returns True if strings are equal
 */
function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  
  return result === 0;
}

/**
 * Generate checksum for JSON data
 * Convenience function for objects
 * 
 * @param data - Any JSON-serializable data
 * @returns Base64-encoded SHA-256 hash
 */
export async function generateJSONChecksum<T>(data: T): Promise<string> {
  const jsonString = JSON.stringify(data);
  return generateChecksum(jsonString);
}

/**
 * Verify JSON data matches expected checksum
 * 
 * @param data - Any JSON-serializable data
 * @param expectedChecksum - Base64-encoded expected checksum
 * @returns True if checksum matches
 */
export async function verifyJSONChecksum<T>(
  data: T,
  expectedChecksum: string
): Promise<boolean> {
  const jsonString = JSON.stringify(data);
  return verifyChecksum(jsonString, expectedChecksum);
}

/**
 * Generate content hash for version comparison
 * Used for detecting conflicts in sync
 * 
 * @param content - Content to hash
 * @returns Base64-encoded hash (shorter than full checksum)
 */
export async function generateContentHash(content: string): Promise<string> {
  // Use first 16 bytes (128 bits) of SHA-256 for shorter hash
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(content);
  
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const shortHash = hashBuffer.slice(0, 16);
  
  return arrayBufferToBase64(shortHash);
}
