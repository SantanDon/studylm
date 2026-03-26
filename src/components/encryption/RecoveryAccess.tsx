/**
 * Recovery Access Component
 * 
 * Allows users to recover account access using:
 * - Recovery key
 * - Backup phrase
 * - Email recovery (if configured)
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Key } from 'lucide-react';
import { ApiService } from '@/services/apiService';
import { useAuth } from '@/hooks/useAuth';

interface RecoveryAccessProps {
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function RecoveryAccess({ onSuccess, onCancel }: RecoveryAccessProps) {
  const [activeTab, setActiveTab] = useState('recovery-key');
  const [isRecovering, setIsRecovering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Recovery key state
  const [recoveryStep, setRecoveryStep] = useState<'request' | 'reset'>('request');
  const [displayName, setDisplayName] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassphrase, setNewPassphrase] = useState('');
  
  const { signIn } = useAuth();

  const handleRecoveryKeySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsRecovering(true);

    try {
      if (recoveryStep === 'request') {
        const res = await ApiService.recover(displayName, recoveryKey);
        setResetToken(res.resetToken);
        setSuccess('Recovery key verified!');
        setRecoveryStep('reset');
      } else {
        const res = await ApiService.resetPassphrase(resetToken, newPassphrase);
        const { user, accessToken, refreshToken } = res;
        signIn(user, {
           access_token: accessToken,
           refresh_token: refreshToken,
           expires_at: Date.now() + 60 * 60 * 1000,
           user
        });
        setSuccess('Passphrase reset successfully! Logging you in...');
        setTimeout(() => onSuccess?.(), 1500);
      }
    } catch (err: any) {
      setError(err.message || 'Recovery failed');
    } finally {
      setIsRecovering(false);
    }
  };
  return (
    <div className="w-full max-w-md mx-auto p-6 space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-semibold">Recover Your Account</h2>
        <p className="text-sm text-muted-foreground">
          Use your recovery key to reset your passphrase
        </p>
      </div>

      <div className="space-y-4">
        <form onSubmit={handleRecoveryKeySubmit} className="space-y-4">
            {recoveryStep === 'request' ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="rec-displayName">Display Name</Label>
                  <Input
                    id="rec-displayName"
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Enter your account name"
                    disabled={isRecovering}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="recovery-key">Recovery Key</Label>
                  <Input
                    id="recovery-key"
                    type="text"
                    value={recoveryKey}
                    onChange={(e) => setRecoveryKey(e.target.value)}
                    placeholder="Enter your 64-character recovery key"
                    disabled={isRecovering}
                    className="font-mono text-sm"
                  />
                </div>
              </>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="new-passphrase">New Passphrase</Label>
                <Input
                  id="new-passphrase"
                  type="password"
                  value={newPassphrase}
                  onChange={(e) => setNewPassphrase(e.target.value)}
                  placeholder="Minimum 8 characters"
                  disabled={isRecovering}
                  minLength={8}
                />
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={isRecovering || (recoveryStep === 'request' ? (!displayName || !recoveryKey) : newPassphrase.length < 8)}
            >
              {isRecovering ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : recoveryStep === 'request' ? (
                'Verify Recovery Key'
              ) : (
                'Set New Passphrase'
              )}
            </Button>
          </form>
        </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert>
          <AlertDescription className="text-green-600">{success}</AlertDescription>
        </Alert>
      )}

      {onCancel && (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={onCancel}
          disabled={isRecovering}
        >
          Back to Login
        </Button>
      )}
    </div>
  );
}
