import React, { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import NotebookCard from './NotebookCard';
import { useNotebooks } from '@/hooks/useNotebooks';
import { useNavigate } from 'react-router-dom';
import { useGuest } from '@/hooks/useGuest';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from "@/hooks/use-toast";
import { useNotebookBatchDelete } from '@/hooks/useNotebookBatchDelete';

const NotebookGrid = () => {
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [sortBy, setSortBy] = useState('Most recent');
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  
  const {
    notebooks,
    isLoading,
    createNotebook,
    isCreating
  } = useNotebooks();
  
  const { deleteMultiple, isDeleting: isBatchDeleting } = useNotebookBatchDelete();
  const navigate = useNavigate();
  const { canCreateNotebook, showAuthPrompt, isGuest } = useGuest();
  const { toast } = useToast();

  const sortedNotebooks = useMemo(() => {
    if (!notebooks) return [];
    
    const sorted = [...notebooks];
    
    if (sortBy === 'Most recent') {
      return sorted.sort((a, b) => {
        const dateA = a.updated_at ? new Date(a.updated_at).getTime() : 0;
        const dateB = b.updated_at ? new Date(b.updated_at).getTime() : 0;
        return dateB - dateA;
      });
    } else if (sortBy === 'Title') {
      return sorted.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    }
    
    return sorted;
  }, [notebooks, sortBy]);

  const toggleSelection = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleBatchDelete = async () => {
    if (selectedIds.length === 0) return;
    
    if (window.confirm(`Are you sure you want to delete ${selectedIds.length} notebooks?`)) {
      deleteMultiple(selectedIds, {
        onSuccess: () => {
          setSelectedIds([]);
          setIsSelectionMode(false);
        }
      });
    }
  };

  const handleCreateNotebook = () => {
    // Check guest limit
    if (isGuest && !canCreateNotebook) {
      showAuthPrompt('create notebook');
      return;
    }

    createNotebook({
      title: 'Untitled notebook',
      description: ''
    }, {
      onSuccess: data => {
        console.log('Navigating to notebook:', data.id);
        navigate(`/notebook/${data.id}`);
      },
      onError: error => {
        console.error('Failed to create notebook:', error);
        toast({
          title: "Error creating notebook",
          description: error instanceof Error ? error.message : "Unknown error",
          variant: "destructive",
        });
      }
    });
  };

  const handleNotebookClick = (notebookId: string, e: React.MouseEvent) => {
    if (isSelectionMode) {
      toggleSelection(notebookId, e);
      return;
    }

    // Check if the click is coming from a delete action or other interactive element
    const target = e.target as HTMLElement;
    const isDeleteAction = target.closest('[data-delete-action="true"]') || target.closest('.delete-button') || target.closest('[role="dialog"]');
    if (isDeleteAction) {
      console.log('Click prevented due to delete action');
      return;
    }
    navigate(`/notebook/${notebookId}`);
  };

  if (isLoading) {
    return <div className="text-center py-16">
        <p className="text-gray-600">Loading notebooks...</p>
      </div>;
  }

  return <div className="relative">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center space-x-3">
          {!isSelectionMode ? (
            <Button className="bg-black hover:bg-gray-800 text-white rounded-full px-6" onClick={handleCreateNotebook} disabled={isCreating}>
              {isCreating ? 'Creating...' : '+ Create new'}
            </Button>
          ) : (
            <div className="flex items-center space-x-2 bg-blue-50 border border-blue-100 px-4 py-2 rounded-full">
              <span className="text-sm font-medium text-blue-700">{selectedIds.length} selected</span>
              <Button 
                variant="ghost" 
                size="sm" 
                className="h-8 text-blue-600 hover:text-blue-800 hover:bg-blue-100"
                onClick={() => { setSelectedIds([]); setIsSelectionMode(false); }}
              >
                Cancel
              </Button>
            </div>
          )}
        </div>
        
        <div className="flex items-center space-x-4">
          <Button 
            variant="outline" 
            className={`rounded-lg ${isSelectionMode ? 'bg-blue-50 border-blue-200 text-blue-700' : ''}`}
            onClick={() => {
              setIsSelectionMode(!isSelectionMode);
              if (isSelectionMode) setSelectedIds([]);
            }}
          >
            <i className={`fi ${isSelectionMode ? 'fi-rr-cross-small' : 'fi-rr-list-check'} mr-2`}></i>
            {isSelectionMode ? 'Exit Selection' : 'Select'}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <div className="flex items-center space-x-2 bg-white rounded-lg border px-3 py-2 cursor-pointer hover:bg-gray-50 transition-colors">
                <span className="text-sm text-gray-600">{sortBy}</span>
                <i className="fi fi-rr-angle-down h-4 w-4 text-gray-400"></i>
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => setSortBy('Most recent')} className="flex items-center justify-between">
                Most recent
                {sortBy === 'Most recent' && <i className="fi fi-rr-check h-4 w-4"></i>}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortBy('Title')} className="flex items-center justify-between">
                Title
                {sortBy === 'Title' && <i className="fi fi-rr-check h-4 w-4"></i>}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 pb-24">
        {sortedNotebooks.map(notebook => (
          <div key={notebook.id} onClick={e => handleNotebookClick(notebook.id, e)} className="relative group">
            <NotebookCard notebook={{
              id: notebook.id,
              title: notebook.title || 'Untitled',
              date: notebook.updated_at ? new Date(notebook.updated_at).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
              }) : 'No date',
              sources: notebook.sources?.[0]?.count || 0,
              icon: notebook.icon || '📝',
              color: notebook.color || 'bg-gray-100'
            }} />
            
            {isSelectionMode && (
              <div className="absolute inset-0 bg-blue-500/10 rounded-lg pointer-events-none border-2 border-transparent transition-all group-hover:border-blue-400">
                <div className={`absolute top-3 left-3 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                  selectedIds.includes(notebook.id) 
                    ? 'bg-blue-600 border-blue-600' 
                    : 'bg-white border-gray-300'
                }`}>
                  {selectedIds.includes(notebook.id) && (
                    <i className="fi fi-rr-check text-white text-xs"></i>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {isSelectionMode && selectedIds.length > 0 && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-white border border-gray-200 shadow-2xl rounded-2xl px-6 py-4 flex items-center space-x-6 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-gray-900">{selectedIds.length} notebooks selected</span>
            <span className="text-xs text-gray-500 italic">This will delete all content within these notebooks.</span>
          </div>
          <div className="h-8 w-px bg-gray-200"></div>
          <div className="flex items-center space-x-3">
             <Button 
              variant="destructive" 
              className="rounded-xl px-6 font-semibold"
              onClick={handleBatchDelete}
              disabled={isBatchDeleting}
            >
              {isBatchDeleting ? 'Cleaning up...' : 'Delete Permanently'}
            </Button>
          </div>
        </div>
      )}
    </div>;
};

export default NotebookGrid;
