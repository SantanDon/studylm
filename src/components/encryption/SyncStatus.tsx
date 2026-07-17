/**
 * Sync Status Component
 * 
 * Displays current sync status, pending operations, and storage usage
 */

import { useSyncStore } from '@/stores/syncStore';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Cloud,
  CloudOff,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Loader2,
  HardDrive,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

export function SyncStatus() {
  const isOnline = useOnlineStatus();
  const {
    isSyncing,
    pendingOperations,
    lastSyncTime,
    error,
  } = useSyncStore();

  // Mock storage data - would be implemented in actual storage integration
  const storageUsed = 0;
  const storageLimit = 5 * 1024 * 1024 * 1024; // 5GB

  const triggerSync = () => {
    // Trigger sync logic would go here
    console.log('Sync triggered');
  };

  const status = isSyncing ? 'syncing' : error ? 'error' : pendingOperations > 0 ? 'pending' : 'synced';

  const storagePercentage = storageLimit > 0 ? (storageUsed / storageLimit) * 100 : 0;

  const getStatusIcon = () => {
    if (!isOnline) {
      return <CloudOff className="w-4 h-4 text-muted-foreground" />;
    }

    switch (status) {
      case 'syncing':
        return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
      case 'synced':
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-red-500" />;
      default:
        return <Cloud className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getStatusText = () => {
    if (!isOnline) {
      return 'Offline';
    }

    switch (status) {
      case 'syncing':
        return 'Syncing...';
      case 'synced':
        return 'All changes synced';
      case 'error':
        return 'Sync error';
      default:
        return 'Ready to sync';
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  return (
    <div className="space-y-4 p-4 border rounded-lg">
      {/* Status Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {getStatusIcon()}
          <span className="text-sm font-medium">{getStatusText()}</span>
        </div>
        
        <div className="flex items-center gap-2">
          {pendingOperations > 0 && (
            <Badge variant="secondary" className="text-xs">
              {pendingOperations} pending
            </Badge>
          )}
          
          <Button
            size="sm"
            variant="ghost"
            onClick={triggerSync}
            disabled={!isOnline || status === 'syncing'}
          >
            <RefreshCw className={`w-4 h-4 ${status === 'syncing' ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Last Sync Time */}
      {lastSyncTime && (
        <div className="text-xs text-muted-foreground">
          Last synced {formatDistanceToNow(new Date(lastSyncTime), { addSuffix: true })}
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-md">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-500 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm text-red-500 font-medium">Sync Error</p>
              <p className="text-xs text-red-500/80 mt-1">{error}</p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="mt-2 w-full"
            onClick={triggerSync}
            disabled={!isOnline}
          >
            Retry
          </Button>
        </div>
      )}

      {/* Storage Usage */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-muted-foreground" />
            <span className="text-muted-foreground">Storage</span>
          </div>
          <span className="font-medium">
            {formatBytes(storageUsed)} / {formatBytes(storageLimit)}
          </span>
        </div>
        
        <Progress value={storagePercentage} className="h-2" />
        
        {storagePercentage > 80 && (
          <p className="text-xs text-amber-500">
            Storage is {storagePercentage.toFixed(0)}% full
          </p>
        )}
      </div>

      {/* Offline Notice */}
      {!isOnline && (
        <div className="p-3 bg-muted rounded-md">
          <div className="flex items-start gap-2">
            <CloudOff className="w-4 h-4 text-muted-foreground mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium">Working Offline</p>
              <p className="text-xs text-muted-foreground mt-1">
                Changes will sync when you're back online
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Sync Queue Info */}
      {pendingOperations > 0 && (
        <div className="text-xs text-muted-foreground">
          {pendingOperations} {pendingOperations === 1 ? 'change' : 'changes'} waiting to sync
        </div>
      )}
    </div>
  );
}
