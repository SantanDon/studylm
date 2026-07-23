import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type AudiobookJobStatus = 'processing' | 'completed' | 'failed';

export interface AudiobookJob {
  jobId: string;
  notebookId: string;
  bookId: string;
  bookTitle: string;
  bookFileName: string;
  status: AudiobookJobStatus;
  phase?: string;
  progress: number;
  url?: string;
  error?: string;
  outputFormat: 'mp3' | 'm4b' | 'wav';
  provider: string;
  voice: string;
  style: string;
  chapterCount?: number;
  completedChapters?: number;
  cachedChapters?: number;
  activeChunk?: number;
  activeChunkCount?: number;
  cachedAudioChunks?: number;
  estimatedDurationMinutes?: number;
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

  setSelectedVoice: (voice: string) => void;
  setSelectedStyle: (style: string) => void;
  setOutputFormat: (format: 'mp3' | 'm4b' | 'wav') => void;
  setSelectedProvider: (provider: string) => void;
  setGenerating: (isGenerating: boolean) => void;
  setCurrentChapterId: (id: string | null) => void;
  setCurrentBookId: (id: string | null) => void;
  setAudioUrl: (url: string | null) => void;
  setNotebookId: (id: string | null) => void;
  upsertJob: (job: AudiobookJob) => void;
  updateJob: (bookId: string, updates: Partial<AudiobookJob>) => void;
  clearJob: (bookId: string) => void;
}

export const useAudiobookStore = create<AudiobookState>()(
  persist(
    (set) => ({
      selectedVoice: 'immersive_narrator',
      selectedStyle: 'immersive',
      outputFormat: 'mp3',
      selectedProvider: 'kokoro',
      isGenerating: false,
      currentChapterId: null,
      currentBookId: null,
      audioUrl: null,
      notebookId: null,
      jobs: {},

      setSelectedVoice: (voice) => set({ selectedVoice: voice }),
      setSelectedStyle: (style) => set({ selectedStyle: style }),
      setOutputFormat: (format) => set({ outputFormat: format }),
      setSelectedProvider: (provider) => set({ selectedProvider: provider }),
      setGenerating: (isGenerating) => set({ isGenerating }),
      setCurrentChapterId: (id) => set({ currentChapterId: id }),
      setCurrentBookId: (id) => set({ currentBookId: id }),
      setAudioUrl: (url) => set({ audioUrl: url }),
      setNotebookId: (id) => set({ notebookId: id }),
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
      version: 1,
      partialize: (state) => ({
        selectedVoice: state.selectedVoice,
        selectedStyle: state.selectedStyle,
        outputFormat: state.outputFormat,
        selectedProvider: state.selectedProvider,
        notebookId: state.notebookId,
        jobs: state.jobs,
      }),
    },
  ),
);
