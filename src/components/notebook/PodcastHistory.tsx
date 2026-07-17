import React, { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faPlay, 
  faTrash, 
  faDownload, 
  faSpinner 
} from '@fortawesome/free-solid-svg-icons';
import { LocalPodcast } from '@/services/localStorageService';
import { indexedDBService } from '@/services/indexedDBService';
import { format } from 'date-fns';
import { usePodcastHistory } from '@/hooks/usePodcastHistory';

interface PodcastHistoryProps {
  notebookId: string;
  onPlay: (audioUrl: string, title: string) => void;
  currentAudioUrl?: string | null;
}

export const PodcastHistory: React.FC<PodcastHistoryProps> = ({
  notebookId,
  onPlay,
}) => {
  const { podcasts, isLoading, deletePodcast, isDeleting } = usePodcastHistory(notebookId);
  const [loadingAudioId, setLoadingAudioId] = useState<string | null>(null);

  const handlePlay = async (podcast: LocalPodcast) => {
    try {
      setLoadingAudioId(podcast.id);
      const blob = await indexedDBService.getAudio(podcast.audio_blob_id);
      
      if (blob) {
        const url = URL.createObjectURL(blob);
        onPlay(url, podcast.title);
      } else {
        console.error("Audio blob not found for id:", podcast.audio_blob_id);
        // Could show toast here
      }
    } catch (error) {
      console.error("Error loading audio:", error);
    } finally {
      setLoadingAudioId(null);
    }
  };

  const handleDownload = async (podcast: LocalPodcast) => {
    try {
      const blob = await indexedDBService.getAudio(podcast.audio_blob_id);
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${podcast.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.wav`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error("Error downloading audio:", error);
    }
  };

  const handleDelete = async (podcast: LocalPodcast) => {
    if (confirm('Are you sure you want to delete this podcast?')) {
      await deletePodcast(podcast);
    }
  };

  if (isLoading) {
    return <div className="text-center p-4 text-gray-500 dark:text-gray-400">Loading history...</div>;
  }

  if (!podcasts || podcasts.length === 0) {
    return (
      <div className="mt-8 border-t dark:border-zinc-800 pt-6 text-center text-gray-400 dark:text-gray-500">
        <p className="text-sm">No saved episodes yet.</p>
      </div>
    );
  }

  return (
    <div className="mt-8 border-t dark:border-zinc-800 pt-6">
      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4 uppercase tracking-wider">
        Past Episodes
      </h4>
      <div className="space-y-3">
        {podcasts.map((podcast) => (
          <div 
            key={podcast.id} 
            className="flex items-center justify-between p-3 bg-gray-50 dark:bg-zinc-900/50 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-900 transition-colors border border-transparent hover:border-gray-200 dark:hover:border-zinc-800 group"
          >
            <div className="flex items-center space-x-3 overflow-hidden">
              <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center flex-shrink-0">
                {loadingAudioId === podcast.id ? (
                  <FontAwesomeIcon icon={faSpinner} spin className="text-xs" />
                ) : (
                  <button onClick={() => handlePlay(podcast)}>
                     <FontAwesomeIcon icon={faPlay} className="text-xs ml-0.5" />
                  </button>
                )}
              </div>
              <div className="min-w-0">
                <p className="font-medium text-gray-900 dark:text-gray-100 text-sm truncate">{podcast.title}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {format(new Date(podcast.created_at), 'MMM d, yyyy • h:mm a')}
                  {podcast.duration && ` • ${Math.round(podcast.duration / 60)} min`}
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
               <button 
                onClick={() => handleDownload(podcast)}
                className="p-2 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded-full hover:bg-gray-200 dark:hover:bg-zinc-800 transition-colors"
                title="Download"
              >
                <FontAwesomeIcon icon={faDownload} className="text-xs" />
              </button>
              <button 
                onClick={() => handleDelete(podcast)}
                disabled={isDeleting}
                className="p-2 text-gray-400 hover:text-red-600 dark:hover:text-red-400 rounded-full hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                title="Delete"
              >
                <FontAwesomeIcon icon={faTrash} className="text-xs" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
