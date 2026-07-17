import React, { useState } from "react";
import { useLoginWithChatGPT } from "@opencoredev/loginwithchatgpt-react";
import { Loader2, Sparkles, Copy, ExternalLink, Terminal } from "lucide-react";
import { ApiService } from "@/services/apiService";
import { useToast } from "@/hooks/use-toast";

interface ChatGPTLoginButtonProps {
  onSuccess?: (user: { id: string; email?: string; displayName?: string; account_type?: string; createdAt: string }) => void;
}

/**
 * "Continue with ChatGPT" — drives the Login-with-ChatGPT device-code flow,
 * surfaces the 9-char code + verification URL the user must enter on OpenAI's
 * page, then bridges the resulting ChatGPT identity to a StudyPodLM account via
 * POST /api/auth/chatgpt-login (finds-or-creates the user, sets our auth cookie).
 */
export const ChatGPTLoginButton: React.FC<ChatGPTLoginButtonProps> = ({ onSuccess }) => {
  const { toast } = useToast();
  const [bridging, setBridging] = useState(false);

  const {
    status,
    login,
    userCode,
    verificationUrl,
    copied,
    copyCode,
    reopen,
  } = useLoginWithChatGPT({
    basePath: "/api/chatgpt",
    onAuthenticated: async () => {
      try {
        setBridging(true);
        const data = await ApiService.chatgptLogin();
        onSuccess?.(data.user);
      } catch (err) {
        const message = err instanceof Error ? err.message : "ChatGPT sign-in failed";
        toast({
          title: "ChatGPT sign-in failed",
          description: message,
          variant: "destructive",
        });
      } finally {
        setBridging(false);
      }
    },
    onError: (err) => {
      toast({
        title: "ChatGPT connection failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const isPending = status === "pending" || status === "connecting" || status === "loading";

  if (isPending && userCode) {
    return (
      <div className="w-full space-y-3 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-4 text-sm">
        <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
          <Terminal className="w-4 h-4" />
          <span className="font-medium">Enter this code on the ChatGPT verification page</span>
        </div>

        <div className="flex items-center justify-center gap-2">
          <code className="rounded bg-zinc-900 px-3 py-2 text-lg font-mono tracking-[0.3em] text-white">
            {userCode}
          </code>
          <button
            type="button"
            onClick={() => copyCode()}
            className="rounded-md border border-zinc-300 dark:border-zinc-700 p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            title="Copy code"
          >
            <Copy className="w-4 h-4" />
          </button>
        </div>
        {copied && <p className="text-center text-xs text-emerald-500">Code copied</p>}

        <div className="flex flex-col gap-2">
          <a
            href={verificationUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-3 py-2 font-medium text-white hover:bg-emerald-700"
          >
            <ExternalLink className="w-4 h-4" />
            Open ChatGPT verification page
          </a>
          <button
            type="button"
            onClick={() => reopen()}
            className="text-xs text-muted-foreground underline hover:text-foreground"
          >
            Re-open verification tab
          </button>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Waiting for you to finish on ChatGPT…
        </p>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => login()}
      disabled={isPending || bridging}
      className="w-full h-11 flex items-center justify-center gap-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors text-sm font-medium disabled:opacity-60"
    >
      {isPending || bridging ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin" />
          {bridging ? "Signing in..." : "Connecting to ChatGPT..."}
        </>
      ) : (
        <>
          <Sparkles className="w-4 h-4 text-emerald-500" />
          Continue with ChatGPT
        </>
      )}
    </button>
  );
};
