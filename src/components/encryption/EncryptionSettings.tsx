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
import { MfaSettings } from './MfaSettings';
import { DeveloperSettings } from '../settings/DeveloperSettings';
import { ChatGPTSettings } from '../settings/ChatGPTSettings';
import { Shield, Cloud, Download, ScrollText, Code2, Sparkles } from 'lucide-react';

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
        <TabsList className="grid w-full grid-cols-7">
          <TabsTrigger value="sync" className="flex items-center gap-2">
            <Cloud className="w-4 h-4" />
            <span className="hidden sm:inline">Sync</span>
          </TabsTrigger>
          <TabsTrigger value="security" className="flex items-center gap-2">
            <Shield className="w-4 h-4" />
            <span className="hidden sm:inline">Security</span>
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
          <TabsTrigger value="models" className="flex items-center gap-2">
            <Sparkles className="w-4 h-4" />
            <span className="hidden sm:inline">Models</span>
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

        <TabsContent value="security" className="space-y-6">
          <MfaSettings />
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

        <TabsContent value="models" className="space-y-6">
          <ChatGPTSettings />
        </TabsContent>

      </Tabs>

      {/* Privacy Notice */}
      <div className="mt-8 p-4 bg-muted rounded-lg">
        <h3 className="font-semibold mb-2 flex items-center gap-2">
          <Shield className="w-5 h-5" />
          Your Privacy is Protected
        </h3>
        <ul className="text-sm text-muted-foreground space-y-1">
          <li>Local mode keeps notebook data in this browser</li>
          <li>Encrypted sync protects synced payloads before storage</li>
          <li>Agent access is controlled by scoped, revocable StudyPodLM API keys</li>
          <li>Source extraction and AI answers may use StudyPodLM backend services</li>
        </ul>
        <div className="mt-3 flex gap-3 text-xs">
          <a href="/privacy" className="text-primary underline">Privacy</a>
          <a href="/terms" className="text-primary underline">Terms</a>
        </div>
      </div>
    </div>
  );
}
