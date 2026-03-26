import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import VisualEffectsSettings from '@/components/settings/VisualEffectsSettings';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useAuth } from '@/hooks/useAuth';
import { useAuthState } from '@/hooks/useAuthState';
import { useTheme } from '@/hooks/useTheme';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { localStorageService } from '@/services/localStorageService';
import { useQueryClient } from '@tanstack/react-query';
import { useEncryptionStore } from '@/stores/encryptionStore';
import { DeveloperSettings } from '@/components/settings/DeveloperSettings';

// Add proper accessibility descriptions for dialogs
const DIALOG_DESCRIPTIONS = {
  settings: "Manage your account settings and preferences including theme and storage usage",
  dataManagement: "Export, import, or clear your local data including notebooks, sources, and chat history",
  about: "View information about the application including version and credits"
};

export function ProfileMenu() {
  const { signOut } = useAuth();
  const { isSignedIn, isGuest, user, authMethod } = useAuthState();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { clearMasterKey } = useEncryptionStore();
  const [showSettings, setShowSettings] = useState(false);
  const [showAgentPairing, setShowAgentPairing] = useState(false);
  const [showDataManagement, setShowDataManagement] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showVisualEffects, setShowVisualEffects] = useState(false);
  const [customName, setCustomName] = useState(() => localStorage.getItem('user_custom_name') || '');

  // User display
  const savedCustomName = !isGuest ? localStorage.getItem('user_custom_name') : null;
  const userInitials = isGuest ? 'G' : (savedCustomName || user?.displayName)?.substring(0, 2).toUpperCase() || 'G';
  const displayName = isGuest ? 'Guest' : (savedCustomName || user?.displayName || 'Guest');
  
  // Fix: Use unified auth state to determine status
  const displayEmail = isSignedIn 
    ? (user?.email || `Signed in (${authMethod === 'encryption' ? 'PIN/Passphrase' : 'Email'})`)
    : 'Not signed in';
  
  const isEmailVerified = user?.is_verified !== 0; // if undefined, assume verified (local mode)

  console.log('ProfileMenu render:', { isSignedIn, user, authMethod, displayEmail, isEmailVerified });

  const handleSignOut = async () => {
    try {
      console.log('Sign out initiated, auth method:', authMethod);
      
      // Step 1: Clear encryption state first (synchronous)
      clearMasterKey();
      console.log('Encryption state cleared');
      
      // Step 2: Sign out from legacy auth (async)
      await signOut();
      console.log('Legacy auth cleared');
      
      // Step 3: Clear all React Query cache (after auth cleared)
      queryClient.clear();
      console.log('Query cache cleared');
      
      console.log('Sign out completed successfully');
      
      toast({
        title: 'Signed out',
        description: 'You have been signed out successfully.',
      });
      
      // Step 4: Navigate to auth page (use setTimeout to ensure state is fully cleared)
      setTimeout(() => {
        navigate("/auth", { replace: true });
      }, 100);
    } catch (error) {
      console.error('Sign out error:', error);
      toast({
        title: 'Sign out failed',
        description: 'Failed to sign out. Please try again.',
        variant: 'destructive',
      });
    }
  };

  const handleSignIn = () => {
    console.log('Sign in clicked');
    navigate('/auth');
  };

  const handleSaveCustomName = () => {
    if (customName.trim()) {
      localStorage.setItem('user_custom_name', customName.trim());
      toast({
        title: 'Name updated',
        description: 'Your display name has been updated successfully.',
      });
      setShowSettings(false);
      // Force re-render by updating state
      window.location.reload();
    }
  };
  const handleExportData = () => {
    try {
      const data = {
        notebooks: localStorage.getItem('notebooks'),
        sources: localStorage.getItem('sources'),
        notes: localStorage.getItem('notes'),
        chat_messages: localStorage.getItem('chat_messages'),
        exportedAt: new Date().toISOString(),
      };

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `studylm-backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: 'Data exported',
        description: 'Your data has been exported successfully.',
      });
    } catch (error) {
      toast({
        title: 'Export failed',
        description: 'Failed to export data. Please try again.',
        variant: 'destructive',
      });
    }
  };

  const handleImportData = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const data = JSON.parse(text);

        if (data.notebooks) localStorage.setItem('notebooks', data.notebooks);
        if (data.sources) localStorage.setItem('sources', data.sources);
        if (data.notes) localStorage.setItem('notes', data.notes);
        if (data.chat_messages) localStorage.setItem('chat_messages', data.chat_messages);

        toast({
          title: 'Data imported',
          description: 'Your data has been imported successfully. Refreshing...',
        });

        setTimeout(() => window.location.reload(), 1000);
      } catch (error) {
        toast({
          title: 'Import failed',
          description: 'Failed to import data. Please check the file format.',
          variant: 'destructive',
        });
      }
    };
    input.click();
  };

  const handleClearData = () => {
    if (confirm('Are you sure you want to clear all data? This cannot be undone.')) {
      localStorage.clear();
      toast({
        title: 'Data cleared',
        description: 'All data has been cleared. Refreshing...',
      });
      setTimeout(() => window.location.reload(), 1000);
    }
  };

  const getStorageSize = () => {
    let total = 0;
    for (const key in localStorage) {
      if (Object.prototype.hasOwnProperty.call(localStorage, key)) {
        total += localStorage[key].length + key.length;
      }
    }
    return (total / 1024).toFixed(2); // KB
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="relative h-10 w-10 rounded-full">
            <Avatar className="h-10 w-10">
              <AvatarFallback className="bg-primary text-primary-foreground">
                {userInitials}
              </AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56" align="end" forceMount>
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col space-y-1">
              <p className="text-sm font-medium leading-none flex items-center gap-2">
                {displayName}
                {isSignedIn && !isEmailVerified && (
                   <span className="bg-destructive/10 text-destructive text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-sm">Unverified</span>
                )}
              </p>
              <p className="text-xs leading-none text-muted-foreground">
                {displayEmail}
              </p>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          
          {/* Settings */}
          <DropdownMenuItem onClick={() => setShowSettings(true)}>
            <i className="fi fi-rr-settings mr-2 h-4 w-4"></i>
            <span>Settings</span>
          </DropdownMenuItem>

          {/* Agent Pairing */}
          <DropdownMenuItem onClick={() => setShowAgentPairing(true)}>
            <i className="fi fi-rr-smartphone mr-2 h-4 w-4 text-blue-500"></i>
            <span className="font-medium text-blue-600 dark:text-blue-400">Agent Pairing</span>
          </DropdownMenuItem>

          {/* Theme Submenu */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              {theme === 'dark' ? (
                <i className="fi fi-rr-moon mr-2 h-4 w-4"></i>
              ) : (
                <i className="fi fi-rr-sun mr-2 h-4 w-4"></i>
              )}
              <span>Theme</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onClick={() => setTheme('light')}>
                <i className="fi fi-rr-sun mr-2 h-4 w-4"></i>
                <span>Light</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme('dark')}>
                <i className="fi fi-rr-moon mr-2 h-4 w-4"></i>
                <span>Dark</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme('system')}>
                <i className="fi fi-rr-settings mr-2 h-4 w-4"></i>
                <span>System</span>
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          {/* Visual Effects */}
          <DropdownMenuItem onClick={() => setShowVisualEffects(true)}>
            <i className="fi fi-rr-palette mr-2 h-4 w-4"></i>
            <span>Visual Effects</span>
          </DropdownMenuItem>

          {/* Data Management */}
          <DropdownMenuItem onClick={() => setShowDataManagement(true)}>
            <i className="fi fi-rr-database mr-2 h-4 w-4"></i>
            <span>Data Management</span>
          </DropdownMenuItem>

          {/* About */}
          <DropdownMenuItem onClick={() => setShowAbout(true)}>
            <i className="fi fi-rr-info mr-2 h-4 w-4"></i>
            <span>About</span>
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {/* Sign In / Sign Out */}
          {isSignedIn ? (
            <DropdownMenuItem onClick={handleSignOut}>
              <i className="fi fi-rr-sign-out-alt mr-2 h-4 w-4"></i>
              <span>Sign out</span>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={handleSignIn}>
              <i className="fi fi-rr-sign-in-alt mr-2 h-4 w-4"></i>
              <span>Sign in</span>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Settings Dialog */}
      <Dialog open={showSettings} onOpenChange={setShowSettings}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>
              {DIALOG_DESCRIPTIONS.settings}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {!isGuest && (
              <div className="space-y-2">
                <Label htmlFor="custom-name">Display Name</Label>
                <Input 
                  id="custom-name" 
                  value={customName} 
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder="Enter your name"
                />
                <Button onClick={handleSaveCustomName} className="w-full mt-2">
                  Save Name
                </Button>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="user-id">User ID</Label>
              <Input id="user-id" value={user?.id || 'N/A'} disabled className="font-mono text-xs" />
            </div>
            <div className="space-y-2">
              <Label>Auth Method</Label>
              <div className="text-sm text-muted-foreground">
                {authMethod === 'legacy' ? 'Email/Password' : authMethod === 'encryption' ? 'PIN/Passphrase' : 'Guest Mode'}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Storage Used</Label>
              <div className="text-sm text-muted-foreground">
                {getStorageSize()} KB of local storage
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Data Management Dialog */}
      <Dialog open={showDataManagement} onOpenChange={setShowDataManagement}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Data Management</DialogTitle>
            <DialogDescription>
              {DIALOG_DESCRIPTIONS.dataManagement}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Export Data</Label>
              <p className="text-sm text-muted-foreground mb-2">
                Download all your notebooks, sources, notes, and chat history as a JSON file.
              </p>
              <Button onClick={handleExportData} variant="outline" className="w-full">
                <i className="fi fi-rr-download mr-2 h-4 w-4"></i>
                Export All Data
              </Button>
            </div>

            <div className="space-y-2">
              <Label>Import Data</Label>
              <p className="text-sm text-muted-foreground mb-2">
                Import data from a previously exported JSON file.
              </p>
              <Button onClick={handleImportData} variant="outline" className="w-full">
                <i className="fi fi-rr-upload mr-2 h-4 w-4"></i>
                Import Data
              </Button>
            </div>

            <div className="space-y-2">
              <Label className="text-destructive">Clear All Data</Label>
              <p className="text-sm text-muted-foreground mb-2">
                Permanently delete all your local data. This cannot be undone.
              </p>
              <Button onClick={handleClearData} variant="destructive" className="w-full">
                <i className="fi fi-rr-trash mr-2 h-4 w-4"></i>
                Clear All Data
              </Button>
            </div>

            <div className="pt-4 border-t">
              <div className="text-sm text-muted-foreground">
                <strong>Storage Used:</strong> {getStorageSize()} KB
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Agent Pairing Dialog */}
      <Dialog open={showAgentPairing} onOpenChange={setShowAgentPairing}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Agent Pairing & Developer Tools</DialogTitle>
            <DialogDescription>
              Connect autonomous agents and manage API access.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <DeveloperSettings />
          </div>
        </DialogContent>
      </Dialog>

      {/* Visual Effects Dialog */}
      <VisualEffectsSettings 
        isOpen={showVisualEffects} 
        onClose={() => setShowVisualEffects(false)} 
      />

      {/* About Dialog */}
      <Dialog open={showAbout} onOpenChange={setShowAbout}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>About StudyPodLM</DialogTitle>
            <DialogDescription>
              {DIALOG_DESCRIPTIONS.about}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <h4 className="font-semibold mb-2">Version</h4>
              <p className="text-sm text-muted-foreground">1.0.0 (Local Mode)</p>
            </div>
            <div>
              <h4 className="font-semibold mb-2">Features</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• AI-powered study assistant</li>
                <li>• Podcast-style audio generation</li>
                <li>• Document processing and analysis</li>
                <li>• Smart note-taking with AI assistance</li>
                <li>• 100% private and local</li>
              </ul>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

