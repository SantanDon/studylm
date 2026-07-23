import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { ApiService } from '@/services/apiService';
import type { ResearchGoal } from '@/hooks/useResearchGoals';

interface GoalSummary {
  notebookId: string;
  notebookTitle: string;
  total: number;
  active: number;
  completed: number;
  paused: number;
  recentTitles: { id: string; title: string; status: string; progressPct: number }[];
}

const GoalsPulse: React.FC = () => {
  const { session } = useAuth();
  const isAuthenticated = !!session?.access_token;

  const { data: notebooks, isLoading: loadingNotebooks } = useQuery({
    queryKey: ['notebooks-for-goals', isAuthenticated],
    queryFn: async () => {
      if (!isAuthenticated) return [];
      return ApiService.fetchNotebooks(session!.access_token);
    },
    enabled: isAuthenticated,
  });

  const notebookList = useMemo(() => {
    if (!notebooks) return [];
    return Array.isArray(notebooks) ? notebooks : (notebooks.notebooks || []);
  }, [notebooks]);

  const { data: goalSummaries, isLoading: loadingGoals } = useQuery({
    queryKey: ['dashboard-goals-pulse', notebookList.length, isAuthenticated],
    queryFn: async (): Promise<GoalSummary[]> => {
      if (!isAuthenticated || notebookList.length === 0) return [];
      const summaries: GoalSummary[] = [];
      for (const nb of notebookList.slice(0, 6)) {
        try {
          const res = await ApiService.fetchResearchGoals(nb.id, session!.access_token, { includeArchived: false });
          const goals = res.goals || [];
          if (goals.length === 0) continue;
          const active = goals.filter((g: ResearchGoal) => g.status === 'active' || !g.status).length;
          const completed = goals.filter((g: ResearchGoal) => g.status === 'completed').length;
          const paused = goals.filter((g: ResearchGoal) => g.status === 'paused').length;
          summaries.push({
            notebookId: nb.id,
            notebookTitle: nb.title || 'Untitled notebook',
            total: goals.length,
            active,
            completed,
            paused,
            recentTitles: goals.slice(0, 3).map((g: ResearchGoal) => ({
              id: g.id, title: g.title, status: g.status || 'active', progressPct: g.progress_pct || 0
            })),
          });
        } catch {
          // skip notebook on error
        }
      }
      return summaries;
    },
    enabled: isAuthenticated && notebookList.length > 0,
    staleTime: 60_000,
  });

  if (loadingNotebooks || loadingGoals) {
    return (
      <div className="bg-white dark:bg-card border border-gray-100 dark:border-border rounded-2xl p-5 shadow-sm space-y-4">
        <div className="h-4 bg-gray-100 dark:bg-muted animate-pulse rounded w-1/3" />
        <div className="space-y-2">
          <div className="h-10 bg-gray-100 dark:bg-muted animate-pulse rounded-xl" />
          <div className="h-10 bg-gray-100 dark:bg-muted animate-pulse rounded-xl" />
        </div>
      </div>
    );
  }

  const summaries = goalSummaries || [];
  const totals = summaries.reduce(
    (acc, s) => ({
      active: acc.active + s.active,
      completed: acc.completed + s.completed,
      paused: acc.paused + s.paused,
    }),
    { active: 0, completed: 0, paused: 0 }
  );

  if (summaries.length === 0) {
    return (
      <div className="bg-white dark:bg-card border border-gray-100 dark:border-border rounded-2xl p-5 shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-50 dark:border-border/30 pb-3 mb-4">
          <h3 className="font-bold text-gray-900 dark:text-foreground text-sm flex items-center gap-2">
            <span className="w-6 h-6 rounded-md bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/40 flex items-center justify-center">
              <i className="fi fi-rr-bullseye text-indigo-600 dark:text-indigo-400 text-[10px]"></i>
            </span>
            <span>Research Goals</span>
          </h3>
        </div>
        <div className="text-center py-6">
          <div className="w-10 h-10 mx-auto rounded-full bg-gray-50 dark:bg-muted flex items-center justify-center mb-2">
            <i className="fi fi-rr-bullseye text-gray-300 dark:text-muted-foreground/40 text-base"></i>
          </div>
          <p className="text-xs font-bold text-gray-700 dark:text-muted-foreground">No goals yet</p>
          <p className="text-[10px] text-gray-400 mt-1 max-w-[200px] mx-auto">
            Open a notebook and add a research goal to start the synthesis loop.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-card border border-gray-100 dark:border-border rounded-2xl p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between border-b border-gray-50 dark:border-border/30 pb-3">
        <h3 className="font-bold text-gray-900 dark:text-foreground text-sm flex items-center gap-2">
          <span className="w-6 h-6 rounded-md bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/40 flex items-center justify-center">
            <i className="fi fi-rr-bullseye text-indigo-600 dark:text-indigo-400 text-[10px]"></i>
          </span>
          <span>Research Goals</span>
        </h3>
        <div className="flex items-center gap-1.5 text-[10px] font-semibold text-gray-400">
          <span className="bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full">{totals.active} active</span>
          {totals.completed > 0 && (
            <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full">{totals.completed} done</span>
          )}
        </div>
      </div>

      <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
        {summaries.map((s) => (
          <div key={s.notebookId} className="border border-gray-100 dark:border-border rounded-xl p-3 hover:border-indigo-100 dark:hover:border-indigo-900/50 transition-all">
            <div className="flex items-center justify-between mb-2">
              <Link
                to={`/notebook/${s.notebookId}`}
                className="text-xs font-bold text-gray-800 dark:text-foreground hover:text-indigo-600 dark:hover:text-indigo-400 truncate flex-1 min-w-0"
              >
                {s.notebookTitle}
              </Link>
              <span className="text-[10px] text-gray-400 font-mono flex-shrink-0 ml-2">
                {s.active}/{s.total}
              </span>
            </div>
            <div className="space-y-1.5">
              {s.recentTitles.map((g) => (
                <div key={g.id} className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    g.status === 'completed' ? 'bg-emerald-500' :
                    g.status === 'paused' ? 'bg-amber-500' : 'bg-indigo-500'
                  }`} />
                  <span className={`text-[11px] truncate flex-1 min-w-0 ${
                    g.status === 'completed' ? 'text-gray-400 line-through' : 'text-gray-700 dark:text-muted-foreground'
                  }`}>
                    {g.title}
                  </span>
                  {g.progressPct > 0 && g.progressPct < 100 && (
                    <span className="text-[9px] text-gray-400 font-mono flex-shrink-0">{g.progressPct}%</span>
                  )}
                </div>
              ))}
            </div>
            {s.total > 0 && s.active > 0 && (
              <div className="mt-2 h-1 bg-gray-100 dark:bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-indigo-500 to-indigo-400 rounded-full transition-all"
                  style={{ width: `${Math.round(((s.total - s.active) / s.total) * 100)}%` }}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default GoalsPulse;
