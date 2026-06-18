import React, { useState, useEffect, useRef } from 'react';
import { 
  Book, Play, Pause, User, ChevronDown, 
  Headphones, Download, Loader2, BookOpen,
  Sparkles, CheckCircle2, Globe
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card } from '@/components/ui/card';
import { useSources } from '@/hooks/useSources';
import { useNotebooks } from '@/hooks/useNotebooks';
import { useNotebookUpdate } from '@/hooks/useNotebookUpdate';
import { useAudiobookStore } from '@/stores/audiobookStore';
import { toast } from 'sonner';
import type { Source } from '@/types/domain/Source';

// Use empty string (relative URLs) by default — Vite proxy handles /api → backend.
// Set VITE_BACKEND_URL for production or custom setups.
const BACKEND_URL = (import.meta.env as { VITE_BACKEND_URL?: string }).VITE_BACKEND_URL || '';

interface AudiobookViewProps {
  notebookId: string;
}

export default function AudiobookView({ notebookId }: AudiobookViewProps) {
  const { sources, addSourceAsync } = useSources(notebookId);
  const { notebooks } = useNotebooks();
  const { updateNotebook } = useNotebookUpdate();
  
  const currentNotebook = notebooks.find(n => n.id === notebookId);
  const { 
    selectedVoice, setSelectedVoice, 
    isGenerating, setGenerating,
    currentChapterId, setCurrentChapterId,
    audioUrl, setAudioUrl
  } = useAudiobookStore();

  const [voices, setVoices] = useState<string[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [fullBookJobId, setFullBookJobId] = useState<string | null>(null);
  const [fullBookProgress, setFullBookProgress] = useState(0);
  const [fullBookUrl, setFullBookUrl] = useState<string | null>(null);
  const [gutenbergId, setGutenbergId] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Filter for ebook sources
  const ebooks = sources?.map(s => {
    let parsed = s;
    if (typeof s.metadata === 'string') {
      try {
        parsed = { ...s, metadata: JSON.parse(s.metadata) };
      } catch (e) {
        parsed = s;
      }
    }
    return parsed;
  }).filter(s => s.type === 'ebook') || [];

  useEffect(() => {
    fetchVoices();
  }, []);

  useEffect(() => {
    if (audioRef.current && audioUrl) {
      if (isPlaying) {
        const playPromise = audioRef.current.play();
        if (playPromise !== undefined) {
          playPromise.catch(error => {
            console.error("Playback error:", error);
            setIsPlaying(false);
          });
        }
      } else {
        audioRef.current.pause();
      }
    }
  }, [isPlaying, audioUrl]);

  // Polling for full book generation
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (fullBookJobId) {
      interval = setInterval(async () => {
        try {
          const res = await fetch(`${BACKEND_URL}/api/audiobook/job-status/${fullBookJobId}`);
          const data = await res.json();
          if (data.status === 'completed') {
            setFullBookUrl(`${BACKEND_URL}${data.url}`);
            setFullBookJobId(null);
            setFullBookProgress(100);
            toast.success("Full audiobook generated!");
          } else if (data.status === 'processing') {
            setFullBookProgress(data.progress);
          } else if (data.status === 'failed') {
            setFullBookJobId(null);
            toast.error("Full book generation failed");
          }
        } catch (e) {
          console.error("Status check failed", e);
        }
      }, 2000);
    }
    return () => clearInterval(interval);
  }, [fullBookJobId]);

  const fetchVoices = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/audiobook/voices`);
      const data = await res.json();
      setVoices(data.voices);
    } catch (err) {
      console.error('Failed to load voices');
    }
  };

  const formatTime = (time: number) => {
    if (isNaN(time)) return '0:00';
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
    }
  };

  const generateAudio = async (sourceId: string, chapterId: string, title: string) => {
    setGenerating(true);
    setCurrentChapterId(chapterId);
    try {
      const source = sources?.find(s => s.id === sourceId);
      const fileName = source?.metadata?.fileName || source?.title || 'unknown.epub';
      
      const url = `${BACKEND_URL}/api/audiobook/generate/${chapterId}?voice=${selectedVoice}&file=${encodeURIComponent(fileName)}`;
      
      setAudioUrl(url);
      setIsPlaying(true);
      toast.success(`Narration started for ${title}`);
    } catch (err) {
      toast.error('Failed to generate narration');
    } finally {
      setGenerating(false);
    }
  };

  const generateFullBook = async (book: Source) => {
    try {
      const meta = book.metadata as Record<string, unknown> | undefined;
      const fileName = (meta?.fileName as string) || book.title || 'phaedrus.epub';
      const chapters = (meta?.chapters as Array<{ id: string }>) || [];
      const chapterIds = chapters.map(c => c.id);
      
      const res = await fetch(`${BACKEND_URL}/api/audiobook/generate-full`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName, voice: selectedVoice, chapterIds })
      });
      const data = await res.json();
      setFullBookJobId(data.jobId);
      setFullBookUrl(null);
      setFullBookProgress(0);
      toast.info("Generating full audiobook...");
    } catch (err) {
      toast.error("Full generation failed to start");
    }
  };

  const handleGutenbergImport = async () => {
    if (!gutenbergId) return;
    setIsImporting(true);
    const id = gutenbergId.trim();
    
    try {
      const res = await fetch(`${BACKEND_URL}/api/audiobook/import-gutenberg`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId: id })
      });
      
      if (!res.ok) throw new Error("Failed to fetch from Gutenberg");
      
      const data = await res.json();
      
      await addSourceAsync({
        notebookId,
        title: data.title,
        type: 'ebook',
        content: data.content,
        metadata: {
          author: data.author,
          description: data.description,
          chapters: data.chapters,
          fileName: data.fileName,
          gutenbergId: data.gutenbergId
        }
      });
      
      setGutenbergId('');
      toast.success(`Imported "${data.title}" successfully!`);

      // Update notebook title if it's untitled
      if (currentNotebook && (
          currentNotebook.title === 'Untitled notebook' || 
          currentNotebook.title === 'Untitled Notebook' ||
          !currentNotebook.title
      )) {
        updateNotebook({ id: notebookId, updates: { title: data.title } });
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to import from Project Gutenberg");
    } finally {
      setIsImporting(false);
    }
  };

  const handleDownload = (url: string | null) => {
    const downloadUrl = url || audioUrl;
    if (!downloadUrl) return;
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = url ? 'full-audiobook.wav' : `chapter-${currentChapterId}.wav`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (ebooks.length === 0) {
    return (
      <Card className="bg-black/20 border-white/5 overflow-hidden">
        <div className="p-4 border-b border-white/5 bg-white/[0.02]">
           <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                <Globe className="w-4 h-4 text-indigo-400" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white tracking-tight">E-book Import</h4>
                <p className="text-[10px] text-white/30">Project Gutenberg</p>
              </div>
           </div>
        </div>
        <div className="p-8 text-center bg-white/[0.01]">
          <div className="w-12 h-12 rounded-full bg-white/[0.02] border border-white/5 flex items-center justify-center mx-auto mb-4 text-white/10">
            <Book className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-semibold text-white/40 mb-2">Source an E-book</h3>
          <p className="text-[10px] text-white/20 leading-relaxed max-w-[200px] mx-auto mb-6">
            Enter a Book ID from Project Gutenberg to pull free literature into your studio.
          </p>
          
          <div className="flex gap-2 max-w-[240px] mx-auto">
            <input 
              type="text" 
              placeholder="Book ID (e.g. 1342)"
              value={gutenbergId}
              onChange={(e) => setGutenbergId(e.target.value)}
              className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-white/10 focus:outline-none focus:border-indigo-500/50 transition-all"
            />
            <Button 
              size="sm"
              onClick={handleGutenbergImport}
              disabled={isImporting || !gutenbergId}
              className="bg-indigo-500 hover:bg-indigo-400 text-white border-0"
            >
              {isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Import'}
            </Button>
          </div>
          <p className="mt-4 text-[9px] text-white/10">
            Find IDs at <a href="https://www.gutenberg.org" target="_blank" rel="noreferrer" className="text-indigo-400/50 hover:underline">gutenberg.org</a>
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="bg-black/20 border-white/5 overflow-hidden">
      <div className="p-4 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
            <Headphones className="w-4 h-4 text-indigo-400" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-white tracking-tight">Audiobook Studio</h4>
            <p className="text-[10px] text-white/30">Narrate your library</p>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-6">
        {/* Narrator Selection */}
        <div className="space-y-3">
          <label className="text-[10px] font-black uppercase tracking-[0.2em] text-white/20 px-1">Selected Narrator</label>
          <div className="flex flex-wrap gap-2">
            {voices.slice(0, 4).map((voice) => (
              <button
                key={voice}
                onClick={() => setSelectedVoice(voice)}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-medium transition-all flex items-center gap-2 ${
                  selectedVoice === voice 
                    ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' 
                    : 'bg-white/[0.02] border border-white/5 text-white/40 hover:bg-white/[0.05]'
                }`}
              >
                <User className="w-3 h-3" />
                <span className="capitalize">{voice.split('_')[1]}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Books List */}
        <div className="space-y-4">
          <label className="text-[10px] font-black uppercase tracking-[0.2em] text-white/20 px-1">Your Library</label>
          {ebooks.map((book) => (
            <div key={book.id} className="space-y-3 p-3 bg-white/[0.01] border border-white/5 rounded-xl">
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-3 overflow-hidden">
                  <BookOpen className="w-4 h-4 text-white/20 flex-shrink-0" />
                  <span className="text-xs font-semibold text-white/60 truncate">{book.title}</span>
                </div>
                {!fullBookUrl && !fullBookJobId && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => generateFullBook(book)}
                    className="h-7 px-2 text-[10px] text-indigo-400 hover:bg-indigo-500/10 flex items-center gap-1.5"
                  >
                    <Sparkles className="w-3 h-3" /> Full Book
                  </Button>
                )}
                {fullBookJobId && (
                  <div className="flex items-center gap-2">
                     <span className="text-[9px] font-mono text-indigo-400">{fullBookProgress}%</span>
                     <Loader2 className="w-3 h-3 text-indigo-400 animate-spin" />
                  </div>
                )}
                {fullBookUrl && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => handleDownload(fullBookUrl)}
                    className="h-7 px-2 text-[10px] text-green-400 hover:bg-green-500/10 flex items-center gap-1.5"
                  >
                    <CheckCircle2 className="w-3 h-3" /> Download Full
                  </Button>
                )}
              </div>
              
              <ScrollArea className="h-48 border border-white/5 rounded-lg bg-black/20">
                <div className="p-2 space-y-1">
                  {(book.metadata as { chapters?: Array<{ id: string; title?: string }> })?.chapters?.map(chapter => (
                    <button
                      key={chapter.id}
                      onClick={() => generateAudio(book.id, chapter.id, chapter.title)}
                      disabled={isGenerating}
                      className={`w-full text-left px-3 py-2 rounded-lg text-[11px] transition-all flex items-center justify-between group ${
                        currentChapterId === chapter.id 
                          ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20' 
                          : 'text-white/40 hover:bg-white/[0.03] hover:text-white/70'
                      }`}
                    >
                      <span className="truncate">{chapter.title || 'Untitled Chapter'}</span>
                      {isGenerating && currentChapterId === chapter.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Play className={`w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity ${
                          currentChapterId === chapter.id ? 'opacity-100' : ''
                        }`} />
                      )}
                    </button>
                  )) || (
                    <div className="p-4 text-center text-[10px] text-white/20">
                      Processing chapters...
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          ))}
        </div>

        {/* Audio Player */}
        {audioUrl && (
          <div className="pt-4 border-t border-white/5">
             <div className="flex items-center justify-between mb-3 px-1">
                <span className="text-[10px] text-white/40">Now Playing</span>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-6 px-2 text-[10px] text-indigo-400 hover:bg-indigo-500/10"
                  onClick={() => handleDownload(null)}
                >
                   <Download className="w-3 h-3 mr-1.5" /> Save Chapter
                </Button>
             </div>
             <div className="bg-white/[0.02] border border-white/5 rounded-xl p-3 flex items-center gap-4">
                <Button 
                  size="icon" 
                  className="w-10 h-10 rounded-full bg-indigo-500 hover:bg-indigo-400 shadow-lg"
                  onClick={() => setIsPlaying(!isPlaying)}
                >
                  {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                </Button>
                <div className="flex-1 space-y-1.5">
                   <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-indigo-500 transition-all duration-200" 
                        style={{ width: `${(currentTime / (duration || 1)) * 100}%` }}
                      />
                   </div>
                   <div className="flex justify-between text-[9px] font-mono text-white/20 uppercase tracking-tighter">
                      <span>{formatTime(currentTime)}</span>
                      <span>{formatTime(duration)}</span>
                   </div>
                </div>
             </div>
             <audio 
               ref={audioRef}
               src={audioUrl} 
               onTimeUpdate={handleTimeUpdate}
               onLoadedMetadata={handleLoadedMetadata}
               onEnded={() => setIsPlaying(false)}
               hidden
             />
          </div>
        )}
      </div>
    </Card>
  );
}
