import { useState, useCallback } from 'react';
import { LoginWithChatGPT, useLoginWithChatGPT } from '@opencoredev/loginwithchatgpt-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Sparkles, CheckCircle2, XCircle } from 'lucide-react';

type ChatGPTUser = { accountId?: string; email?: string; name?: string; plan?: string } | undefined;

export function ChatGPTSettings() {
  const { toast } = useToast();
  const [connectedUser, setConnectedUser] = useState<ChatGPTUser>(undefined);
  const [sessionStatus, setSessionStatus] = useState<'unknown' | 'authenticated' | 'unauthenticated'>('unknown');

  const onAuthenticated = useCallback(
    (user: ChatGPTUser) => {
      setConnectedUser(user);
      setSessionStatus('authenticated');
      toast({
        title: 'ChatGPT connected',
        description: user?.email ? `Signed in as ${user.email}` : 'ChatGPT session active',
      });
    },
    [toast]
  );

  const onError = useCallback(
    (error: Error) => {
      setSessionStatus('unauthenticated');
      toast({ title: 'ChatGPT connection failed', description: error.message, variant: 'destructive' });
    },
    [toast]
  );

  const { status, logout } = useLoginWithChatGPT({
    basePath: '/api/chatgpt',
    onAuthenticated,
    onError,
  });

  const handleDisconnect = useCallback(async () => {
    try {
      await logout();
      setConnectedUser(undefined);
      setSessionStatus('unauthenticated');
      toast({ title: 'ChatGPT disconnected', description: 'Session revoked.' });
    } catch (e) {
      toast({ title: 'Disconnect failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
    }
  }, [logout, toast]);

  const isConnected = status === 'authenticated' || sessionStatus === 'authenticated';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="w-5 h-5" />
          Connect ChatGPT
        </CardTitle>
        <CardDescription>
          Bring your own ChatGPT subscription as the reasoning backend for notebook chat. Your
          tokens never touch the browser — they stay HttpOnly on the StudyPodLM server.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2 text-sm">
          {isConnected ? (
            <>
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <span className="font-medium">ChatGPT session active</span>
              {connectedUser?.email && <Badge variant="secondary">{connectedUser.email}</Badge>}
              {connectedUser?.plan && <Badge variant="outline">{connectedUser.plan}</Badge>}
            </>
          ) : (
            <>
              <XCircle className="w-4 h-4 text-muted-foreground" />
              <span className="text-muted-foreground">Not connected</span>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <LoginWithChatGPT
            consent={{ appName: 'StudyPodLM' }}
            onAuthenticated={onAuthenticated}
            onError={onError}
          />
          {isConnected && (
            <button
              onClick={handleDisconnect}
              className="text-sm text-muted-foreground underline hover:text-foreground"
            >
              Disconnect
            </button>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          When connected, notebook chat routes through your ChatGPT plan instead of the default
          StudyPodLM provider chain. You can disconnect anytime — the server session is revoked
          immediately.
        </p>
      </CardContent>
    </Card>
  );
}
