import { create } from 'zustand';

interface AudiobookState {
  selectedVoice: string;
  isGenerating: boolean;
  currentChapterId: string | null;
  audioUrl: string | null;
  notebookId: string | null;
  
  // Actions
  setSelectedVoice: (voice: string) => void;
  setGenerating: (isGenerating: boolean) => void;
  setCurrentChapterId: (id: string | null) => void;
  setAudioUrl: (url: string | null) => void;
  setNotebookId: (id: string | null) => void;
}

export const useAudiobookStore = create<AudiobookState>((set) => ({
  selectedVoice: 'soothing_mix',
  isGenerating: false,
  currentChapterId: null,
  audioUrl: null,
  notebookId: null,

  setSelectedVoice: (voice) => set({ selectedVoice: voice }),
  setGenerating: (isGenerating) => set({ isGenerating }),
  setCurrentChapterId: (id) => set({ currentChapterId: id }),
  setAudioUrl: (url) => set({ audioUrl: url }),
  setNotebookId: (id) => set({ notebookId: id }),
}));
