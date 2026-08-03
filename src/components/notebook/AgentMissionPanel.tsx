import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  FileText,
  Loader2,
  Play,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import ApiService, { AgentMission } from "@/services/apiService";

interface AgentMissionPanelProps {
  notebookId: string;
}

const statusStyles: Record<AgentMission["status"], string> = {
  ready:
    "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300",
  running:
    "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300",
  paused:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  completed:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
  failed:
    "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300",
};

function resultSummary(mission: AgentMission) {
  if (mission.result?.answer) return mission.result.answer;
  if (mission.result?.message) return mission.result.message;
  return null;
}

const AgentMissionPanel = ({ notebookId }: AgentMissionPanelProps) => {
  const { session } = useAuth();
  const { toast } = useToast();
  const [missions, setMissions] = useState<AgentMission[]>([]);
  const [goal, setGoal] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const token = session?.access_token || "";

  const loadMissions = useCallback(
    async (quiet = false) => {
      if (!notebookId || !token) {
        setLoading(false);
        return;
      }
      if (!quiet) setLoading(true);
      try {
        const response = await ApiService.fetchAgentMissions(notebookId, token);
        setMissions(response.missions);
      } catch (error) {
        if (!quiet) {
          toast({
            title: "Could not load missions",
            description:
              error instanceof Error ? error.message : "Please try again.",
            variant: "destructive",
          });
        }
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [notebookId, toast, token],
  );

  useEffect(() => {
    void loadMissions();
  }, [loadMissions]);

  const hasRunningMission = missions.some(
    (mission) => mission.status === "running",
  );

  useEffect(() => {
    if (!hasRunningMission) return undefined;
    const interval = window.setInterval(() => {
      void loadMissions(true);
    }, 2500);
    return () => window.clearInterval(interval);
  }, [hasRunningMission, loadMissions]);

  const runMission = async (mission: AgentMission) => {
    setRunningId(mission.id);
    setMissions((current) =>
      current.map((item) =>
        item.id === mission.id ? { ...item, status: "running" } : item,
      ),
    );
    try {
      const response = await ApiService.runAgentMission(mission.id, token);
      setMissions((current) =>
        current.map((item) =>
          item.id === mission.id ? response.mission : item,
        ),
      );
      setExpandedId(mission.id);
      toast({
        title: "Mission completed",
        description: "A grounded report was saved to this notebook as a note.",
      });
    } catch (error) {
      await loadMissions(true);
      toast({
        title: "Mission could not complete",
        description:
          error instanceof Error
            ? error.message
            : "The failure state was saved.",
        variant: "destructive",
      });
    } finally {
      setRunningId(null);
    }
  };

  const resumeAndRunMission = async (mission: AgentMission) => {
    setRunningId(mission.id);
    try {
      const response = await ApiService.updateAgentMission(
        mission.id,
        { status: "ready" },
        token,
      );
      setMissions((current) =>
        current.map((item) =>
          item.id === mission.id ? response.mission : item,
        ),
      );
      await runMission(response.mission);
    } catch (error) {
      await loadMissions(true);
      toast({
        title: "Mission could not resume",
        description:
          error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
      setRunningId(null);
    }
  };

  const handleCreateAndRun = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedGoal = goal.trim();
    if (!trimmedGoal) return;

    setCreating(true);
    try {
      const mission = await ApiService.createAgentMission(
        notebookId,
        trimmedGoal,
        token,
      );
      setGoal("");
      setMissions((current) => [mission, ...current]);
      await runMission(mission);
    } catch (error) {
      toast({
        title: "Could not create mission",
        description:
          error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (mission: AgentMission) => {
    if (
      !window.confirm(
        "Delete this mission and its run history? The generated note will remain.",
      )
    )
      return;
    try {
      await ApiService.deleteAgentMission(mission.id, token);
      setMissions((current) =>
        current.filter((item) => item.id !== mission.id),
      );
    } catch (error) {
      toast({
        title: "Could not delete mission",
        description:
          error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-indigo-100 bg-indigo-50/30 p-3 dark:border-indigo-900/50 dark:bg-indigo-950/20">
      <div className="flex items-start gap-2">
        <div className="rounded-lg bg-indigo-100 p-2 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300">
          <Bot className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-foreground">
            Agent Missions
          </h3>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            Give StudyPod a bounded research job. It reads this notebook, audits
            its evidence, and saves a cited report as a note.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => void loadMissions()}
          disabled={loading}
          aria-label="Refresh missions"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
          />
        </Button>
      </div>

      <form className="space-y-2" onSubmit={handleCreateAndRun}>
        <Textarea
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          placeholder="e.g. Compare the authors' central claims, identify contradictions, and recommend what I should study next."
          className="min-h-24 resize-y bg-background text-xs"
          maxLength={4000}
          aria-label="Research mission"
        />
        <Button
          type="submit"
          size="sm"
          className="w-full gap-2"
          disabled={!goal.trim() || creating || Boolean(runningId)}
        >
          {creating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          Create and run mission
        </Button>
      </form>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-5 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading missions
        </div>
      ) : missions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-background/70 px-3 py-4 text-center text-[11px] text-muted-foreground">
          No missions yet. Your first run will appear here and remain available
          after you leave.
        </div>
      ) : (
        <div className="space-y-2">
          {missions.map((mission) => {
            const summary = resultSummary(mission);
            const isRunning =
              runningId === mission.id || mission.status === "running";
            const isExpanded = expandedId === mission.id;
            return (
              <article
                key={mission.id}
                className="rounded-lg border border-border bg-background p-3 shadow-sm"
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-3 text-xs font-medium leading-relaxed text-foreground">
                      {mission.goal}
                    </p>
                    <span
                      className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${statusStyles[mission.status]}`}
                      role="status"
                      aria-live="polite"
                    >
                      {isRunning ? "running" : mission.status}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => void handleDelete(mission)}
                    disabled={isRunning}
                    aria-label="Delete mission"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {isRunning && (
                  <p className="mt-2 rounded-md bg-indigo-50 px-2.5 py-2 text-[10px] leading-relaxed text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
                    This run is saved on the server. If the request is
                    interrupted, StudyPod preserves a recoverable state so you
                    can safely retry.
                  </p>
                )}

                {summary && (
                  <div className="mt-3 rounded-md border border-border bg-muted/30 p-2.5">
                    <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground">
                      {mission.status === "failed" ? (
                        <AlertTriangle className="h-3 w-3 text-rose-500" />
                      ) : (
                        <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                      )}
                      {mission.status === "failed"
                        ? "Saved failure"
                        : "Grounded report"}
                    </div>
                    <p
                      className={`whitespace-pre-wrap text-[11px] leading-relaxed text-foreground ${isExpanded ? "" : "line-clamp-5"}`}
                    >
                      {summary}
                    </p>
                    {summary.length > 320 && (
                      <button
                        type="button"
                        className="mt-2 text-[10px] font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                        onClick={() =>
                          setExpandedId(isExpanded ? null : mission.id)
                        }
                      >
                        {isExpanded ? "Show less" : "Read report"}
                      </button>
                    )}
                    {mission.result?.evidenceAudit && (
                      <div className="mt-2 rounded-md bg-muted/60 px-2 py-1.5 text-[9px] text-muted-foreground">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="inline-flex items-center gap-1 font-medium">
                            {mission.result.evidenceAudit.status ===
                            "grounded" ? (
                              <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                            ) : (
                              <AlertTriangle className="h-3 w-3 text-amber-500" />
                            )}
                            {mission.result.evidenceAudit
                              .verifiedCitationCount}{" "}
                            verified
                            {mission.result.evidenceAudit
                              .verifiedCitationCount === 1
                              ? " citation"
                              : " citations"}
                          </span>
                          <span>
                            {mission.result.evidenceAudit.citedSourceCount} of
                            {` ${mission.result.evidenceAudit.contextSourceCount} context sources cited`}
                          </span>
                        </div>
                        {isExpanded &&
                          mission.result.evidenceAudit.warnings.length > 0 && (
                            <ul className="mt-1.5 list-disc space-y-1 pl-4 leading-relaxed text-amber-700 dark:text-amber-300">
                              {mission.result.evidenceAudit.warnings.map(
                                (warning) => (
                                  <li key={warning}>{warning}</li>
                                ),
                              )}
                            </ul>
                          )}
                      </div>
                    )}
                    {mission.result?.noteId && (
                      <div className="mt-2 flex items-center gap-1 text-[9px] text-muted-foreground">
                        <FileText className="h-3 w-3" />
                        Saved in Notes
                      </div>
                    )}
                  </div>
                )}

                {!isRunning && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3 h-7 w-full gap-1.5 text-[10px]"
                    onClick={() =>
                      void (mission.status === "paused"
                        ? resumeAndRunMission(mission)
                        : runMission(mission))
                    }
                    disabled={Boolean(runningId)}
                  >
                    {mission.status === "paused" ? (
                      <RefreshCw className="h-3 w-3" />
                    ) : (
                      <Play className="h-3 w-3" />
                    )}
                    {mission.status === "paused"
                      ? "Resume and run"
                      : mission.status === "completed"
                        ? "Run again"
                        : mission.status === "failed"
                          ? "Retry mission"
                          : "Run mission"}
                  </Button>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AgentMissionPanel;
