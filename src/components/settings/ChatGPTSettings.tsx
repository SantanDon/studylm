import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Info,
  Loader2,
  Server,
  Unplug,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { OpenAIIcon } from "@/components/brand/OpenAIIcon";
import { useToast } from "@/hooks/use-toast";

interface ProviderState {
  configured: boolean;
  available: boolean;
  model: string;
  protocol: string;
}

interface OAuthConnection {
  clientId: string;
  clientName: string;
  scopes: string[];
  expiresAt: string;
  connectedAt: string;
  lastUsedAt: string | null;
}

export function ChatGPTSettings() {
  const { toast } = useToast();
  const [openAI, setOpenAI] = useState<ProviderState | null>(null);
  const [loading, setLoading] = useState(true);
  const [connections, setConnections] = useState<OAuthConnection[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [disconnectingClientId, setDisconnectingClientId] = useState<
    string | null
  >(null);
  const connectorUrl = useMemo(() => `${window.location.origin}/mcp`, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/health/provider", { credentials: "include" })
      .then((response) => {
        if (!response.ok) throw new Error("Provider status unavailable");
        return response.json();
      })
      .then((data) => {
        if (!cancelled) setOpenAI(data?.providers?.OPENAI || null);
      })
      .catch(() => {
        if (!cancelled) setOpenAI(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/oauth/connections", { credentials: "include" })
      .then(async (response) => {
        if (response.status === 401 || response.status === 403) {
          return { connections: [] };
        }
        if (!response.ok) throw new Error("Connected apps are unavailable");
        return response.json();
      })
      .then((data) => {
        if (!cancelled) {
          setConnections(
            Array.isArray(data?.connections) ? data.connections : [],
          );
        }
      })
      .catch(() => {
        if (!cancelled) setConnections([]);
      })
      .finally(() => {
        if (!cancelled) setConnectionsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const copyConnectorUrl = async () => {
    try {
      await navigator.clipboard.writeText(connectorUrl);
      toast({
        title: "Connector address copied",
        description:
          "Paste it into ChatGPT Settings → Connectors in developer mode.",
      });
    } catch {
      toast({
        variant: "destructive",
        title: "Could not copy automatically",
        description: "Select the connector address above and copy it manually.",
      });
    }
  };

  const disconnect = async (connection: OAuthConnection) => {
    setDisconnectingClientId(connection.clientId);
    try {
      const response = await fetch(
        `/api/oauth/connections/${encodeURIComponent(connection.clientId)}`,
        { method: "DELETE", credentials: "include" },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Could not disconnect this app");
      }
      setConnections((current) =>
        current.filter((item) => item.clientId !== connection.clientId),
      );
      toast({
        title: "ChatGPT disconnected",
        description: "Its StudyPod access and refresh credential were revoked.",
      });
    } catch (requestError) {
      toast({
        variant: "destructive",
        title: "Could not disconnect",
        description:
          requestError instanceof Error
            ? requestError.message
            : "Please try again.",
      });
    } finally {
      setDisconnectingClientId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-foreground text-background">
              <OpenAIIcon className="h-5 w-5" title="OpenAI" />
            </div>
            <div className="min-w-0">
              <CardTitle>OpenAI and ChatGPT</CardTitle>
              <CardDescription className="mt-1">
                Official API reasoning inside StudyPod, plus an authenticated
                StudyPod connector for ChatGPT.
              </CardDescription>
            </div>
          </div>
          <Badge variant={openAI?.configured ? "default" : "secondary"}>
            {loading
              ? "Checking…"
              : openAI?.configured
                ? "API ready"
                : "Fallback active"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <section className="rounded-xl border bg-muted/25 p-4">
          <div className="flex items-start gap-3">
            {openAI?.configured ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
            ) : (
              <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">
                  StudyPod reasoning provider
                </h3>
                {openAI?.model ? (
                  <Badge variant="outline">{openAI.model}</Badge>
                ) : null}
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                {openAI?.configured
                  ? "StudyPod sends server-side reasoning requests through OpenAI’s Responses API and keeps the API credential off the browser."
                  : "No OpenAI API credential is configured on this deployment, so StudyPod uses its configured fallback provider chain."}
              </p>
            </div>
          </div>
        </section>

        <section className="space-y-3 rounded-xl border p-4">
          <div className="flex items-start gap-3">
            <Server className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">
                Use StudyPod from ChatGPT
              </h3>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Add the connector below in ChatGPT developer mode. ChatGPT
                performs the reasoning with the model and capabilities available
                on your ChatGPT account, while scoped StudyPod tools retrieve
                evidence, preserve notes, manage requested tasks, and run
                grounded missions.
              </p>
            </div>
          </div>

          <div className="flex min-w-0 items-center gap-2 rounded-lg bg-muted px-3 py-2">
            <code className="min-w-0 flex-1 truncate text-xs">
              {connectorUrl}
            </code>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={copyConnectorUrl}
              aria-label="Copy connector address"
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={copyConnectorUrl}>
              <Copy className="mr-2 h-4 w-4" />
              Copy connector URL
            </Button>
            <Button type="button" size="sm" variant="outline" asChild>
              <a href="https://chatgpt.com/" target="_blank" rel="noreferrer">
                Open ChatGPT
                <ExternalLink className="ml-2 h-4 w-4" />
              </a>
            </Button>
          </div>
        </section>

        <section className="space-y-3 rounded-xl border p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">Connected ChatGPT apps</h3>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Review or revoke active connector access for this StudyPod
                account.
              </p>
            </div>
            {connections.length > 0 ? (
              <Badge variant="outline">{connections.length} active</Badge>
            ) : null}
          </div>

          {connectionsLoading ? (
            <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-3 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking connected apps
            </div>
          ) : connections.length === 0 ? (
            <p className="rounded-lg bg-muted/50 px-3 py-3 text-xs text-muted-foreground">
              No active ChatGPT connector is authorized for this account.
            </p>
          ) : (
            <div className="space-y-2">
              {connections.map((connection) => (
                <div
                  key={connection.clientId}
                  className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {connection.clientName}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {connection.scopes.length} scoped permission
                      {connection.scopes.length === 1 ? "" : "s"} · expires{" "}
                      {new Date(connection.expiresAt).toLocaleDateString()}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void disconnect(connection)}
                    disabled={disconnectingClientId === connection.clientId}
                  >
                    {disconnectingClientId === connection.clientId ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Unplug className="mr-2 h-4 w-4" />
                    )}
                    Disconnect
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="flex items-start gap-2 rounded-lg bg-blue-50 p-3 text-xs leading-5 text-blue-900 dark:bg-blue-950/30 dark:text-blue-100">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            A ChatGPT subscription and OpenAI API usage are billed separately.
            Connecting StudyPod to ChatGPT uses your ChatGPT account inside
            ChatGPT; it does not turn that subscription into API credit for the
            StudyPod web app.
          </p>
        </div>

        <p className="text-[11px] text-muted-foreground">
          OpenAI and the OpenAI mark are trademarks of OpenAI. StudyPod is an
          independent application and is not endorsed by OpenAI.
        </p>
      </CardContent>
    </Card>
  );
}
