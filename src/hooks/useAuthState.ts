/**
 * Unified Authentication State Hook
 * 
 * Combines the old AuthContext (email/password) and new EncryptionStore (PIN/passphrase)
 * into a single source of truth for authentication state.
 */

import { useAuth } from '@/hooks/useAuth';
import { useEncryptionStore } from '@/stores/encryptionStore';
import { useMemo } from 'react';

export interface UnifiedAuthState {
  isSignedIn: boolean;
  isGuest: boolean;
  user: {
    id: string;
    email?: string;
    displayName: string;
    is_verified?: boolean | number;
  } | null;
  authMethod: 'none' | 'legacy' | 'encryption';
}

export function useAuthState(): UnifiedAuthState {
  const { user: legacyUser, isAuthenticated } = useAuth();
  const { isUnlocked, userId } = useEncryptionStore();

  return useMemo(() => {
    // Check if user is signed in via either system
    const isSignedIn = isAuthenticated || isUnlocked;
    const isGuest = !isSignedIn;

    // Determine which auth method is active
    let authMethod: 'none' | 'legacy' | 'encryption' = 'none';
    if (isAuthenticated) authMethod = 'legacy';
    else if (isUnlocked) authMethod = 'encryption';

    // Build unified user object
    let user: UnifiedAuthState['user'] = null;
    
    if (legacyUser) {
      // Legacy auth system (email/password)
      const uId = legacyUser.id || 'unknown';
      user = {
        id: uId,
        email: legacyUser.email,
        displayName: legacyUser.displayName || (legacyUser.email ? legacyUser.email.split('@')[0] : `User ${uId.substring(0, 8)}`),
        is_verified: legacyUser.is_verified,
      };
    } else if (isUnlocked && userId) {
      // Encryption auth system (PIN/passphrase)
      const encId = userId || 'user';
      user = {
        id: encId,
        displayName: `User ${encId.substring(0, 8)}`,
      };
    }

    console.log('useAuthState:', {
      isSignedIn,
      isGuest,
      authMethod,
      user: user ? { id: user.id, displayName: user.displayName } : null,
      legacyAuth: isAuthenticated,
      encryptionAuth: isUnlocked,
    });

    return {
      isSignedIn,
      isGuest,
      user,
      authMethod,
    };
  }, [legacyUser, isAuthenticated, isUnlocked, userId]);
}
