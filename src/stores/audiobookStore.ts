import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type AudiobookJobStatus = 'processing' | 'paused' | 'completed' | 'failed';

export interface PronunciationEntry {
  term: string;
  pronunciation: string;
}

export interface AudiobookJob {
  jobId: string;
  renderId?: string;
  notebookId: string;
  bookId: string;
  bookTitle: string;
  bookFileName: string;
  status: AudiobookJobStatus;
  renderStatus?: string;
  phase?: string;
  progress: number;
  url?: string;
  playbackManifestUrl?: string;
  error?: string;
  outputFormat: 'mp3' | 'm4b' | 'wav';
  provider: string;
  voice: string;
  requestedStyle?: string;
  style: string;
  literaryDirection?: {
    recommendedPreset?: string;
    confidence?: number;
    rationale?: string;
  };
  pronunciationCount?: number;
  chapterCount?: number;
  completedChapters?: number;
  availableChapterCount?: number;
  cachedChapters?: number;
  canPlay?: boolean;
  resumed?: boolean;
  reused?: boolean;
  activeChunk?: number;
  activeChunkCount?: number;
  activeSegmentKind?: string | null;
  cachedAudioChunks?: number;
  estimatedDurationMinutes?: number;
  durationSeconds?: number;
  fileSizeBytes?: number;
  activeChapterTitle?: string | null;
  startedAt?: string;
  completedAt?: string;
}

interface AudiobookState {
  selectedVoice: string;
  selectedStyle: string;
  outputFormat: 'mp3' | 'm4b' | 'wav';
  selectedProvider: string;
  isGenerating: boolean;
  currentChapterId: string | null;
  currentBookId: string | null;
  audioUrl: string | null;
  notebookId: string | null;
  jobs: Record<string, AudiobookJob>;
  pronunciationsByBook: Record<string, PronunciationEntry[]>;

  setSelectedVoice: (voice: string) => void;
  setSelectedStyle: (style: string) => void;
  setOutputFormat: (format: 'mp3' | 'm4b' | 'wav') => void;
  setSelectedProvider: (provider: string) => void;
  setGenerating: (isGenerating: boolean) => void;
  setCurrentChapterId: (id: string | null) => void;
  setCurrentBookId: (id: string | null) => void;
  setAudioUrl: (url: string | null) => void;
  setNotebookId: (id: string | null) => void;
  setPronunciations: (bookId: string, entries: PronunciationEntry[]) => void;
  upsertJob: (job: AudiobookJob) => void;
  updateJob: (bookId: string, updates: Partial<AudiobookJob>) => void;
  clearJob: (bookId: string) => void;
}

export const useAudiobookStore = create<AudiobookState>()(
  persist(
    (set) => ({
      selectedVoice: 'immersive_narrator',
      selectedStyle: 'auto',
      outputFormat: 'mp3',
      selectedProvider: 'kokoro',
      isGenerating: false,
      currentChapterId: null,
      currentBookId: null,
      audioUrl: null,
      notebookId: null,
      jobs: {},
      pronunciationsByBook: {},

      setSelectedVoice: (voice) => set({ selectedVoice: voice }),
      setSelectedStyle: (style) => set({ selectedStyle: style }),
      setOutputFormat: (format) => set({ outputFormat: format }),
      setSelectedProvider: (provider) => set({ selectedProvider: provider }),
      setGenerating: (isGenerating) => set({ isGenerating }),
      setCurrentChapterId: (id) => set({ currentChapterId: id }),
      setCurrentBookId: (id) => set({ currentBookId: id }),
      setAudioUrl: (url) => set({ audioUrl: url }),
      setNotebookId: (id) => set({ notebookId: id }),
      setPronunciations: (bookId, entries) => set((state) => ({
        pronunciationsByBook: { ...state.pronunciationsByBook, [bookId]: entries },
      })),
      upsertJob: (job) => set((state) => ({ jobs: { ...state.jobs, [job.bookId]: job } })),
      updateJob: (bookId, updates) => set((state) => {
        const existing = state.jobs[bookId];
        if (!existing) return state;
        return { jobs: { ...state.jobs, [bookId]: { ...existing, ...updates } } };
      }),
      clearJob: (bookId) => set((state) => {
        const jobs = { ...state.jobs };
        delete jobs[bookId];
        return { jobs };
      }),
    }),
    {
      name: 'studypod:audiobook-workspace',
      version: 3,
      migrate: (persisted, version) => {
        const state = (persisted || {}) as Partial<AudiobookState>;
        return {
          ...state,
          selectedStyle: version < 2 && state.selectedStyle === 'immersive' ? 'auto' : state.selectedStyle || 'auto',
          pronunciationsByBook: state.pronunciationsByBook || {},
        } as AudiobookState;
      },
      partialize: (state) => ({
        selectedVoice: state.selectedVoice,
        selectedStyle: state.selectedStyle,
        outputFormat: state.outputFormat,
        selectedProvider: state.selectedProvider,
        notebookId: state.notebookId,
        jobs: state.jobs,
        pronunciationsByBook: state.pronunciationsByBook,
      }),
    },
  ),
);
