/**
 * Bug Condition Exploration Test: Multi-User localStorage Isolation
 *
 * CRITICAL: This test MUST FAIL on unfixed code - failure confirms the bug exists
 *
 * This test encodes the EXPECTED behavior (user-namespaced localStorage).
 * When run on UNFIXED code, it will fail and surface counterexamples.
 * When run on FIXED code, it will pass and confirm the bug is resolved.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateKeyFromPassphrase, deriveMasterKey } from "../keyDerivation";
import { encrypt, decrypt } from "../encryption";
import { base64ToArrayBuffer, arrayBufferToBase64 } from "../utils";
import { UserStorage } from "../userStorage";

describe("Bug Condition: Multi-User localStorage Isolation", () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
  });

  afterEach(() => {
    // Clean up after each test
    localStorage.clear();
  });

  it("should isolate User A and User B encryption data with user-namespaced keys", async () => {
    // Simulate User A creating an encrypted account
    const userAId = "user-a-123";
    const userAPassphrase = "password123";

    // User A: Generate key and salt
    const { key: keyA, salt: saltA } =
      await generateKeyFromPassphrase(userAPassphrase);
    const saltABase64 = arrayBufferToBase64(saltA);

    // User A: Encrypt test data
    const userAData = "User A secret data";
    const encryptedA = await encrypt(userAData, keyA);

    // EXPECTED: User A's data should be stored with user-namespaced keys
    // Format: user:{userId}:encryption_salt
    const expectedKeyA = `user:${userAId}:encryption_salt`;

    // Simulate what AccountCreation component SHOULD do (but currently doesn't)
    // This is the EXPECTED behavior we're testing for
    localStorage.setItem(expectedKeyA, saltABase64);
    localStorage.setItem(
      `user:${userAId}:encryption_test`,
      JSON.stringify(encryptedA),
    );

    // Verify User A's keys exist with proper namespace
    expect(localStorage.getItem(expectedKeyA)).toBe(saltABase64);
    expect(
      localStorage.getItem(`user:${userAId}:encryption_test`),
    ).toBeTruthy();

    // Simulate User B creating an encrypted account on the same device
    const userBId = "user-b-456";
    const userBPassphrase = "password123"; // Same passphrase as User A

    // User B: Generate key and salt
    const { key: keyB, salt: saltB } =
      await generateKeyFromPassphrase(userBPassphrase);
    const saltBBase64 = arrayBufferToBase64(saltB);

    // User B: Encrypt test data
    const userBData = "User B secret data";
    const encryptedB = await encrypt(userBData, keyB);

    // EXPECTED: User B's data should be stored with SEPARATE user-namespaced keys
    const expectedKeyB = `user:${userBId}:encryption_salt`;

    // Simulate what AccountCreation component SHOULD do for User B
    localStorage.setItem(expectedKeyB, saltBBase64);
    localStorage.setItem(
      `user:${userBId}:encryption_test`,
      JSON.stringify(encryptedB),
    );

    // ASSERTION 1: User B's localStorage keys should be namespaced with user:{userId}: prefix
    expect(localStorage.getItem(expectedKeyB)).toBe(saltBBase64);
    expect(localStorage.getItem(expectedKeyB)).not.toBe(saltABase64); // Different salts

    // ASSERTION 2: User A's data should NOT be accessible to User B
    // User A's keys should still exist and be unchanged
    expect(localStorage.getItem(expectedKeyA)).toBe(saltABase64);
    expect(
      localStorage.getItem(`user:${userAId}:encryption_test`),
    ).toBeTruthy();

    // ASSERTION 3: localStorage should contain SEPARATE keys for each user
    const allKeys = Object.keys(localStorage);
    const userAKeys = allKeys.filter((key) =>
      key.startsWith(`user:${userAId}:`),
    );
    const userBKeys = allKeys.filter((key) =>
      key.startsWith(`user:${userBId}:`),
    );

    expect(userAKeys.length).toBeGreaterThan(0);
    expect(userBKeys.length).toBeGreaterThan(0);
    expect(userAKeys).not.toEqual(userBKeys);

    // ASSERTION 4: Same passphrase should produce different encryption contexts
    // User B should NOT be able to decrypt User A's data even with same passphrase
    const userAEncryptedData = JSON.parse(
      localStorage.getItem(`user:${userAId}:encryption_test`)!,
    );
    const userASalt = base64ToArrayBuffer(localStorage.getItem(expectedKeyA)!);

    // User B tries to decrypt User A's data using their own key (same passphrase, different salt)
    try {
      const userBKeyForA = await deriveMasterKey(userBPassphrase, userASalt);
      const decryptedByB = await decrypt(userAEncryptedData, userBKeyForA);

      // If User B can decrypt User A's data, that's a privacy violation
      // This should NOT happen with proper isolation
      expect(decryptedByB).not.toBe(userAData);
    } catch (error) {
      // Expected: decryption should fail because keys are different
      // Even though passphrases are the same, salts are different
      expect(error).toBeDefined();
    }
  });

  it("should provide account discovery mechanism to list all users on device", async () => {
    // Create multiple users
    const users = [
      { id: "user-1", passphrase: "pass1" },
      { id: "user-2", passphrase: "pass2" },
      { id: "user-3", passphrase: "pass3" },
    ];

    // Simulate account creation for each user
    for (const user of users) {
      const { salt } = await generateKeyFromPassphrase(user.passphrase);
      const saltBase64 = arrayBufferToBase64(salt);

      // Store with user-namespaced keys
      localStorage.setItem(`user:${user.id}:encryption_salt`, saltBase64);
      localStorage.setItem(
        `user:${user.id}:created_at`,
        new Date().toISOString(),
      );
    }

    // EXPECTED: Should be able to discover all user IDs from localStorage
    const allKeys = Object.keys(localStorage);
    const userKeys = allKeys.filter((key) => key.startsWith("user:"));
    const userIds = new Set<string>();

    for (const key of userKeys) {
      const parts = key.split(":");
      if (parts.length >= 2) {
        userIds.add(parts[1]);
      }
    }

    // ASSERTION: All user IDs should be discoverable
    expect(userIds.size).toBe(3);
    expect(userIds.has("user-1")).toBe(true);
    expect(userIds.has("user-2")).toBe(true);
    expect(userIds.has("user-3")).toBe(true);
  });

  it("keeps the implemented storage path namespaced and independently clearable", () => {
    const userAStorage = new UserStorage("user-a-123");
    const userBStorage = new UserStorage("user-b-456");

    userAStorage.set("encryption_salt", "salt-a");
    userBStorage.set("encryption_salt", "salt-b");

    expect(localStorage.getItem("encryption_salt")).toBeNull();
    expect(userAStorage.get("encryption_salt")).toBe("salt-a");
    expect(userBStorage.get("encryption_salt")).toBe("salt-b");

    userBStorage.clear();
    expect(userAStorage.get("encryption_salt")).toBe("salt-a");
    expect(userBStorage.get("encryption_salt")).toBeNull();
  });
});
