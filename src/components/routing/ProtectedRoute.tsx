/**
 * ProtectedRoute Component
 * 
 * Wrapper component that enforces authentication before accessing protected routes.
 * If the user is not unlocked (authenticated), shows the EncryptionFlow.
 * Once unlocked, renders the protected content.
 */

import { useState } from 'react';
import { useEncryptionStore } from '@/stores/encryptionStore';
import { useAuth } from '@/hooks/useAuth';
import { EncryptionFlow } from '@/components/encryption/EncryptionFlow';
import { listAllUserIds } from '@/lib/encryption/userStorage';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isUnlocked } = useEncryptionStore();
  const { session } = useAuth();
  
  const isFullyUnlocked = isUnlocked || !!session?.access_token;

  // Only show the encryption flow by default if the user is not unlocked AND has existing profiles
  const [showEncryption, setShowEncryption] = useState(() => {
    const userIds = listAllUserIds();
    return !isFullyUnlocked && userIds.length > 0;
  });

  // If not unlocked and encryption flow is visible, show EncryptionFlow
  if (!isFullyUnlocked && showEncryption) {
    return (
      <EncryptionFlow 
        onUnlocked={() => setShowEncryption(false)} 
      />
    );
  }

  // User is unlocked, render protected content
  return <>{children}</>;
}
