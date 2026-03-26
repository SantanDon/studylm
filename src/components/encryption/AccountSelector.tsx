import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { Users, Lock, Plus, Eye, EyeOff, Trash2, Loader2 } from 'lucide-react';
import { listAllUserIds, getUserMetadata, UserStorage, deleteUser } from '@/lib/encryption/userStorage';
import { deriveMasterKey } from '@/lib/encryption/keyDerivation';
import { decrypt } from '@/lib/encryption/encryption';
import { base64ToArrayBuffer } from '@/lib/encryption/utils';
import { useAuth } from '@/hooks/useAuth';
import { ApiService } from '@/services/apiService';
import { useNavigate } from 'react-router-dom';

interface AccountInfo {
  userId: string;
  hasEncryption: boolean;
  createdAt?: string;
  isLocked: boolean;
}

interface AccountSelectorProps {
  onAccountSelected: (userId: string) => void;
}

interface AccountSelectorProps {
  onAccountSelected: (userId: string) => void;
}

export function AccountSelector({ onAccountSelected }: AccountSelectorProps) {
  const MAX_ACCOUNTS = 5;
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [testingAccount, setTestingAccount] = useState<string | null>(null);
  const [testPassphrase, setTestPassphrase] = useState('');
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  
  // API Sign-in states
  const [displayName, setDisplayName] = useState('');
  const [apiPassphrase, setApiPassphrase] = useState('');
  const [showApiPassphrase, setShowApiPassphrase] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  
  const { toast } = useToast();
  const { signIn } = useAuth();
  const navigate = useNavigate();

  const loadAccounts = () => {
    const userIds = listAllUserIds();
    const accountList = userIds.map(userId => ({
      userId,
      ...getUserMetadata(userId),
      isLocked: true,
    }));
    setAccounts(accountList);
  };

  useEffect(() => {
    loadAccounts();
  }, []);

  const handleTestPassphrase = async (userId: string) => {
    if (!testPassphrase) {
      toast({
        title: 'Passphrase Required',
        description: 'Please enter a passphrase to test',
        variant: 'destructive',
      });
      return;
    }

    setIsVerifying(true);

    try {
      // Try to derive key and decrypt test value
      const storage = new UserStorage(userId);
      const saltBase64 = storage.get('encryption_salt');
      
      if (!saltBase64) {
        throw new Error('No encryption data found for this account');
      }

      const salt = base64ToArrayBuffer(saltBase64);
      const key = await deriveMasterKey(testPassphrase, new Uint8Array(salt));
      
      // Try to decrypt test value
      const testValue = storage.get('encryption_test');
      if (testValue) {
        const encryptedData = JSON.parse(testValue);
        await decrypt(encryptedData, key);
      }
      
      // Success - this is the correct account
      toast({
        title: 'Account Identified!',
        description: 'Passphrase matches this account',
      });
      
      // Clear passphrase and select account
      setTestPassphrase('');
      setTestingAccount(null);
      onAccountSelected(userId);
    } catch (error) {
      toast({
        title: 'Incorrect Passphrase',
        description: 'This passphrase does not match this account',
        variant: 'destructive',
      });
    } finally {
      setIsVerifying(false);
    }
  };

  const handleCreateNew = () => {
    onAccountSelected('new');
  };

  const handleUnlockClick = (userId: string) => {
    setTestingAccount(userId);
    setTestPassphrase('');
  };

  const handleCancelTest = () => {
    setTestingAccount(null);
    setTestPassphrase('');
  };

  const handleDeleteAccount = (userId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm("Are you sure you want to remove this account? All encrypted data linked to it on this device will be permanently lost.")) {
      deleteUser(userId);
      toast({
        title: 'Account Removed',
        description: 'The account and its data have been securely erased from this device.',
      });
      loadAccounts();
    }
  };

  const handleApiSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName || !apiPassphrase) {
      toast({
        title: 'Sign In Failed',
        description: 'Please enter both Display Name and Passphrase.',
        variant: 'destructive',
      });
      return;
    }
    
    setIsSigningIn(true);
    try {
      const res = await ApiService.signin({ displayName, passphrase: apiPassphrase });
      const user = res.user;
      const session = {
        access_token: res.accessToken,
        refresh_token: res.refreshToken,
        expires_at: Date.now() + 60 * 60 * 1000,
        user: user,
      };
      signIn(user, session);
      toast({
        title: "Welcome back!",
        description: `Successfully signed in as ${user.displayName || user.email}`,
      });
      navigate("/", { replace: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Invalid display name or passphrase';
      toast({
        title: 'Sign In Error',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsSigningIn(false);
    }
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <div className="flex items-center justify-center mb-2">
          <div className="p-3 bg-primary/10 rounded-full">
            <Users className="w-8 h-8 text-primary" />
          </div>
        </div>
        <CardTitle className="text-center">Select Account</CardTitle>
        <CardDescription className="text-center">
          {accounts.length} account(s) found on this device
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handleApiSignIn} className="space-y-4 pb-4">
          <div className="space-y-2">
            <Label htmlFor="api_displayName">Display Name</Label>
            <Input
              id="api_displayName"
              placeholder="e.g. SantanDon"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={isSigningIn}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="api_passphrase">Passphrase</Label>
            <div className="relative">
              <Input
                id="api_passphrase"
                type={showApiPassphrase ? 'text' : 'password'}
                placeholder="Enter your passphrase"
                value={apiPassphrase}
                onChange={(e) => setApiPassphrase(e.target.value)}
                disabled={isSigningIn}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowApiPassphrase(!showApiPassphrase)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                tabIndex={-1}
              >
                {showApiPassphrase ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <Button type="submit" className="w-full" disabled={isSigningIn || !displayName || !apiPassphrase}>
            {isSigningIn ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Signing in...
              </>
            ) : (
              'Sign In'
            )}
          </Button>
          <div className="text-center pt-2">
             <Button variant="link" size="sm" type="button" onClick={() => navigate('/auth?mode=recover')}>
                Forgot your passphrase or need to recover?
             </Button>
          </div>
        </form>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-2 text-muted-foreground">
              Or local device accounts
            </span>
          </div>
        </div>

        {accounts.length === 0 && (
          <Alert>
            <AlertDescription>
              No local accounts found. You can create a new cloud/local account below.
            </AlertDescription>
          </Alert>
        )}

        {accounts.map((account) => (
          <div key={account.userId} className="border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-muted-foreground" />
                  <p className="font-mono text-sm font-medium">
                    {account.userId.slice(0, 8)}...
                  </p>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={(e) => handleDeleteAccount(account.userId, e)}
                    title="Remove account from device"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
                {account.createdAt && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Created: {new Date(account.createdAt).toLocaleDateString()}
                  </p>
                )}
              </div>
              {testingAccount !== account.userId && (
                <Button
                  size="sm"
                  onClick={() => handleUnlockClick(account.userId)}
                >
                  Unlock
                </Button>
              )}
            </div>
            
            {testingAccount === account.userId && (
              <div className="space-y-3 pt-2 border-t">
                <p className="text-sm text-muted-foreground">
                  Enter your passphrase to identify this account
                </p>
                <div className="relative">
                  <Input
                    type={showPassphrase ? 'text' : 'password'}
                    placeholder="Enter passphrase"
                    value={testPassphrase}
                    onChange={(e) => setTestPassphrase(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleTestPassphrase(account.userId);
                      }
                    }}
                    disabled={isVerifying}
                    autoFocus
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassphrase(!showPassphrase)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showPassphrase ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => handleTestPassphrase(account.userId)}
                    disabled={isVerifying || !testPassphrase}
                    className="flex-1"
                  >
                    {isVerifying ? 'Verifying...' : 'Test Passphrase'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleCancelTest}
                    disabled={isVerifying}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
        
        {accounts.length < MAX_ACCOUNTS ? (
          <Button
            variant="outline"
            className="w-full"
            onClick={handleCreateNew}
          >
            <Plus className="w-4 h-4 mr-2" />
            Create New Account
          </Button>
        ) : (
          <Alert>
            <AlertDescription className="text-center text-muted-foreground">
              Maximum account limit ({MAX_ACCOUNTS}) reached for this device.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
