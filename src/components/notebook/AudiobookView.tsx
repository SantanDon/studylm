import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Book, Play, Pause, User,
  Headphones, Download, Loader2, BookOpen,
  Sparkles, CheckCircle2, Globe, Upload, ShieldCheck
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card } from '@/components/ui/card';
import { useSources } from '@/hooks/useSources';
import { useNotebooks } from '@/hooks/useNotebooks';
import { useNotebookUpdate } from '@/hooks/useNotebookUpdate';
import { useAuth } from '@/hooks/useAuth';
import { useGuest } from '@/hooks/useGuest';
import { useAudiobookStore } from '@/stores/audiobookStore';
import { toast } from 'sonner';
import type { Source } from '@/types/domain/Source';
import { API_BASE_URL } from '@/config/api';


interface AudiobookViewProps {
  notebookId: string;
}

type AudiobookSource = Source & {
  type: string;
  metadata?: unknown;
};

export default function AudiobookView({ notebookId }: AudiobookViewProps) {
  const { sources, addSourceAsync } = useSources(notebookId);
  const { notebooks } = useNotebooks();
  const { updateNotebook } = useNotebookUpdate();
  const { session } = useAuth();
  const { guestId } = useGuest();
  
  const currentNotebook = notebooks.find((n: { id: string }) => n.id === notebookId);
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
  const [isUploadingBook, setIsUploadingBook] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const bookUploadRef = useRef<HTMLInputElement>(null);

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
  }).filter(s => String(s.type) === 'ebook') as AudiobookSource[] || [];

  const authToken = session?.access_token || guestId || 'guest_audiobook_local';
  const authHeaders = useCallback(() => ({ Authorization: `Bearer ${authToken}` }), [authToken]);
  const jsonHeaders = () => ({ 'Content-Type': 'application/json', ...authHeaders() });
  const selectedProvider = selectedVoice === 'mock_narrator' ? 'mock' : 'kokoro';

  const fetchVoices = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/audiobook/voices`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      setVoices(data.voices);
    } catch (err) {
      console.error('Failed to load voices', err);
    }
  }, [authHeaders]);

  useEffect(() => {
    fetchVoices();
  }, [fetchVoices]);

  useEffect(() => {
    return () => {
      if (audioUrl?.startsWith('blob:')) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

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
          const res = await fetch(`${API_BASE_URL}/audiobook/job-status/${fullBookJobId}`, {
            headers: authHeaders(),
          });
          const data = await res.json();
          if (data.status === 'completed') {
            setFullBookUrl(data.url);
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
  }, [authHeaders, fullBookJobId]);

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

  const generateAudio = async (sourceId: string, chapterId: string, title?: string) => {
    setGenerating(true);
    setCurrentChapterId(chapterId);
    setIsPlaying(false);
    try {
      const source = sources?.find(s => s.id === sourceId);
      const meta = source?.metadata as Record<string, unknown> | undefined;
      const fileName = (meta?.fileName as string) || source?.title || 'unknown.epub';
      const url = `${API_BASE_URL}/audiobook/generate/${chapterId}?voice=${selectedVoice}&provider=${selectedProvider}&file=${encodeURIComponent(fileName)}`;
      const res = await fetch(url, { headers: authHeaders() });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      setAudioUrl(URL.createObjectURL(blob));
      setIsPlaying(true);
      toast.success(`Narration started for ${title || 'chapter'}`);
    } catch (err) {
      console.error(err);
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
      
      const res = await fetch(`${API_BASE_URL}/audiobook/generate-full`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ fileName, voice: selectedVoice, provider: selectedProvider, chapterIds })
      });
      if (!res.ok) throw new Error(await res.text());
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
      const res = await fetch(`${API_BASE_URL}/audiobook/import-gutenberg`, {
        method: 'POST',
        headers: jsonHeaders(),
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

  const handleBookUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploadingBook(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`${API_BASE_URL}/audiobook/extract`, {
        method: 'POST',
        headers: authHeaders(),
        body: formData,
      });

      if (!res.ok) throw new Error(await res.text());
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
          format: data.format,
          stats: data.stats,
          source: 'upload',
        }
      });

      toast.success(`Imported "${data.title}" with ${data.chapters?.length || 0} chapters`);

      if (currentNotebook && (
          currentNotebook.title === 'Untitled notebook' ||
          currentNotebook.title === 'Untitled Notebook' ||
          !currentNotebook.title
      )) {
        updateNotebook({ id: notebookId, updates: { title: data.title } });
      }
    } catch (err) {
      console.error(err);
      toast.error('Book upload failed');
    } finally {
      setIsUploadingBook(false);
      if (event.target) event.target.value = '';
    }
  };

  const handleDownload = async (url: string | null) => {
    const downloadUrl = url || audioUrl;
    if (!downloadUrl) return;

    let href = downloadUrl;
    if (!downloadUrl.startsWith('blob:')) {
      const res = await fetch(downloadUrl, { headers: authHeaders() });
      if (!res.ok) {
        toast.error('Download failed');
        return;
      }
      href = URL.createObjectURL(await res.blob());
    }

    const link = document.createElement('a');
    link.href = href;
    link.download = url ? 'full-audiobook.wav' : `chapter-${currentChapterId}.wav`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    if (href.startsWith('blob:') && href !== audioUrl) URL.revokeObjectURL(href);
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
          <p className="text-[10px] text-white/20 leading-relaxed max-w-[260px] mx-auto mb-6">
            Upload your own EPUB, PDF, TXT, MD or DOCX, or import a public-domain Project Gutenberg book.
          </p>

          <input
            ref={bookUploadRef}
            type="file"
            accept=".epub,.pdf,.txt,.md,.markdown,.docx"
            onChange={handleBookUpload}
            className="hidden"
          />

          <Button
            size="sm"
            onClick={() => bookUploadRef.current?.click()}
            disabled={isUploadingBook}
            className="mb-4 bg-white text-black hover:bg-white/90 border-0"
          >
            {isUploadingBook ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Upload className="w-4 h-4 mr-2" />}
            Upload Book
          </Button>

          <div className="flex items-center gap-2 max-w-[260px] mx-auto mb-4 text-[9px] text-white/20 text-left">
            <ShieldCheck className="w-3 h-3 text-green-400/60 flex-shrink-0" />
            <span>Use books you own, created, licensed, or public-domain sources.</span>
          </div>
          
          <div className="flex gap-2 max-w-[260px] mx-auto">
            <input 
              type="text" 
              placeholder="Gutenberg ID (e.g. 1342)"
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
            Find public-domain IDs at <a href="https://www.gutenberg.org" target="_blank" rel="noreferrer" className="text-indigo-400/50 hover:underline">gutenberg.org</a>
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
        <input
          ref={bookUploadRef}
          type="file"
          accept=".epub,.pdf,.txt,.md,.markdown,.docx"
          onChange={handleBookUpload}
          className="hidden"
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => bookUploadRef.current?.click()}
          disabled={isUploadingBook}
          className="h-8 px-2 text-[10px] text-white/50 hover:text-white hover:bg-white/[0.05]"
        >
          {isUploadingBook ? <Loader2 className="w-3 h-3 animate-spin mr-1.5" /> : <Upload className="w-3 h-3 mr-1.5" />}
          Add Book
        </Button>
      </div>

      <div className="p-4 space-y-6">
        {/* Narrator Selection */}
        <div className="space-y-3">
          <label className="text-[10px] font-black uppercase tracking-[0.2em] text-white/20 px-1">Selected Narrator</label>
          <div className="flex flex-wrap gap-2">
            {voices.map((voice) => (
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
