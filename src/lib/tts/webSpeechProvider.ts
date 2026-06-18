/**
 * Web Speech API Provider
 * Fallback TTS provider using browser's built-in speech synthesis
 */

import { TTSProvider, TTSVoice, TTSRequest, TTSResponse } from './ttsService';

export class WebSpeechProvider implements TTSProvider {
  name = 'Web Speech API';
  private synth: SpeechSynthesis | null = null;
  private voices: SpeechSynthesisVoice[] = [];

  constructor() {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      this.synth = window.speechSynthesis;
      this.loadVoices();
    }
  }

  private loadVoices(): void {
    if (!this.synth) return;

    const loadVoiceList = () => {
      this.voices = this.synth!.getVoices();
    };

    loadVoiceList();
    
    if (this.synth.onvoiceschanged !== undefined) {
      this.synth.onvoiceschanged = loadVoiceList;
    }
  }

  async isAvailable(): Promise<boolean> {
    return this.synth !== null;
  }

  async getVoices(): Promise<TTSVoice[]> {
    // Wait a bit for voices to load
    if (this.voices.length === 0 && this.synth) {
      await new Promise(resolve => setTimeout(resolve, 100));
      this.voices = this.synth.getVoices();
    }

    return this.voices.map(voice => ({
      id: voice.name,
      name: `${voice.name} (${voice.lang})`,
      language: voice.lang,
      provider: 'web-speech' as const,
      gender: this.detectGender(voice.name),
    }));
  }

  private detectGender(name: string): 'male' | 'female' | 'neutral' {
    const lowerName = name.toLowerCase();
    if (lowerName.includes('female') || lowerName.includes('zira') || 
        lowerName.includes('samantha') || lowerName.includes('victoria')) {
      return 'female';
    }
    if (lowerName.includes('male') || lowerName.includes('david') || 
        lowerName.includes('daniel') || lowerName.includes('james')) {
      return 'male';
    }
    return 'neutral';
  }

  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    if (!this.synth) {
      throw new Error('Web Speech API not available');
    }

    const { text, voice, speed = 1.0, pitch = 1.0 } = request;

    return new Promise((resolve, reject) => {
      // Create audio context for recording
      // Unfortunately, Web Speech API doesn't provide audio output directly
      // We'll use a workaround: speak and return a placeholder
      // For real audio capture, we'd need a different approach

      const utterance = new SpeechSynthesisUtterance(text);
      
      if (voice) {
        const selectedVoice = this.voices.find(v => v.name === voice);
        if (selectedVoice) {
          utterance.voice = selectedVoice;
        }
      }

      utterance.rate = speed;
      utterance.pitch = pitch;

      // Create a simple audio representation
      // Note: Web Speech API doesn't give us the actual audio data
      // This is a limitation - we can only play it directly
      
      utterance.onend = () => {
        // Create a silent audio blob as placeholder
        // The actual playback happens through speechSynthesis.speak()
        const silentBlob = this.createSilentAudio(0.1);
        const audioUrl = URL.createObjectURL(silentBlob);
        
        resolve({
          audioBlob: silentBlob,
          audioUrl,
          duration: text.length * 0.05, // Rough estimate
        });
      };

      utterance.onerror = (event) => {
        reject(new Error(`Speech synthesis error: ${event.error}`));
      };

      this.synth!.speak(utterance);
    });
  }

  // Speak directly without returning audio (for real-time playback)
  speakDirect(text: string, voice?: string, speed = 1.0, pitch = 1.0): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.synth) {
        reject(new Error('Web Speech API not available'));
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      
      if (voice) {
        const selectedVoice = this.voices.find(v => v.name === voice);
        if (selectedVoice) {
          utterance.voice = selectedVoice;
        }
      }

      utterance.rate = speed;
      utterance.pitch = pitch;

      utterance.onend = () => resolve();
      utterance.onerror = (event) => reject(new Error(`Speech error: ${event.error}`));

      this.synth.speak(utterance);
    });
  }

  pause(): void {
    this.synth?.pause();
  }

  resume(): void {
    this.synth?.resume();
  }

  stop(): void {
    this.synth?.cancel();
  }

  private createSilentAudio(duration: number): Blob {
    // Create a minimal WAV file header for silent audio
    const sampleRate = 44100;
    const numSamples = Math.floor(sampleRate * duration);
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);

    // WAV header
    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + numSamples * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, numSamples * 2, true);

    // Silent samples (all zeros)
    for (let i = 0; i < numSamples; i++) {
      view.setInt16(44 + i * 2, 0, true);
    }

    return new Blob([buffer], { type: 'audio/wav' });
  }
}
