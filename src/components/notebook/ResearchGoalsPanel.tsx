import React, { useState, useMemo } from 'react';
import { useResearchGoals, ResearchGoal } from '@/hooks/useResearchGoals';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import SuggestedGoalsForSource from './SuggestedGoalsForSource';

interface ResearchGoalsPanelProps {
  notebookId: string;
  activeSourceId?: string | null;
}

type Filter = 'active' | 'completed' | 'all';

const priorityColor = (p?: string) => {
  if (p === 'high') return 'bg-rose-50 text-rose-600 border-rose-200';
  if (p === 'medium') return 'bg-amber-50 text-amber-600 border-amber-200';
  if (p === 'low') return 'bg-gray-50 text-gray-500 border-gray-200';
  return 'bg-gray-50 text-gray-400 border-gray-200';
};

const ResearchGoalsPanel = ({ notebookId, activeSourceId }: ResearchGoalsPanelProps) => {
  const [isAdding, setIsAdding] = useState(false);
  const [parentGoalId, setParentGoalId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [filter, setFilter] = useState<Filter>('active');

  const { goals, isLoading, createGoal, updateGoal, deleteGoal } = useResearchGoals(notebookId, { includeArchived: filter === 'all' });
  const { toast } = useToast();

  const totals = useMemo(() => {
    const active = goals.filter(g => g.status !== 'completed' && g.status !== 'archived').length;
    const completed = goals.filter(g => g.status === 'completed').length;
    return { active, completed, total: goals.length };
  }, [goals]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast({ title: 'Missing title', description: 'Please specify a title for your goal.', variant: 'destructive' });
      return;
    }
    try {
      await createGoal({ title, description, parentGoalId: parentGoalId || undefined, priority });
      setTitle('');
      setDescription('');
      setPriority('medium');
      setIsAdding(false);
      setParentGoalId(null);
      toast({ title: 'Goal added', description: 'Your research goal is active.' });
    } catch (err: any) {
      toast({ title: 'Failed to add goal', description: err.message || 'An error occurred.', variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to remove this research goal?')) return;
    try {
      await deleteGoal(id);
      toast({ title: 'Goal removed', description: 'The research goal was deleted.' });
    } catch (err: any) {
      toast({ title: 'Failed to delete', description: err.message || 'An error occurred.', variant: 'destructive' });
    }
  };

  const handleComplete = async (goal: ResearchGoal) => {
    try {
      await updateGoal({ goalId: goal.id, updates: { status: 'completed', progressPct: 100 } });
      toast({ title: 'Goal completed', description: goal.title });
    } catch (err: any) {
      toast({ title: 'Failed to complete', description: err?.message, variant: 'destructive' });
    }
  };

  const handleAddChild = (parentId: string) => {
    setParentGoalId(parentId);
    setIsAdding(true);
  };

  const filteredGoals = goals.filter(g => {
    if (filter === 'active') return g.status !== 'completed' && g.status !== 'archived';
    if (filter === 'completed') return g.status === 'completed';
    return true;
  });

  const renderGoal = (goal: ResearchGoal, depth: number = 0) => {
    const children = goals.filter(g => g.parent_goal_id === goal.id);
    const pct = typeof goal.progress_pct === 'number' ? goal.progress_pct : 0;
    const isCompleted = goal.status === 'completed';
    return (
      <div key={goal.id} className="relative" style={{ marginLeft: depth * 14 }}>
        {depth > 0 && (
          <span className="absolute -left-2 top-3 w-2 h-px bg-gray-200" aria-hidden="true" />
        )}
        <div
          className={`p-3 rounded-xl border transition-all group ${
            isCompleted
              ? 'bg-emerald-50/30 border-emerald-100/80'
              : 'bg-white border-gray-100 hover:border-indigo-200 hover:shadow-sm'
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <h4 className="text-xs font-semibold text-gray-800 flex items-center gap-1.5 flex-1 min-w-0">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                isCompleted ? 'bg-emerald-500' :
                goal.status === 'paused' ? 'bg-amber-500' : 'bg-indigo-500'
              }`}></span>
              <span className={isCompleted ? 'line-through text-gray-400' : ''}>{goal.title}</span>
            </h4>
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
              {!isCompleted && (
                <Button size="sm" variant="ghost" onClick={() => handleComplete(goal)} title="Mark complete" className="h-6 w-6 p-0 text-gray-400 hover:text-emerald-500 hover:bg-emerald-50 rounded-md">
                  <i className="fi fi-rr-check text-[10px]"></i>
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => handleAddChild(goal.id)} title="Add child goal" className="h-6 w-6 p-0 text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 rounded-md">
                <i className="fi fi-rr-plus text-[10px]"></i>
              </Button>
              <Button size="sm" variant="ghost" onClick={() => handleDelete(goal.id)} title="Delete" className="h-6 w-6 p-0 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md">
                <i className="fi fi-rr-trash text-[10px]"></i>
              </Button>
            </div>
          </div>
          {goal.description && (
            <p className={`text-[10.5px] mt-1.5 leading-relaxed pl-3.5 font-sans ${isCompleted ? 'text-gray-400' : 'text-gray-600'}`}>
              {goal.description}
            </p>
          )}
          <div className="flex items-center gap-1.5 mt-2 pl-3.5 flex-wrap">
            {goal.priority && (
              <span className={`text-[9px] px-1.5 py-0.5 border rounded font-bold uppercase tracking-wide ${priorityColor(goal.priority)}`}>
                {goal.priority}
              </span>
            )}
            {goal.status && goal.status !== 'active' && goal.status !== 'completed' && (
              <span className="text-[9px] px-1.5 py-0.5 border rounded font-semibold bg-amber-50 text-amber-700 border-amber-200">
                {goal.status}
              </span>
            )}
            {goal.source_id && (
              <span className="text-[9px] text-gray-500 font-mono flex items-center gap-0.5">
                <i className="fi fi-rr-document text-[8px]"></i>
                source-linked
              </span>
            )}
            {goal.linked_task_ids && goal.linked_task_ids.length > 0 && (
              <span className="text-[9px] text-gray-500 font-mono flex items-center gap-0.5">
                <i className="fi fi-rr-checkbox text-[8px]"></i>
                {goal.linked_task_ids.length} task{goal.linked_task_ids.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          {!isCompleted && pct > 0 && (
            <div className="mt-2 pl-3.5">
              <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )}
        </div>
        {children.map(child => renderGoal(child, depth + 1))}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {activeSourceId && (
        <SuggestedGoalsForSource notebookId={notebookId} sourceId={activeSourceId} />
      )}

      <div className="flex items-center justify-between pb-2.5 border-b border-gray-200/60">
        <div className="flex items-center gap-0.5 p-0.5 bg-gray-100/60 rounded-lg">
          {(['active', 'completed', 'all'] as Filter[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-[10px] px-2.5 py-1 rounded-md font-semibold transition-all ${
                filter === f
                  ? 'bg-white text-indigo-700 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {f[0].toUpperCase() + f.slice(1)}
              {f === 'active' && totals.active > 0 && (
                <span className="ml-1 text-[9px] text-indigo-500 font-mono">{totals.active}</span>
              )}
              {f === 'completed' && totals.completed > 0 && (
                <span className="ml-1 text-[9px] text-emerald-500 font-mono">{totals.completed}</span>
              )}
            </button>
          ))}
        </div>
        <Button
          size="sm"
          onClick={() => { setIsAdding(!isAdding); setParentGoalId(null); }}
          className={`h-7 text-[11px] rounded-lg font-semibold ${
            isAdding
              ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm'
          }`}
        >
          <i className={`fi ${isAdding ? 'fi-rr-cross-small' : 'fi-rr-plus-small'} mr-1`}></i>
          {isAdding ? 'Cancel' : parentGoalId ? '+ Child goal' : '+ Add goal'}
        </Button>
      </div>

      {isAdding && (
        <form onSubmit={handleCreate} className="bg-gradient-to-br from-gray-50/60 to-indigo-50/30 border border-indigo-100/60 p-3.5 rounded-xl space-y-3">
          {parentGoalId && (
            <div className="text-[10px] text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-1 rounded-md flex items-center gap-1.5">
              <i className="fi fi-rr-corner-down-right text-[10px]"></i>
              Child of: <span className="font-semibold">{goals.find(g => g.id === parentGoalId)?.title}</span>
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-[10px] uppercase font-bold text-gray-500 tracking-wide">Goal title</Label>
            <Input placeholder="e.g. Find improvements for my agents" value={title} onChange={(e) => setTitle(e.target.value)} className="h-8 text-xs rounded-lg border-gray-200 focus:border-indigo-300" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase font-bold text-gray-500 tracking-wide">Criteria / focus areas</Label>
            <Textarea placeholder="e.g. Scan bookmarks for LLM orchestration, agent frameworks, or local model fine-tuning tips." value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-16 text-xs rounded-lg border-gray-200 focus:border-indigo-300" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase font-bold text-gray-500 tracking-wide">Priority</Label>
            <div className="flex gap-1.5">
              {(['low', 'medium', 'high'] as const).map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
                  className={`text-[10px] px-3 py-1 rounded-md font-semibold border transition-all ${
                    priority === p
                      ? p === 'high' ? 'bg-rose-50 border-rose-300 text-rose-700'
                      : p === 'medium' ? 'bg-amber-50 border-amber-300 text-amber-700'
                      : 'bg-gray-50 border-gray-300 text-gray-700'
                      : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-end pt-1">
            <Button type="submit" disabled={!title.trim()} className="h-7 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-3">
              Save goal
            </Button>
          </div>
        </form>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-8 text-xs text-gray-400">
          <i className="fi fi-rr-spinner animate-spin mr-2"></i>
          Loading goals…
        </div>
      ) : filteredGoals.length === 0 ? (
        <div className="text-center py-8 px-4 border border-dashed border-gray-200 rounded-xl bg-gradient-to-br from-gray-50/40 to-indigo-50/20">
          <div className="w-10 h-10 mx-auto rounded-full bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center mb-3">
            <i className="fi fi-rr-bullseye text-indigo-500 text-base"></i>
          </div>
          {filter === 'active' ? (
            <>
              <p className="text-xs font-bold text-gray-700">No active goals yet</p>
              <p className="text-[10.5px] text-gray-500 mt-1 max-w-[220px] mx-auto leading-relaxed">
                Define what you want to learn and StudyPod will auto-synthesize bookmark findings into action recommendations.
              </p>
            </>
          ) : filter === 'completed' ? (
            <>
              <p className="text-xs font-bold text-gray-700">No completed goals</p>
              <p className="text-[10.5px] text-gray-500 mt-1 max-w-[220px] mx-auto">
                Goals you mark complete will appear here.
              </p>
            </>
          ) : (
            <p className="text-xs text-gray-500">No goals in this notebook yet.</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredGoals.filter(g => !g.parent_goal_id).map(root => renderGoal(root, 0))}
        </div>
      )}
    </div>
  );
};

export default ResearchGoalsPanel;
