import React, { useState } from 'react';
import { useSignalQueue, SignalQueueItem } from '@/hooks/useSignalQueue';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';

interface SignalQueuePanelProps {
  notebookId?: string;
}

const SignalQueuePanel = ({ notebookId }: SignalQueuePanelProps) => {
  const [selectedStatus, setSelectedStatus] = useState<string>('draft');
  const [selectedPlatform, setSelectedPlatform] = useState<string>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState<string>('');
  const [isAddingNew, setIsAddingNew] = useState(false);
  
  // New item form state
  const [newPlatform, setNewPlatform] = useState<'linkedin' | 'twitter' | 'reddit' | 'threads'>('twitter');
  const [newContent, setNewContent] = useState('');
  const [newSchedule, setNewSchedule] = useState('');

  const { toast } = useToast();
  const { 
    items, 
    stats, 
    isLoading, 
    createItem, 
    updateItem, 
    deleteItem 
  } = useSignalQueue({
    notebookId,
    status: selectedStatus === 'all' ? undefined : selectedStatus,
    platform: selectedPlatform === 'all' ? undefined : selectedPlatform,
  });

  const handleStartEdit = (item: SignalQueueItem) => {
    setEditingId(item.id);
    setEditingContent(item.content);
  };

  const handleSaveEdit = async (item: SignalQueueItem) => {
    try {
      await updateItem({
        id: item.id,
        updates: { content: editingContent }
      });
      setEditingId(null);
      toast({
        title: "Post updated",
        description: "Your edits have been saved to the queue."
      });
    } catch (err: unknown) {
      toast({
        title: "Update failed",
        description: err instanceof Error ? err.message : "Failed to update post content",
        variant: "destructive"
      });
    }
  };

  const handleStatusChange = async (item: SignalQueueItem, newStatus: 'draft' | 'approved' | 'posted' | 'archived') => {
    try {
      const updates: { status: 'draft' | 'approved' | 'posted' | 'archived'; posted_at?: string } = { status: newStatus };
      if (newStatus === 'posted') {
        updates.posted_at = new Date().toISOString();
      }
      await updateItem({ id: item.id, updates });
      toast({
        title: `Post status changed`,
        description: `Successfully moved post to ${newStatus}.`
      });
    } catch (err: unknown) {
      toast({
        title: "Status change failed",
        description: err instanceof Error ? err.message : "Failed to change status",
        variant: "destructive"
      });
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Are you sure you want to permanently delete this post from the queue?")) return;
    try {
      await deleteItem(id);
      toast({
        title: "Post deleted",
        description: "The post was removed from the queue."
      });
    } catch (err: unknown) {
      toast({
        title: "Delete failed",
        description: err instanceof Error ? err.message : "Failed to delete post",
        variant: "destructive"
      });
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContent.trim()) {
      toast({
        title: "Empty content",
        description: "Please enter some text for your post",
        variant: "destructive"
      });
      return;
    }

    try {
      await createItem({
        notebookId,
        platform: newPlatform,
        content: newContent,
        scheduledFor: newSchedule ? new Date(newSchedule).toISOString() : undefined
      });
      
      setNewContent('');
      setNewSchedule('');
      setIsAddingNew(false);
      
      toast({
        title: "Post drafted",
        description: "Successfully added new social post draft to queue."
      });
    } catch (err: unknown) {
      toast({
        title: "Creation failed",
        description: err instanceof Error ? err.message : "Failed to create post draft",
        variant: "destructive"
      });
    }
  };

  const getPlatformConfig = (platform: string) => {
    switch (platform) {
      case 'linkedin':
        return { color: 'bg-blue-50 text-blue-700 border-blue-100', icon: 'fi fi-brands-linkedin', name: 'LinkedIn' };
      case 'twitter':
        return { color: 'bg-slate-50 text-slate-800 border-slate-200', icon: 'fi fi-brands-twitter', name: 'X / Twitter' };
      case 'reddit':
        return { color: 'bg-orange-50 text-orange-700 border-orange-100', icon: 'fi fi-brands-reddit', name: 'Reddit' };
      case 'threads':
        return { color: 'bg-pink-50 text-pink-700 border-pink-100', icon: 'fi fi-rr-comment', name: 'Threads' };
      default:
        return { color: 'bg-gray-50 text-gray-700 border-gray-100', icon: 'fi fi-rr-share', name: 'Social' };
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-5 border border-gray-100 shadow-sm rounded-2xl">
        <div>
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <i className="fi fi-rr-share-square text-indigo-600"></i>
            <span>Sovereign Signal Queue</span>
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Staged social media drafts created from research findings. Auto-publish, review, or schedule.
          </p>
        </div>
        <Button 
          onClick={() => setIsAddingNew(!isAddingNew)} 
          className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm"
        >
          <i className={`fi ${isAddingNew ? 'fi-rr-cross' : 'fi-rr-plus'} mr-2`}></i>
          {isAddingNew ? 'Cancel' : 'Add Social Post'}
        </Button>
      </div>

      {/* Stats row */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div 
            onClick={() => setSelectedStatus('draft')}
            className={`cursor-pointer p-4 bg-white border rounded-2xl shadow-sm transition-all hover:-translate-y-0.5 ${
              selectedStatus === 'draft' ? 'border-indigo-600 bg-indigo-50/5' : 'border-gray-100 hover:border-indigo-200'
            }`}
          >
            <div className="text-xs text-gray-400 font-semibold uppercase tracking-wider">Drafts</div>
            <div className="text-2xl font-black text-gray-800 mt-1">{stats.draft}</div>
          </div>
          <div 
            onClick={() => setSelectedStatus('approved')}
            className={`cursor-pointer p-4 bg-white border rounded-2xl shadow-sm transition-all hover:-translate-y-0.5 ${
              selectedStatus === 'approved' ? 'border-green-600 bg-green-50/5' : 'border-gray-100 hover:border-green-200'
            }`}
          >
            <div className="text-xs text-gray-400 font-semibold uppercase tracking-wider">Approved</div>
            <div className="text-2xl font-black text-green-700 mt-1">{stats.approved}</div>
          </div>
          <div 
            onClick={() => setSelectedStatus('posted')}
            className={`cursor-pointer p-4 bg-white border rounded-2xl shadow-sm transition-all hover:-translate-y-0.5 ${
              selectedStatus === 'posted' ? 'border-blue-600 bg-blue-50/5' : 'border-gray-100 hover:border-blue-200'
            }`}
          >
            <div className="text-xs text-gray-400 font-semibold uppercase tracking-wider">Posted</div>
            <div className="text-2xl font-black text-blue-700 mt-1">{stats.posted}</div>
          </div>
          <div 
            onClick={() => setSelectedStatus('archived')}
            className={`cursor-pointer p-4 bg-white border rounded-2xl shadow-sm transition-all hover:-translate-y-0.5 ${
              selectedStatus === 'archived' ? 'border-slate-600 bg-slate-50/5' : 'border-gray-100 hover:border-slate-200'
            }`}
          >
            <div className="text-xs text-gray-400 font-semibold uppercase tracking-wider">Archived</div>
            <div className="text-2xl font-black text-slate-700 mt-1">{stats.archived}</div>
          </div>
        </div>
      )}

      {/* Manual post creator drawer / collapse card */}
      {isAddingNew && (
        <form onSubmit={handleCreate} className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm space-y-4 transition-all">
          <h3 className="font-bold text-gray-800 text-sm">Create Social Hook Draft</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-gray-600">Platform</Label>
              <Select value={newPlatform} onValueChange={(val: string) => setNewPlatform(val as 'linkedin' | 'twitter' | 'reddit' | 'threads')}>
                <SelectTrigger className="rounded-xl border-gray-200">
                  <SelectValue placeholder="Select platform" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="twitter">X / Twitter</SelectItem>
                  <SelectItem value="linkedin">LinkedIn</SelectItem>
                  <SelectItem value="reddit">Reddit</SelectItem>
                  <SelectItem value="threads">Threads</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <Label className="text-xs font-semibold text-gray-600">Schedule (Optional)</Label>
              <input
                type="datetime-local"
                value={newSchedule}
                onChange={(e) => setNewSchedule(e.target.value)}
                className="w-full h-10 px-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-gray-600">Post Content</Label>
            <Textarea
              placeholder="What insights or hard data points are we striking with today?"
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              className="min-h-24 rounded-xl border-gray-200"
            />
          </div>

          <div className="flex justify-end space-x-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setIsAddingNew(false)} className="rounded-xl text-gray-500">
              Cancel
            </Button>
            <Button type="submit" className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm">
              Save Draft
            </Button>
          </div>
        </form>
      )}

      {/* Filter and Content Area */}
      <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
        {/* Filter bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 p-4 border-b border-gray-50 bg-gray-50/30">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Filters:</span>
            <Select value={selectedStatus} onValueChange={setSelectedStatus}>
              <SelectTrigger className="h-8 rounded-lg w-28 bg-white border-gray-200 text-xs">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="draft">Drafts</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="posted">Posted</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>

            <Select value={selectedPlatform} onValueChange={setSelectedPlatform}>
              <SelectTrigger className="h-8 rounded-lg w-32 bg-white border-gray-200 text-xs">
                <SelectValue placeholder="Platform" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Platforms</SelectItem>
                <SelectItem value="linkedin">LinkedIn</SelectItem>
                <SelectItem value="twitter">X / Twitter</SelectItem>
                <SelectItem value="reddit">Reddit</SelectItem>
                <SelectItem value="threads">Threads</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <span className="text-xs text-gray-500">
            Showing {items.length} post{items.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* List of queue items */}
        {isLoading ? (
          <div className="flex flex-col items-center justify-center p-12 space-y-2">
            <i className="fi fi-rr-spinner animate-spin text-indigo-600 text-2xl"></i>
            <span className="text-sm text-gray-500">Loading social signal queue...</span>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <div className="p-4 bg-gray-50 text-gray-400 rounded-full mb-3">
              <i className="fi fi-rr-megaphone text-3xl"></i>
            </div>
            <p className="text-sm font-bold text-gray-700">No posts in this queue</p>
            <p className="text-xs text-gray-400 max-w-sm mt-1">
              Select or import research bookmarks, or click "Add Social Post" to draft custom outreach hooks.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {items.map((item) => {
              const platform = getPlatformConfig(item.platform);
              const isEditing = editingId === item.id;

              return (
                <div key={item.id} className="p-5 hover:bg-gray-50/40 transition-all flex flex-col gap-4">
                  {/* Item top metadata row */}
                  <div className="flex justify-between items-center">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`px-2.5 py-0.5 rounded-full border text-xs font-semibold flex items-center gap-1.5 ${platform.color}`}>
                        <i className={platform.icon}></i>
                        {platform.name}
                      </span>

                      {item.scheduled_for && (
                        <span className="text-xs bg-indigo-50/50 text-indigo-600 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                          <i className="fi fi-rr-calendar-clock"></i>
                          {new Date(item.scheduled_for).toLocaleString()}
                        </span>
                      )}

                      {/* Status Badges */}
                      {item.status === 'draft' && (
                        <span className="text-[10px] uppercase font-bold tracking-wider text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">Draft</span>
                      )}
                      {item.status === 'approved' && (
                        <span className="text-[10px] uppercase font-bold tracking-wider text-green-700 bg-green-50 px-2 py-0.5 rounded-full">Approved</span>
                      )}
                      {item.status === 'posted' && (
                        <span className="text-[10px] uppercase font-bold tracking-wider text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">Posted</span>
                      )}
                      {item.status === 'archived' && (
                        <span className="text-[10px] uppercase font-bold tracking-wider text-slate-700 bg-slate-50 px-2 py-0.5 rounded-full">Archived</span>
                      )}
                    </div>

                    <div className="flex items-center space-x-1.5">
                      {isEditing ? (
                        <>
                          <Button 
                            size="sm" 
                            variant="outline" 
                            onClick={() => setEditingId(null)}
                            className="rounded-lg h-7 px-2.5 text-xs text-gray-500 border-gray-200"
                          >
                            Cancel
                          </Button>
                          <Button 
                            size="sm" 
                            onClick={() => handleSaveEdit(item)}
                            className="rounded-lg h-7 px-2.5 text-xs bg-indigo-600 hover:bg-indigo-700 text-white"
                          >
                            Save
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button 
                            size="sm" 
                            variant="ghost" 
                            onClick={() => handleStartEdit(item)}
                            className="rounded-lg h-7 w-7 p-0 text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                            title="Edit content"
                          >
                            <i className="fi fi-rr-edit text-sm"></i>
                          </Button>
                          <Button 
                            size="sm" 
                            variant="ghost" 
                            onClick={() => handleDelete(item.id)}
                            className="rounded-lg h-7 w-7 p-0 text-gray-400 hover:text-red-600 hover:bg-red-50"
                            title="Delete"
                          >
                            <i className="fi fi-rr-trash text-sm"></i>
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Body Text / Editor */}
                  {isEditing ? (
                    <Textarea
                      value={editingContent}
                      onChange={(e) => setEditingContent(e.target.value)}
                      className="text-sm leading-relaxed text-gray-800 border-gray-200 focus:border-indigo-500 rounded-xl"
                      rows={4}
                    />
                  ) : (
                    <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed font-sans">{item.content}</p>
                  )}

                  {/* Date & Quick Action Footer Row */}
                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 pt-2 border-t border-gray-50 text-xs text-gray-400">
                    <span>Staged {new Date(item.created_at).toLocaleDateString()}</span>
                    
                    <div className="flex flex-wrap items-center gap-1.5">
                      {item.status !== 'approved' && item.status !== 'posted' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleStatusChange(item, 'approved')}
                          className="h-7 text-xs rounded-lg text-green-700 border-green-100 bg-green-50/20 hover:bg-green-50"
                        >
                          <i className="fi fi-rr-check mr-1.5"></i>
                          Approve Post
                        </Button>
                      )}
                      {item.status !== 'posted' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleStatusChange(item, 'posted')}
                          className="h-7 text-xs rounded-lg text-blue-700 border-blue-100 bg-blue-50/20 hover:bg-blue-50"
                        >
                          <i className="fi fi-rr-share mr-1.5"></i>
                          Publish Manually
                        </Button>
                      )}
                      {item.status !== 'archived' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleStatusChange(item, 'archived')}
                          className="h-7 text-xs rounded-lg text-slate-600 border-slate-150 bg-slate-50/20 hover:bg-slate-50"
                        >
                          Archive
                        </Button>
                      )}
                      {item.status === 'archived' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleStatusChange(item, 'draft')}
                          className="h-7 text-xs rounded-lg text-amber-700 border-amber-100 bg-amber-50/20 hover:bg-amber-50"
                        >
                          Revert to Draft
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default SignalQueuePanel;
