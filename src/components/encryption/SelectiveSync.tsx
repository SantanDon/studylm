/**
 * Selective Sync Component
 * 
 * Allows users to choose which notebooks to sync to the cloud
 */

import { useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Cloud, CloudOff, BookOpen, Loader2 } from 'lucide-react';

interface Notebook {
  id: string;
  title: string;
  size: number;
  lastModified: Date;
  syncEnabled: boolean;
}

export function SelectiveSync() {

  const updateSyncConfig = async (config: Record<string, boolean>) => {
    // Store sync config in localStorage
    localStorage.setItem('sync_config', JSON.stringify(config));
  };
  
  const triggerSync = async () => {
    // Trigger sync logic
    console.log('Sync triggered');
  };
  const [notebooks, setNotebooks] = useState<Notebook[]>([
    // This would be loaded from actual notebook data
    {
      id: '1',
      title: 'Study Notes',
      size: 1024 * 500, // 500 KB
      lastModified: new Date(),
      syncEnabled: true,
    },
    {
      id: '2',
      title: 'Research Papers',
      size: 1024 * 1024 * 2, // 2 MB
      lastModified: new Date(Date.now() - 86400000),
      syncEnabled: true,
    },
  ]);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const handleToggleSync = (notebookId: string) => {
    setNotebooks((prev) =>
      prev.map((nb) =>
        nb.id === notebookId ? { ...nb, syncEnabled: !nb.syncEnabled } : nb
      )
    );
    setHasChanges(true);
  };

  const handleSaveChanges = async () => {
    setIsSaving(true);
    try {
      // Update sync configuration
      const syncConfig = notebooks.reduce((acc, nb) => {
        acc[nb.id] = nb.syncEnabled;
        return acc;
      }, {} as Record<string, boolean>);

      await updateSyncConfig(syncConfig);
      
      // Trigger sync for newly enabled notebooks
      await triggerSync();
      
      setHasChanges(false);
    } catch (error) {
      console.error('Failed to save sync settings:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  const totalSize = notebooks.reduce((sum, nb) => sum + nb.size, 0);
  const syncedSize = notebooks
    .filter((nb) => nb.syncEnabled)
    .reduce((sum, nb) => sum + nb.size, 0);
  const syncedCount = notebooks.filter((nb) => nb.syncEnabled).length;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-2">Selective Sync</h3>
        <p className="text-sm text-muted-foreground">
          Choose which notebooks to sync to the cloud. Disabled notebooks remain local only.
        </p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-4">
        <div className="p-4 border rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Cloud className="w-4 h-4 text-blue-500" />
            <span className="text-sm font-medium">Synced</span>
          </div>
          <div className="text-2xl font-bold">{syncedCount}</div>
          <div className="text-xs text-muted-foreground mt-1">
            {formatBytes(syncedSize)}
          </div>
        </div>

        <div className="p-4 border rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <CloudOff className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">Local Only</span>
          </div>
          <div className="text-2xl font-bold">{notebooks.length - syncedCount}</div>
          <div className="text-xs text-muted-foreground mt-1">
            {formatBytes(totalSize - syncedSize)}
          </div>
        </div>
      </div>

      {/* Notebook List */}
      <div className="space-y-2">
        {notebooks.map((notebook) => (
          <div
            key={notebook.id}
            className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center gap-3 flex-1">
              <BookOpen className="w-5 h-5 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="font-medium truncate">{notebook.title}</h4>
                  {notebook.syncEnabled ? (
                    <Badge variant="secondary" className="text-xs">
                      <Cloud className="w-3 h-3 mr-1" />
                      Synced
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs">
                      <CloudOff className="w-3 h-3 mr-1" />
                      Local
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {formatBytes(notebook.size)} • Modified{' '}
                  {notebook.lastModified.toLocaleDateString()}
                </p>
              </div>
            </div>

            <Switch
              checked={notebook.syncEnabled}
              onCheckedChange={() => handleToggleSync(notebook.id)}
              aria-label={`Toggle sync for ${notebook.title}`}
            />
          </div>
        ))}
      </div>

      {notebooks.length === 0 && (
        <Alert>
          <AlertDescription>
            No notebooks found. Create a notebook to start syncing.
          </AlertDescription>
        </Alert>
      )}

      {/* Save Changes */}
      {hasChanges && (
        <div className="flex items-center justify-between p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
          <p className="text-sm text-blue-600">You have unsaved changes</p>
          <Button onClick={handleSaveChanges} disabled={isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              'Save Changes'
            )}
          </Button>
        </div>
      )}

      {/* Info */}
      <Alert>
        <AlertDescription className="text-xs">
          <strong>Note:</strong> Disabling sync for a notebook will keep it on your device only.
          Previously synced data will remain in the cloud until manually deleted.
        </AlertDescription>
      </Alert>
    </div>
  );
}
