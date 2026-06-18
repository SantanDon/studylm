import React from 'react';
import { useSuggestedGoals, SuggestedGoal } from '@/hooks/useResearchGoals';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { FEATURE_FLAGS } from '@/config/featureFlags';

interface SuggestedGoalsForSourceProps {
  notebookId: string;
  sourceId: string;
}

const confidenceColor = (c: number) => {
  if (c >= 0.8) return 'text-emerald-700 bg-emerald-50 border-emerald-200';
  if (c >= 0.6) return 'text-indigo-700 bg-indigo-50 border-indigo-200';
  return 'text-gray-600 bg-gray-50 border-gray-200';
};

const SuggestedGoalsForSource: React.FC<SuggestedGoalsForSourceProps> = ({ notebookId, sourceId }) => {
  const { suggestions, computed, isLoading, rateLimited, retryIn, acceptSuggestion, isAccepting } = useSuggestedGoals(notebookId, sourceId);
  const { toast } = useToast();

  if (!FEATURE_FLAGS.SUGGESTED_GOALS_ENABLED) return null;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-gray-500 py-3 px-3 bg-gradient-to-r from-indigo-50/40 to-purple-50/40 border border-indigo-100/60 rounded-lg">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75 animate-ping"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
        </span>
        <span className="text-gray-600">Reading source and generating goal suggestions…</span>
      </div>
    );
  }

  if (rateLimited) {
    return (
      <div className="flex items-start gap-2 text-[11px] py-3 px-3 bg-amber-50/60 border border-amber-200/60 rounded-lg">
        <i className="fi fi-rr-clock text-amber-600 text-xs mt-0.5"></i>
        <div className="text-amber-800">
          <p className="font-semibold">Cooldown active</p>
          <p className="text-[10px] text-amber-700 mt-0.5">
            Suggestions were just generated. Try again in {retryIn}s or use ?force=true to refresh.
          </p>
        </div>
      </div>
    );
  }

  if (!suggestions || suggestions.length === 0) {
    return (
      <div className="text-[11px] text-gray-500 py-3 px-3 border border-dashed border-gray-200 rounded-lg bg-gray-50/40">
        <div className="flex items-center gap-2">
          <i className="fi fi-rr-bulb text-gray-400"></i>
          <span>No suggestions yet. They'll appear after the next source ingest or chat about this source.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between pt-1">
        <div className="text-[10px] uppercase font-bold text-gray-500 tracking-wider flex items-center gap-1.5">
          <span className="w-5 h-5 rounded-md bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center">
            <i className="fi fi-rr-bulb text-white text-[9px]"></i>
          </span>
          Suggested for this source
        </div>
        {computed && (
          <span className="text-[9px] text-emerald-600 font-medium px-1.5 py-0.5 bg-emerald-50 border border-emerald-200 rounded-full">
            ✨ just generated
          </span>
        )}
      </div>
      {suggestions.map((s: SuggestedGoal) => {
        const indices = typeof s.source_chunk_indices === 'string'
          ? JSON.parse(s.source_chunk_indices || '[]')
          : (s.source_chunk_indices || []);
        const accepted = s.status === 'accepted';
        return (
          <div
            key={s.id}
            className={`group relative p-3 rounded-xl border transition-all ${
              accepted
                ? 'bg-emerald-50/40 border-emerald-200/60'
                : 'bg-gradient-to-br from-white to-indigo-50/30 border-indigo-100/80 hover:border-indigo-200 hover:shadow-sm'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className={`text-[12px] font-semibold leading-snug ${
                  accepted ? 'text-emerald-800' : 'text-gray-800'
                }`}>
                  {s.title}
                </p>
                {s.rationale && (
                  <p className="text-[10.5px] text-gray-500 mt-1 leading-relaxed">{s.rationale}</p>
                )}
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  {typeof s.confidence === 'number' && (
                    <span className={`text-[9px] px-1.5 py-0.5 border rounded font-mono font-semibold ${confidenceColor(s.confidence)}`}>
                      {Math.round(s.confidence * 100)}% conf
                    </span>
                  )}
                  {Array.isArray(indices) && indices.length > 0 && (
                    <span className="text-[9px] text-gray-500 font-mono">
                      chunk {indices.slice(0, 3).join(', ')}{indices.length > 3 ? `+${indices.length - 3}` : ''}
                    </span>
                  )}
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                disabled={isAccepting || accepted}
                onClick={async () => {
                  try {
                    await acceptSuggestion(s.id);
                    toast({ title: accepted ? 'Goal added' : 'Suggestion accepted', description: s.title });
                  } catch (err: unknown) {
                    toast({ title: 'Failed to accept', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
                  }
                }}
                className={`h-7 px-2.5 text-[10.5px] rounded-lg font-semibold flex-shrink-0 ${
                  accepted
                    ? 'text-emerald-700 bg-emerald-100/60 cursor-default'
                    : 'text-white bg-indigo-600 hover:bg-indigo-700'
                }`}
              >
                {accepted ? (
                  <><i className="fi fi-rr-check text-[9px] mr-1"></i>Added</>
                ) : (
                  <><i className="fi fi-rr-plus text-[9px] mr-1"></i>Add</>
                )}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default SuggestedGoalsForSource;
