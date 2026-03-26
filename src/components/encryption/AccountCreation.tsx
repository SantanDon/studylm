/**
 * Account Creation Component
 * 
 * Allows users to create encrypted account with PIN/passphrase.
 * Generates and displays recovery key for backup.
 */

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle, Copy, Eye, EyeOff, Download } from 'lucide-react';
import { generateKeyFromPassphrase, exportSalt } from '@/lib/encryption/keyDerivation';
import { generateRecoveryKey, formatRecoveryKey, storeRecoveryKeyHash, hashRecoveryKey } from '@/lib/recovery/recoveryKey';
import { useEncryptionStore } from '@/stores/encryptionStore';
import { UserStorage, setCurrentUserId } from '@/lib/encryption/userStorage';
import { encrypt } from '@/lib/encryption/encryption';
import { ApiService } from '@/services/apiService';
import { useAuth } from '@/hooks/useAuth';

export default function AccountCreation() {
  const [step, setStep] = useState<'passphrase' | 'recovery' | 'confirm'>('passphrase');
  const [displayName, setDisplayName] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState('');
  const [recoveryConfirmed, setRecoveryConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [authData, setAuthData] = useState<{ user: any; accessToken: string; refreshToken: string; userId: string; key: CryptoKey; salt: ArrayBuffer } | null>(null);
  
  const { toast } = useToast();
  const navigate = useNavigate();
  const { setMasterKey } = useEncryptionStore();
  const { signIn } = useAuth();

  const validateInput = (): string | null => {
    if (!displayName || displayName.length < 3) {
      return 'Display Name must be at least 3 characters';
    }
    if (passphrase.length < 8) {
      return 'Passphrase must be at least 8 characters';
    }
    if (passphrase !== confirmPassphrase) {
      return 'Passphrases do not match';
    }
    return null;
  };

  const handleCreateAccount = async () => {
    const error = validateInput();
    if (error) {
      toast({
        title: 'Invalid Passphrase',
        description: error,
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      // Generate recovery key and hash
      const newRecoveryKey = generateRecoveryKey();
      setRecoveryKey(newRecoveryKey);
      const hash = await hashRecoveryKey(newRecoveryKey);

      // Register with the backend API
      const apiResponse = await ApiService.signup({ 
        displayName, 
        passphrase, 
        recovery_key_hash: hash 
      });
      
      const { user, accessToken, refreshToken } = apiResponse;
      const userId = user.id;

      // Generate local encryption key
      const { key, salt } = await generateKeyFromPassphrase(passphrase);
      
      // Create user-namespaced storage
      const storage = new UserStorage(userId);
      
      // Store encryption salt with user namespace
      storage.set('encryption_salt', exportSalt(salt));
      
      // Store account creation timestamp
      storage.set('created_at', new Date().toISOString());
      
      // Store a test encrypted value to verify passphrase later
      const testData = await encrypt('test', key);
      storage.set('encryption_test', JSON.stringify(testData));
      
      // Store recovery key hash with user namespace (legacy local tracking)
      storeRecoveryKeyHash(userId, hash);
      
      // Store auth data to be applied after recovery key confirmation
      setAuthData({ user, accessToken, refreshToken, userId, key, salt });
      
      // Move to recovery key display
      setStep('recovery');
    } catch (error) {
      toast({
        title: 'Account Creation Failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const copyRecoveryKey = () => {
    navigator.clipboard.writeText(recoveryKey);
    toast({
      title: 'Copied!',
      description: 'Recovery key copied to clipboard',
    });
  };

  const handleDownloadRecoveryKey = () => {
    const blob = new Blob([
      `StudyPodLM Recovery Key\n\n` +
      `Display Name: ${displayName}\n` +
      `Recovery Key: ${formatRecoveryKey(recoveryKey)}\n\n` +
      `Keep this safe! You'll need it to recover your account if you forget your passphrase.\n` +
      `Go to the login screen -> "Forgot your passphrase or need to recover?"`
    ], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `studylm-recovery-${displayName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleConfirmRecovery = () => {
    if (!recoveryConfirmed) {
      toast({
        title: 'Confirmation Required',
        description: 'Please confirm you have saved your recovery key',
        variant: 'destructive',
      });
      return;
    }
    
    // Apply auth context ONLY after recovery key is saved
    if (authData) {
      signIn(authData.user, {
        access_token: authData.accessToken,
        refresh_token: authData.refreshToken,
        expires_at: Date.now() + 60 * 60 * 1000,
        user: authData.user
      });
      setCurrentUserId(authData.userId);
      setMasterKey(authData.key, authData.salt, authData.userId);
    }
    
    // Navigate to dashboard
    navigate('/');
    toast({
      title: 'Account Created!',
      description: 'Your encrypted account is ready to use',
    });
  };

  if (step === 'passphrase') {
    return (
      <Card className="w-full max-w-md mx-auto">
        <CardHeader>
          <CardTitle>Create Encrypted Account</CardTitle>
          <CardDescription>
            Choose a strong passphrase to protect your data
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Your passphrase encrypts all your data. Without it or your recovery key, your data cannot be accessed.
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Label htmlFor="displayName">Display Name</Label>
            <Input
              id="displayName"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. SantanDon"
              minLength={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="passphrase">Passphrase</Label>
            <div className="relative">
              <Input
                id="passphrase"
                type={showPassphrase ? 'text' : 'password'}
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Enter a strong passphrase"
                minLength={8}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3"
                onClick={() => setShowPassphrase(!showPassphrase)}
              >
                {showPassphrase ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm">Confirm Passphrase</Label>
            <Input
              id="confirm"
              type={showPassphrase ? 'text' : 'password'}
              value={confirmPassphrase}
              onChange={(e) => setConfirmPassphrase(e.target.value)}
              placeholder="Re-enter your passphrase"
              minLength={8}
            />
          </div>

          <Button
            onClick={handleCreateAccount}
            disabled={loading || !passphrase || !confirmPassphrase || !displayName}
            className="w-full"
          >
            {loading ? 'Creating Account...' : 'Create Account'}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (step === 'recovery') {
    return (
      <Card className="w-full max-w-md mx-auto">
        <CardHeader>
          <CardTitle>Save Your Recovery Key</CardTitle>
          <CardDescription>
            This key allows you to recover your account if you forget your passphrase
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              This recovery key will only be shown once. Save it in a secure location!
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Label>Recovery Key</Label>
            <div className="p-4 bg-muted rounded-md font-mono text-sm break-all">
              {formatRecoveryKey(recoveryKey)}
            </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={copyRecoveryKey}
              className="flex-1"
            >
              <Copy className="h-4 w-4 mr-2" />
              Copy Key
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadRecoveryKey}
              className="flex-1"
            >
              <Download className="h-4 w-4 mr-2" />
              Download
            </Button>
          </div>
          </div>

          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="confirm-saved"
              checked={recoveryConfirmed}
              onChange={(e) => setRecoveryConfirmed(e.target.checked)}
              className="rounded"
            />
            <Label htmlFor="confirm-saved" className="text-sm cursor-pointer">
              I have saved my recovery key in a secure location
            </Label>
          </div>

          <Button
            onClick={handleConfirmRecovery}
            disabled={!recoveryConfirmed}
            className="w-full"
          >
            <CheckCircle className="h-4 w-4 mr-2" />
            Continue to Dashboard
          </Button>
        </CardContent>
      </Card>
    );
  }

  return null;
}
