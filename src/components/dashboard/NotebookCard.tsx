import React, { useState } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useNotebookDelete } from '@/hooks/useNotebookDelete';
import { useToast } from '@/hooks/use-toast';

interface NotebookCardProps {
  notebook: {
    id: string;
    title: string;
    date: string;
    sources: number;
    icon: string;
    color: string;
    hasCollaborators?: boolean;
    joinCode?: string;
  };
  isSelectionMode?: boolean;
}

const NotebookCard = ({
  notebook,
  isSelectionMode = false
}: NotebookCardProps) => {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const {
    deleteNotebook,
    isDeleting
  } = useNotebookDelete();
  const { toast } = useToast();

  const handleShareClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (notebook.joinCode) {
      navigator.clipboard.writeText(notebook.joinCode);
      toast({
        title: "Join code copied!",
        description: `Code ${notebook.joinCode} copied to clipboard. Share it with your teammate!`,
      });
    }
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    console.log('Delete button clicked for notebook:', notebook.id);
    setShowDeleteDialog(true);
  };

  const handleConfirmDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    console.log('Confirming delete for notebook:', notebook.id);
    deleteNotebook(notebook.id);
    setShowDeleteDialog(false);
  };

  // Generate CSS classes from color name
  const colorName = notebook.color || 'gray';
  const backgroundClass = `bg-${colorName}-100`;
  const borderClass = `border-${colorName}-200`;

  return <div 
      className={`rounded-lg border ${borderClass} ${backgroundClass} p-4 hover:shadow-md transition-shadow cursor-pointer relative h-48 flex flex-col`}
    >
      {!isSelectionMode && (
        <div className="absolute top-3 right-3 flex items-center space-x-1" data-delete-action="true">
          {notebook.joinCode && (
            <button onClick={handleShareClick} className="p-1 hover:bg-black/5 dark:hover:bg-white/10 rounded text-gray-400 hover:text-foreground transition-colors" title="Copy share join code" data-delete-action="true">
              <i className="fi fi-rr-share h-4 w-4"></i>
            </button>
          )}
          <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
            <AlertDialogTrigger asChild>
              <button onClick={handleDeleteClick} className="p-1 hover:bg-red-50 rounded text-gray-400 hover:text-red-500 transition-colors delete-button" disabled={isDeleting} data-delete-action="true">
                <i className="fi fi-rr-trash h-4 w-4"></i>
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this notebook?</AlertDialogTitle>
                <AlertDialogDescription>
                  You're about to delete this notebook and all of its content. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleConfirmDelete} className="bg-blue-600 hover:bg-blue-700" disabled={isDeleting}>
                  {isDeleting ? 'Deleting...' : 'Delete'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
      
      <div className="w-12 h-12 rounded-lg flex items-center justify-center mb-4">
        <span className="text-3xl">{notebook.icon}</span>
      </div>
      
      <h3 className="text-gray-900 mb-2 pr-6 line-clamp-2 text-2xl font-normal flex-grow">
        {notebook.title}
      </h3>
      
      <div className="flex items-center justify-between text-sm text-gray-500 mt-auto">
        <span>{notebook.date} • {notebook.sources} source{notebook.sources !== 1 ? 's' : ''}</span>
      </div>
    </div>;
};

export default NotebookCard;
