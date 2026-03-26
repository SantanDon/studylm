/**
 * Encryption Settings Component
 * 
 * Provides a settings page for managing encryption, sync, and security features.
 */

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SyncStatus } from './SyncStatus';
import { SelectiveSync } from './SelectiveSync';
import { DataExport } from './DataExport';
import { SecurityLogs } from './SecurityLogs';
import { DeveloperSettings } from '../settings/DeveloperSettings';
import { Shield, Cloud, Download, ScrollText, Code2 } from 'lucide-react';

export function EncryptionSettings() {
  const [activeTab, setActiveTab] = useState('sync');

  return (
    <div className="container mx-auto py-8 px-4 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Settings</h1>
        <p className="text-muted-foreground">
          Manage your account, encryption, and agent connections.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="sync" className="flex items-center gap-2">
            <Cloud className="w-4 h-4" />
            <span className="hidden sm:inline">Sync</span>
          </TabsTrigger>
          <TabsTrigger value="selective" className="flex items-center gap-2">
            <Shield className="w-4 h-4" />
            <span className="hidden sm:inline">Selective</span>
          </TabsTrigger>
          <TabsTrigger value="backup" className="flex items-center gap-2">
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Backup</span>
          </TabsTrigger>
          <TabsTrigger value="logs" className="flex items-center gap-2">
            <ScrollText className="w-4 h-4" />
            <span className="hidden sm:inline">Logs</span>
          </TabsTrigger>
          <TabsTrigger value="developer" className="flex items-center gap-2">
            <Code2 className="w-4 h-4" />
            <span className="hidden sm:inline">Developer</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sync" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Sync Status</CardTitle>
              <CardDescription>
                Monitor your encrypted cloud sync status and manage sync operations
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SyncStatus />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="selective" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Selective Sync</CardTitle>
              <CardDescription>
                Choose which notebooks to sync to the cloud
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SelectiveSync />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="backup" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Data Backup & Export</CardTitle>
              <CardDescription>
                Export your data for backup or import from a previous backup
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DataExport />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Security Logs</CardTitle>
              <CardDescription>
                View authentication, encryption, and sync events
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SecurityLogs />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="developer" className="space-y-6">
          <DeveloperSettings />
        </TabsContent>
      </Tabs>

      {/* Privacy Notice */}
      <div className="mt-8 p-4 bg-muted rounded-lg">
        <h3 className="font-semibold mb-2 flex items-center gap-2">
          <Shield className="w-5 h-5" />
          Your Privacy is Protected
        </h3>
        <ul className="text-sm text-muted-foreground space-y-1">
          <li>• All data is encrypted on your device before syncing</li>
          <li>• Your passphrase never leaves your device</li>
          <li>• The server only stores encrypted data it cannot read</li>
          <li>• You have full control over what gets synced</li>
        </ul>
      </div>
    </div>
  );
}
