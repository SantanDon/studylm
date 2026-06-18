import React from 'react';
import { useSignalQueue } from '@/hooks/useSignalQueue';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

const WhatsHappening = () => {
  const { items, stats, isLoading, updateItem } = useSignalQueue({ limit: 4 });
  const { toast } = useToast();

  const handleApprove = async (id: string) => {
    try {
      await updateItem({ id, updates: { status: 'approved' } });
      toast({
        title: "Post approved",
        description: "Post is now staged for automated publishing."
      });
    } catch (err: unknown) {
      toast({
        title: "Approve failed",
        description: err instanceof Error ? err.message : "Failed to approve post",
        variant: "destructive"
      });
    }
  };

  const getPlatformIcon = (platform: string) => {
    switch (platform) {
      case 'linkedin':
        return 'fi fi-brands-linkedin text-blue-600 bg-blue-50';
      case 'twitter':
        return 'fi fi-brands-twitter text-gray-800 bg-gray-50';
      case 'reddit':
        return 'fi fi-brands-reddit text-orange-600 bg-orange-50';
      case 'threads':
        return 'fi fi-rr-comment text-pink-600 bg-pink-50';
      default:
        return 'fi fi-rr-share text-gray-600 bg-gray-50';
    }
  };

  if (isLoading && !stats) {
    return (
      <div className="bg-white dark:bg-card border border-gray-100 dark:border-border rounded-2xl p-5 shadow-sm space-y-4">
        <div className="h-4 bg-gray-100 dark:bg-muted animate-pulse rounded w-1/3"></div>
        <div className="space-y-2">
          <div className="h-10 bg-gray-100 dark:bg-muted animate-pulse rounded-xl"></div>
          <div className="h-10 bg-gray-100 dark:bg-muted animate-pulse rounded-xl"></div>
        </div>
      </div>
    );
  }

  // Filter drafts
  const drafts = items.filter(item => item.status === 'draft');

  return (
    <div className="bg-white dark:bg-card border border-gray-100 dark:border-border rounded-2xl p-5 shadow-sm space-y-5">
      <div className="flex items-center justify-between border-b border-gray-50 dark:border-border/30 pb-3">
        <h3 className="font-bold text-gray-900 dark:text-foreground text-sm flex items-center gap-2">
          <i className="fi fi-rr-megaphone text-indigo-600"></i>
          <span>Social Signal Staging</span>
        </h3>
        
        {stats && (
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-gray-400">
            <span className="bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full">{stats.draft} draft</span>
            <span className="bg-green-50 text-green-700 px-2 py-0.5 rounded-full">{stats.approved} ready</span>
          </div>
        )}
      </div>

      {drafts.length === 0 ? (
        <div className="text-center py-6">
          <div className="text-2xl text-gray-300 dark:text-muted-foreground/30 mb-2">✨</div>
          <p className="text-xs font-bold text-gray-700 dark:text-muted-foreground">Queue is clean</p>
          <p className="text-[10px] text-gray-400 mt-0.5">
            Hooks are created automatically when you deep-dive bookmarks.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Review Drafts:</div>
          <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
            {drafts.map((draft) => (
              <div 
                key={draft.id} 
                className="group relative p-3 border border-gray-100 dark:border-border rounded-xl bg-gray-50/30 hover:bg-gray-50/80 transition-all flex flex-col gap-2"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${getPlatformIcon(draft.platform)}`}>
                      <i className={draft.platform === 'twitter' ? 'fi fi-brands-twitter' : draft.platform === 'linkedin' ? 'fi fi-brands-linkedin' : 'fi fi-brands-reddit'}></i>
                    </span>
                    <span className="text-[10px] font-medium text-gray-400 capitalize">{draft.platform}</span>
                  </div>

                  <Button 
                    size="sm" 
                    onClick={() => handleApprove(draft.id)}
                    className="h-6 text-[10px] font-semibold px-2 rounded-lg bg-green-600 hover:bg-green-700 text-white shadow-sm"
                  >
                    Approve
                  </Button>
                </div>
                
                <p className="text-xs text-gray-600 dark:text-muted-foreground leading-relaxed line-clamp-3">
                  {draft.content}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default WhatsHappening;
