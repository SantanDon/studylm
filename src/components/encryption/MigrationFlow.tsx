import { useState, useEffect } from 'react';
import { useEncryptionStore } from '@/stores/encryptionStore';
import { UserStorage } from '@/lib/encryption/userStorage';
import { getSyncManager } from '@/lib/sync/syncManager';
import { encrypt } from '@/lib/encryption/encryption';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, CheckCircle } from 'lucide-react';

interface MigrationFlowProps {
  onComplete: () => void;
}

const LEGACY_KEYS = ['notebooks', 'sources', 'flashcards', 'settings'];

export function MigrationFlow({ onComplete }: MigrationFlowProps) {
  const [step, setStep] = useState<'detect' | 'confirm' | 'migrating' | 'complete'>('detect');
  const [dataToMigrate, setDataToMigrate] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const detectLegacyData = (): string[] => {
      return LEGACY_KEYS.filter(key => !!localStorage.getItem(key));
    };

    const legacyKeys = detectLegacyData();
    setDataToMigrate(legacyKeys);

    if (legacyKeys.length > 0) {
      setStep('confirm');
    } else {
      setStep('complete');
      onComplete();
    }
  }, [onComplete]);

  const handleMigrate = async () => {
    setStep('migrating');
    setErrorMsg(null);

    const { masterKey, userId } = useEncryptionStore.getState();

    if (!userId) {
      // No user context at all — skip migration silently and continue
      setStep('complete');
      return;
    }

    const storage = new UserStorage(userId);
    const syncManager = getSyncManager();

    for (let i = 0; i < dataToMigrate.length; i++) {
      const key = dataToMigrate[i];
      const rawData = localStorage.getItem(key);

      if (rawData) {
        try {
          if (masterKey) {
            // ── E2EE mode: encrypt then store ─────────────────────────────
            const encrypted = await encrypt(rawData, masterKey);
            storage.set(key, JSON.stringify(encrypted));
          } else {
            // ── Plaintext/cloud mode: store as-is in namespaced storage ───
            storage.set(key, rawData);
          }

          // Queue for cloud sync regardless of mode
          try {
            const parsedData = JSON.parse(rawData);
            await syncManager.queueSync(
              key,
              key as 'notebook' | 'source' | 'note' | 'chat',
              parsedData,
              'update'
            );
          } catch {
            // If the raw value wasn't valid JSON, still try syncing the string
            await syncManager.queueSync(key, key, rawData, 'update');
          }

          // Remove legacy unnamespaced key after successful migration
          localStorage.removeItem(key);
        } catch (err) {
          console.error(`Migration error for key "${key}":`, err);
          setErrorMsg(
            `Failed to migrate "${key}". Your data has not been lost — try again or skip.`
          );
          // Don't remove key on failure
        }
      }

      setProgress(((i + 1) / dataToMigrate.length) * 100);
    }

    setStep('complete');
  };

  const handleSkip = () => {
    onComplete();
  };

  if (step === 'detect') {
    return null;
  }

  if (step === 'confirm') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Migrate Existing Data</CardTitle>
          <CardDescription>
            We found {dataToMigrate.length} item{dataToMigrate.length !== 1 ? 's' : ''} that need to be moved to your account storage
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="ml-2">
              Your existing local data will be moved to your account namespace and queued for cloud sync.
              Original unnamespaced keys will be cleaned up after migration.
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <p className="text-sm font-medium">Data to migrate:</p>
            <ul className="text-sm text-muted-foreground list-disc list-inside">
              {dataToMigrate.map(key => (
                <li key={key}>{key}</li>
              ))}
            </ul>
          </div>

          <div className="flex gap-2">
            <Button onClick={handleMigrate} className="flex-1">
              Start Migration
            </Button>
            <Button variant="outline" onClick={handleSkip} className="flex-1">
              Skip
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (step === 'migrating') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Migrating Data…</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="w-full bg-secondary rounded-full h-2">
              <div
                className="bg-primary h-2 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-sm text-center text-muted-foreground">
              {Math.round(progress)}% complete
            </p>
            {errorMsg && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="ml-2">{errorMsg}</AlertDescription>
              </Alert>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (step === 'complete') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Migration Complete</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <CheckCircle className="h-4 w-4" />
            <AlertDescription className="ml-2">
              Your data has been moved to your account storage and queued for cloud sync.
            </AlertDescription>
          </Alert>

          <Button onClick={onComplete} className="w-full">
            Continue
          </Button>
        </CardContent>
      </Card>
    );
  }

  return null;
}
