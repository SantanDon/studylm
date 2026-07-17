import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Copy, Terminal, ExternalLink, Globe, Key, CheckCircle2, Loader2, RefreshCw, Mail, Lock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuthState } from '@/hooks/useAuthState';
import { useAuth } from '@/hooks/useAuth';
import { ApiService } from '@/services/apiService';
import { api } from '@/config/api';

export function DeveloperSettings() {
  const { isSignedIn, authMethod } = useAuthState();
  const { signInWithCloud } = useAuth();
  const { toast } = useToast();
  const [authState, setAuthState] = useState<'loading' | 'signed_in' | 'signed_out'>(() =>
    isSignedIn ? 'signed_in' : 'loading'
  );

  const [cloudEmail, setCloudEmail] = useState('');
  const [cloudPassword, setCloudPassword] = useState('');
  const [cloudSigningIn, setCloudSigningIn] = useState(false);

  useEffect(() => {
    let mounted = true;
    setAuthState('loading');
    fetch(`${api.apiUrl}/user/profile`, { credentials: 'include' })
      .then(res => {
        if (mounted) setAuthState(res.ok ? 'signed_in' : 'signed_out');
      })
      .catch(() => {
        if (mounted) setAuthState('signed_out');
      });
    return () => { mounted = false; };
  }, [isSignedIn]);

  const handleCloudSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setCloudSigningIn(true);
    try {
      const data = await ApiService.signin({ email: cloudEmail, password: cloudPassword });
      if (data.mfaRequired) {
        toast({ title: 'MFA Required', description: 'Check your authenticator app.', variant: 'destructive' });
        return;
      }
      signInWithCloud(data.user);
      setAuthState('signed_in');
      toast({ title: 'Cloud Sign In', description: 'Signed in to cloud successfully.' });
    } catch (err) {
      toast({
        title: 'Sign In Failed',
        description: err instanceof Error ? err.message : 'Cloud sign in failed',
        variant: 'destructive',
      });
    } finally {
      setCloudSigningIn(false);
    }
  };

  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [, setPairingExpiresAt] = useState<string | null>(null);
  const [pairingLoading, setPairingLoading] = useState(false);

  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [genKeyLoading, setGenKeyLoading] = useState(false);

  const [copied, setCopied] = useState(false);

  const copyText = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    toast({
      title: `${label} Copied!`,
      description: 'Paste this into your AI agent when it asks for a StudyPodLM API key.',
    });
    setTimeout(() => setCopied(false), 2000);
  };

  const generatePairingCode = async () => {
    setPairingLoading(true);
    setPairingCode(null);
    setPairingExpiresAt(null);
    try {
      const res = await fetch(`${api.apiUrl}/auth/pair/initiate`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to generate pairing code');
      }
      const data = await res.json();
      setPairingCode(data.code);
      setPairingExpiresAt(data.expiresAt);
      toast({
        title: 'Pairing Code Generated',
        description: 'Share this 6-digit code with your AI agent.',
      });
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to generate pairing code',
        variant: 'destructive',
      });
    } finally {
      setPairingLoading(false);
    }
  };

  const generateApiKey = async () => {
    setGenKeyLoading(true);
    setGeneratedKey(null);
    try {
      const res = await fetch(`${api.apiUrl}/auth/agent-key`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'Agent Key' }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to generate API key');
      }
      const data = await res.json();
      setGeneratedKey(data.key);
      toast({
        title: 'API Key Generated',
        description: 'Save this now — it will not be shown again.',
      });
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to generate API key',
        variant: 'destructive',
      });
    } finally {
      setGenKeyLoading(false);
    }
  };

  if (authState === 'loading') {
    return (
      <div className="flex items-center justify-center py-8">
        <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Verifying session...</span>
      </div>
    );
  }

  if (authState === 'signed_out') {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Terminal className="w-5 h-5 text-muted-foreground" />
              Agent Pairing
            </CardTitle>
            <CardDescription>
              Connect autonomous agents to your account.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {authMethod !== 'none' && (
              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  You are signed in locally but not connected to Cloud. Agent pairing requires a Cloud session.
                </p>
              </div>
            )}

            <form onSubmit={handleCloudSignIn} className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="cloud-email" className="text-xs">Cloud Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="cloud-email"
                    type="email"
                    placeholder="you@example.com"
                    value={cloudEmail}
                    onChange={e => setCloudEmail(e.target.value)}
                    className="pl-9 h-9 text-sm"
                    disabled={cloudSigningIn}
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cloud-password" className="text-xs">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="cloud-password"
                    type="password"
                    placeholder="Enter your password"
                    value={cloudPassword}
                    onChange={e => setCloudPassword(e.target.value)}
                    className="pl-9 h-9 text-sm"
                    disabled={cloudSigningIn}
                    required
                  />
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={cloudSigningIn}>
                {cloudSigningIn ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Signing in...</>
                ) : (
                  <><Globe className="w-4 h-4 mr-2" /> Sign in to Cloud</>
                )}
              </Button>
            </form>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">or</span>
              </div>
            </div>

            <p className="text-xs text-center text-muted-foreground">
              Don't have a Cloud account yet?{' '}
              <a href="/auth?mode=cloud-signup" className="text-primary underline">
                Create one
              </a>
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* Pairing Code Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="w-5 h-5 text-muted-foreground" />
            Agent Pairing
          </CardTitle>
          <CardDescription>
            Generate a 6-digit code for your AI agent to connect to your account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            onClick={generatePairingCode}
            disabled={pairingLoading}
            className="w-full"
          >
            {pairingLoading ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating...</>
            ) : (
              'Generate Pairing Code'
            )}
          </Button>

          {pairingCode && (
            <div className="p-4 bg-muted rounded-lg text-center space-y-2">
              <Label className="text-sm font-medium">Agent PIN Code</Label>
              <div className="text-3xl font-bold tracking-[0.3em] font-mono text-primary">
                {pairingCode}
              </div>
              <div className="flex justify-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyText(pairingCode, 'Pairing Code')}
                >
                  {copied ? <CheckCircle2 className="w-4 h-4 mr-1 text-green-500" /> : <Copy className="w-4 h-4 mr-1" />}
                  Copy
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Expires in 5 minutes. Give this code to your agent, then run:
                <br />
                <code className="text-[10px] bg-background px-1 rounded">
                  node agent_demo_kit/pair_and_test.js {pairingCode}
                </code>
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Direct API Key Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Terminal className="w-5 h-5 text-muted-foreground" />
            Generate API Key
          </CardTitle>
          <CardDescription>
            Create a persistent <code>spm_</code> API key for direct agent access (no PIN needed).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            onClick={generateApiKey}
            disabled={genKeyLoading}
            variant="secondary"
            className="w-full"
          >
            {genKeyLoading ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating...</>
            ) : (
              'Generate New API Key'
            )}
          </Button>

          {generatedKey && (
            <div className="p-4 bg-muted rounded-lg space-y-2">
              <Label className="text-xs text-muted-foreground">Your new API key (shown once)</Label>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={generatedKey}
                  className="font-mono text-[11px] h-9 bg-background"
                />
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  onClick={() => copyText(generatedKey, 'API Key')}
                  title="Copy API key"
                >
                  {copied
                    ? <CheckCircle2 className="w-4 h-4 text-green-500" />
                    : <Copy className="w-4 h-4" />
                  }
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold">Headless Dropbox</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
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
            <Button variant="outline" size="sm" className="w-full text-[11px] h-7" asChild>
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
