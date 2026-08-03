import { useMemo, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Bot,
  CheckSquare2,
  FileText,
  Loader2,
  Search,
  ShieldCheck,
} from "lucide-react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { OpenAIIcon } from "@/components/brand/OpenAIIcon";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { API_BASE_URL } from "@/config/api";
import { useAuth } from "@/hooks/useAuth";

const parameterNames = [
  "client_id",
  "redirect_uri",
  "response_type",
  "code_challenge",
  "code_challenge_method",
  "scope",
  "state",
] as const;

function decisionEndpoint() {
  return `${API_BASE_URL.replace(/\/api\/?$/, "")}/oauth/authorize/decision`;
}

const ChatGPTConnect = () => {
  const { user, session, loading } = useAuth();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [submitting, setSubmitting] = useState<"allow" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const params = useMemo(() => {
    const result: Record<string, string> = {};
    for (const name of parameterNames) {
      const value = searchParams.get(name);
      if (value) result[name] = value;
    }
    return result;
  }, [searchParams]);

  const clientName =
    (searchParams.get("client_name") || "ChatGPT").trim().slice(0, 120) ||
    "ChatGPT";
  const requiredParametersPresent = Boolean(
    params.client_id &&
    params.redirect_uri &&
    params.response_type &&
    params.code_challenge &&
    params.code_challenge_method,
  );
  const returnTo = `${location.pathname}${location.search}`;
  const signInUrl = `/auth?returnTo=${encodeURIComponent(returnTo)}`;

  const decide = async (approved: boolean) => {
    setSubmitting(approved ? "allow" : "deny");
    setError(null);
    try {
      const response = await fetch(decisionEndpoint(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {}),
        },
        credentials: "include",
        body: JSON.stringify({ approved, params }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.redirectTo) {
        throw new Error(
          data.error_description ||
            data.error ||
            "Could not complete authorization.",
        );
      }
      window.location.assign(data.redirectTo);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not complete authorization.",
      );
      setSubmitting(null);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-background via-background to-muted/40 px-4 py-10">
      <Card className="w-full max-w-lg overflow-hidden shadow-xl">
        <div className="h-1.5 bg-gradient-to-r from-emerald-400 via-sky-500 to-indigo-500" />
        <CardHeader className="space-y-5 pb-4">
          <div className="flex items-center justify-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-foreground text-background shadow-sm">
              <OpenAIIcon className="h-6 w-6" title="OpenAI" />
            </div>
            <ArrowRight
              className="h-5 w-5 text-muted-foreground"
              aria-hidden="true"
            />
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-sm">
              <BookOpen className="h-6 w-6" aria-hidden="true" />
            </div>
          </div>
          <div className="text-center">
            <CardTitle className="text-xl">
              Connect {clientName} to StudyPod
            </CardTitle>
            <CardDescription className="mt-2 leading-6">
              Let ChatGPT use your StudyPod notebooks as a private, cited
              research workspace.
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          {!requiredParametersPresent ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              This authorization link is incomplete. Return to ChatGPT and add
              the StudyPod connector again.
            </div>
          ) : (
            <>
              <section className="space-y-3 rounded-xl border bg-muted/25 p-4">
                <h2 className="text-sm font-semibold">
                  ChatGPT will be able to
                </h2>
                <div className="grid gap-3 text-xs text-muted-foreground">
                  <div className="flex items-start gap-2">
                    <Search className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />
                    Search and read processed notebook evidence.
                  </div>
                  <div className="flex items-start gap-2">
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                    Read saved notes and save new notes only when you ask.
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckSquare2 className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                    Read, create, and mark notebook tasks complete only when you
                    request follow-up.
                  </div>
                  <div className="flex items-start gap-2">
                    <Bot className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
                    Create and run grounded agent missions.
                  </div>
                </div>
              </section>

              <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs leading-5 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                Access is scoped, expires automatically, and uses OAuth with
                PKCE. Your StudyPod password is never shared with ChatGPT.
              </div>

              {error && (
                <div
                  role="alert"
                  className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive"
                >
                  {error}
                </div>
              )}

              {loading ? (
                <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Checking your StudyPod session
                </div>
              ) : !user ? (
                <div className="space-y-3">
                  <p className="text-center text-xs text-muted-foreground">
                    Sign in to StudyPod to choose whether to grant access.
                  </p>
                  <Button asChild className="w-full">
                    <Link to={signInUrl}>Sign in to continue</Link>
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-center text-xs text-muted-foreground">
                    Signed in as{" "}
                    <span className="font-medium text-foreground">
                      {user.email || user.displayName}
                    </span>
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void decide(false)}
                      disabled={Boolean(submitting)}
                    >
                      {submitting === "deny" && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      onClick={() => void decide(true)}
                      disabled={Boolean(submitting)}
                    >
                      {submitting === "allow" && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      Allow access
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}

          <p className="text-center text-[10px] leading-4 text-muted-foreground">
            StudyPod is an independent application and is not endorsed by
            OpenAI. You can revoke connector access from StudyPod or ChatGPT
            settings.
          </p>
        </CardContent>
      </Card>
    </main>
  );
};

export default ChatGPTConnect;
