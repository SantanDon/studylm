import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Copy, Key, Terminal, ExternalLink, ShieldCheck, CheckCircle2, RefreshCw, Smartphone, Globe } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { ApiService } from '@/services/apiService';

export function DeveloperSettings() {
  const { session } = useAuth();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  
  // Pairing workflow state
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingExpires, setPairingExpires] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);

  // For now, we expose the current Session Token as the API Key
  const currentToken = session?.access_token || '';

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied!",
      description: `${label} copied to clipboard`,
    });
    if (label === 'Access Token') {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const initiatePairing = async () => {
    if (!currentToken) return;
    setIsInitializing(true);
    try {
      // Since ApiService might not have this yet, we'll fetch directly or assume it's added
      const response = await fetch('/api/auth/pair/initiate', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${currentToken}`,
          'Content-Type': 'application/json'
        }
      });
      const data = await response.json();
      if (data.code) {
        setPairingCode(data.code);
        setPairingExpires(data.expiresAt);
        toast({
          title: "Pairing Active",
          description: "Invitation code generated successfully.",
        });
      }
    } catch (error) {
      toast({
        title: "Pairing Failed",
        description: "Could not initiate pairing session.",
        variant: "destructive"
      });
    } finally {
      setIsInitializing(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="border-blue-200/50 dark:border-blue-900/30 bg-blue-50/10 dark:bg-blue-950/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-blue-500" />
            Seamless Agent Pairing
          </CardTitle>
          <CardDescription>
            The easiest way to connect a new CLI or IDE agent. No copy-pasting required.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!currentToken ? (
            <div className="flex flex-col items-center justify-center p-8 space-y-4 border-2 border-dashed rounded-xl bg-muted/30">
              <ShieldCheck className="w-10 h-10 text-muted-foreground opacity-30" />
              <div className="text-center max-w-[280px]">
                <p className="text-sm font-semibold text-foreground">Cloud Identity Required</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Agent pairing and API access require a verified Cloud account to ensure secure cross-device sync.
                </p>
              </div>
              <Button 
                variant="default" 
                className="bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-500/20"
                onClick={() => window.location.href = '/auth'}
              >
                <Globe className="w-4 h-4 mr-2" />
                Connect Cloud Account
              </Button>
            </div>
          ) : !pairingCode ? (
            <div className="flex flex-col items-center justify-center p-6 space-y-4 border-2 border-dashed rounded-xl bg-background/50">
              <Key className="w-8 h-8 text-muted-foreground opacity-50" />
              <div className="text-center">
                <p className="text-sm font-medium">Ready to pair a new agent?</p>
                <p className="text-xs text-muted-foreground">This generates a short-lived 6-digit pin.</p>
              </div>
              <Button onClick={initiatePairing} disabled={isInitializing}>
                {isInitializing ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
                Generate Pairing Code
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center p-6 space-y-4 border-2 border-blue-500/30 rounded-xl bg-blue-500/5">
              <div className="text-4xl font-black tracking-[0.5em] text-blue-600 dark:text-blue-400 font-mono">
                {pairingCode}
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold">Enter this code in your agent</p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Expires at {new Date(pairingExpires!).toLocaleTimeString()}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setPairingCode(null)}>
                Cancel Pairing
              </Button>
            </div>
          )}
        </CardContent>
        <CardFooter className="text-[10px] text-muted-foreground border-t bg-muted/20 py-2 rounded-b-lg">
          Connect via CLI: <code className="ml-1 bg-background px-1 rounded text-[9px]">node backend/scripts/kilo_pair.js {pairingCode || '######'}</code>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Terminal className="w-4 h-4 text-muted-foreground" />
            Manual Integration
          </CardTitle>
          <CardDescription className="text-xs">
            Direct access to your current session token.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs">Session Token (Temporary Key)</Label>
            <div className="flex gap-2">
              <Input 
                readOnly 
                value={currentToken ? `${currentToken.substring(0, 32)}...` : 'Requires Cloud Login'} 
                className={`font-mono text-[10px] h-8 ${!currentToken ? 'bg-destructive/5 text-destructive border-destructive/20' : 'bg-muted'}`}
              />
              <Button 
                variant="outline" 
                size="icon" 
                className="h-8 w-8"
                onClick={() => copyToClipboard(currentToken, 'Access Token')}
                disabled={!currentToken}
              >
                {copied ? <CheckCircle2 className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold">Headless Dropbox</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              StudyPod is E2EE. Agents pushing files to the "Dropbox" route do <b>not</b> need your passphrase. 
              Uploads are automatically encrypted when you next open the notebook.
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold">Developer Documentation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
             <Button variant="outline" size="sm" className="w-full text-[10px] h-7" asChild>
              <a href="/API_HEADLESS.md" target="_blank" rel="noreferrer">
                <ExternalLink className="w-3 h-3 mr-1" /> View Headless API Guide
              </a>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
