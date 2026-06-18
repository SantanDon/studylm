/**
 * Unit tests for encryption module
 */

import { describe, it, expect } from 'vitest';
import {
  generateSalt,
  deriveMasterKey,
  generateKeyFromPassphrase,
  exportSalt,
} from '../keyDerivation';
import {
  encrypt,
  decrypt,
  encryptJSON,
  decryptJSON,
} from '../encryption';
import {
  generateChecksum,
  verifyChecksum,
  generateContentHash,
} from '../integrity';

describe('Key Derivation', () => {
  it('should generate unique salt each time', () => {
    const salt1 = generateSalt();
    const salt2 = generateSalt();
    
    expect(salt1).not.toEqual(salt2);
    expect(salt1.length).toBe(32); // 256 bits
  });

  it('should derive same key from same passphrase and salt', async () => {
    const passphrase = 'test-passphrase-123';
    const salt = generateSalt();
    
    const key1 = await deriveMasterKey(passphrase, salt);
    const key2 = await deriveMasterKey(passphrase, salt);
    
    // Keys should be functionally equivalent
    const testData = 'test data';
    const encrypted1 = await encrypt(testData, key1);
    const encrypted2 = await encrypt(testData, key2);
    
    // Both keys should decrypt each other's data
    const decrypted1 = await decrypt(encrypted1, key2);
    const decrypted2 = await decrypt(encrypted2, key1);
    
    expect(decrypted1).toBe(testData);
    expect(decrypted2).toBe(testData);
  });

  it('should derive different keys from different passphrases', async () => {
    const salt = generateSalt();
    
    const key1 = await deriveMasterKey('passphrase1', salt);
    const key2 = await deriveMasterKey('passphrase2', salt);
    
    const testData = 'test data';
    const encrypted = await encrypt(testData, key1);
    
    // key2 should not be able to decrypt data encrypted with key1
    await expect(decrypt(encrypted, key2)).rejects.toThrow();
  });

  it('should export and import salt correctly', async () => {
    const { salt } = await generateKeyFromPassphrase('test-pass');
    const saltBase64 = exportSalt(salt);
    
    expect(typeof saltBase64).toBe('string');
    expect(saltBase64.length).toBeGreaterThan(0);
  });
});

describe('Encryption/Decryption', () => {
  it('should encrypt and decrypt string data', async () => {
    const passphrase = 'my-secure-passphrase';
    const { key } = await generateKeyFromPassphrase(passphrase);
    
    const plaintext = 'Hello, World! This is secret data.';
    const encrypted = await encrypt(plaintext, key);
    
    expect(encrypted.iv).toBeTruthy();
    expect(encrypted.ciphertext).toBeTruthy();
    expect(encrypted.tag).toBeTruthy();
    
    const decrypted = await decrypt(encrypted, key);
    expect(decrypted).toBe(plaintext);
  });

  it('should produce different ciphertext for same plaintext', async () => {
    const { key } = await generateKeyFromPassphrase('test-pass');
    const plaintext = 'same data';
    
    const encrypted1 = await encrypt(plaintext, key);
    const encrypted2 = await encrypt(plaintext, key);
    
    // IVs should be different
    expect(encrypted1.iv).not.toBe(encrypted2.iv);
    // Ciphertext should be different due to different IVs
    expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);
    
    // But both should decrypt to same plaintext
    expect(await decrypt(encrypted1, key)).toBe(plaintext);
    expect(await decrypt(encrypted2, key)).toBe(plaintext);
  });

  it('should handle empty string', async () => {
    const { key } = await generateKeyFromPassphrase('test-pass');
    const plaintext = '';
    
    const encrypted = await encrypt(plaintext, key);
    const decrypted = await decrypt(encrypted, key);
    
    expect(decrypted).toBe(plaintext);
  });

  it('should handle unicode characters', async () => {
    const { key } = await generateKeyFromPassphrase('test-pass');
    const plaintext = '你好世界 🌍 Привет мир';
    
    const encrypted = await encrypt(plaintext, key);
    const decrypted = await decrypt(encrypted, key);
    
    expect(decrypted).toBe(plaintext);
  });

  it('should fail decryption with wrong key', async () => {
    const { key: key1 } = await generateKeyFromPassphrase('password1');
    const { key: key2 } = await generateKeyFromPassphrase('password2');
    
    const plaintext = 'secret data';
    const encrypted = await encrypt(plaintext, key1);
    
    await expect(decrypt(encrypted, key2)).rejects.toThrow();
  });

  it('should fail decryption with tampered ciphertext', async () => {
    const { key } = await generateKeyFromPassphrase('test-pass');
    const plaintext = 'secret data';
    
    const encrypted = await encrypt(plaintext, key);
    
    // Tamper with ciphertext
    const tampered = {
      ...encrypted,
      ciphertext: encrypted.ciphertext.slice(0, -4) + 'XXXX',
    };
    
    await expect(decrypt(tampered, key)).rejects.toThrow();
  });
});

describe('JSON Encryption', () => {
  it('should encrypt and decrypt JSON objects', async () => {
    const { key } = await generateKeyFromPassphrase('test-pass');
    
    const data = {
      id: '123',
      title: 'Test Notebook',
      content: 'Some content here',
      metadata: {
        created: new Date().toISOString(),
        tags: ['test', 'example'],
      },
    };
    
    const encrypted = await encryptJSON(data, key);
    const decrypted = await decryptJSON(encrypted, key);
    
    expect(decrypted).toEqual(data);
  });

  it('should handle arrays', async () => {
    const { key } = await generateKeyFromPassphrase('test-pass');
    const data = [1, 2, 3, 'four', { five: 5 }];
    
    const encrypted = await encryptJSON(data, key);
    const decrypted = await decryptJSON(encrypted, key);
    
    expect(decrypted).toEqual(data);
  });
});

describe('Data Integrity', () => {
  it('should generate consistent checksum for same data', async () => {
    const data = 'test data';
    
    const checksum1 = await generateChecksum(data);
    const checksum2 = await generateChecksum(data);
    
    expect(checksum1).toBe(checksum2);
  });

  it('should generate different checksums for different data', async () => {
    const checksum1 = await generateChecksum('data1');
    const checksum2 = await generateChecksum('data2');
    
    expect(checksum1).not.toBe(checksum2);
  });

  it('should verify correct checksum', async () => {
    const data = 'test data';
    const checksum = await generateChecksum(data);
    
    const isValid = await verifyChecksum(data, checksum);
    expect(isValid).toBe(true);
  });

  it('should reject incorrect checksum', async () => {
    const data = 'test data';
    const checksum = await generateChecksum(data);
    
    const tamperedData = 'test data modified';
    const isValid = await verifyChecksum(tamperedData, checksum);
    
    expect(isValid).toBe(false);
  });

  it('should generate content hash', async () => {
    const content = 'some content for hashing';
    const hash = await generateContentHash(content);
    
    expect(typeof hash).toBe('string');
    expect(hash.length).toBeGreaterThan(0);
  });
});
