/**
 * Kokoro TTS Provider
 * High-quality text-to-speech that runs entirely in the browser
 * Uses ONNX runtime for fast inference
 * 
 * This is the DEFAULT provider - no setup required!
 */

import { TTSProvider, TTSVoice, TTSRequest, TTSResponse } from './ttsService';

// Kokoro voice IDs - these are the available voices
export const KOKORO_VOICES = {
  // American English voices
  'af_heart': { name: 'Heart (American Female)', gender: 'female', lang: 'en-US' },
  'af_alloy': { name: 'Alloy (American Female)', gender: 'female', lang: 'en-US' },
  'af_aoede': { name: 'Aoede (American Female)', gender: 'female', lang: 'en-US' },
  'af_bella': { name: 'Bella (American Female)', gender: 'female', lang: 'en-US' },
  'af_jessica': { name: 'Jessica (American Female)', gender: 'female', lang: 'en-US' },
  'af_kore': { name: 'Kore (American Female)', gender: 'female', lang: 'en-US' },
  'af_nicole': { name: 'Nicole (American Female)', gender: 'female', lang: 'en-US' },
  'af_nova': { name: 'Nova (American Female)', gender: 'female', lang: 'en-US' },
  'af_river': { name: 'River (American Female)', gender: 'female', lang: 'en-US' },
  'af_sarah': { name: 'Sarah (American Female)', gender: 'female', lang: 'en-US' },
  'af_sky': { name: 'Sky (American Female)', gender: 'female', lang: 'en-US' },
  'am_adam': { name: 'Adam (American Male)', gender: 'male', lang: 'en-US' },
  'am_echo': { name: 'Echo (American Male)', gender: 'male', lang: 'en-US' },
  'am_eric': { name: 'Eric (American Male)', gender: 'male', lang: 'en-US' },
  'am_fenrir': { name: 'Fenrir (American Male)', gender: 'male', lang: 'en-US' },
  'am_liam': { name: 'Liam (American Male)', gender: 'male', lang: 'en-US' },
  'am_michael': { name: 'Michael (American Male)', gender: 'male', lang: 'en-US' },
  'am_onyx': { name: 'Onyx (American Male)', gender: 'male', lang: 'en-US' },
  // British English voices
  'bf_alice': { name: 'Alice (British Female)', gender: 'female', lang: 'en-GB' },
  'bf_emma': { name: 'Emma (British Female)', gender: 'female', lang: 'en-GB' },
  'bf_lily': { name: 'Lily (British Female)', gender: 'female', lang: 'en-GB' },
  'bm_daniel': { name: 'Daniel (British Male)', gender: 'male', lang: 'en-GB' },
  'bm_fable': { name: 'Fable (British Male)', gender: 'male', lang: 'en-GB' },
  'bm_george': { name: 'George (British Male)', gender: 'male', lang: 'en-GB' },
  'bm_lewis': { name: 'Lewis (British Male)', gender: 'male', lang: 'en-GB' },
} as const;

export type KokoroVoiceId = keyof typeof KOKORO_VOICES;

// Default voices for podcast hosts — tuned for natural conversational delivery
export const DEFAULT_HOST1_VOICE: KokoroVoiceId = 'am_onyx'; // Warmer, more natural male voice
export const DEFAULT_HOST2_VOICE: KokoroVoiceId = 'af_nova'; // Clearer, more natural female voice

/**
 * HOST_VOICE_MAP — only used as a LAST RESORT fallback.
 * The streaming pipeline (streamingTTSGenerator) reads from the user's
 * PodcastAudioConfig first via speakerVoiceMap.  This map exists solely
 * for the legacy batch path (podcastAudioGenerator).
 */
export const HOST_VOICE_MAP: Record<string, KokoroVoiceId> = {};

interface KokoroTtsInstance {
  generate(text: string, options: { voice: KokoroVoiceId; speed: number }): Promise<{
    toBlob(): Blob; // Return Blob directly
    duration?: number;
  }>;
  list_voices?(): void | unknown[];
}

let kokoroInstance: KokoroTtsInstance | null = null;
let isLoading = false;
let loadPromise: Promise<KokoroTtsInstance> | null = null;

async function loadKokoro(): Promise<KokoroTtsInstance> {
  if (kokoroInstance) return kokoroInstance;
  if (loadPromise) return loadPromise;

  isLoading = true;
  loadPromise = (async () => {
    try {
      console.log('🎙️ Loading Kokoro TTS (first time may take a moment)...');
      const { KokoroTTS } = await import('kokoro-js');
      
      // Initialize with fp32 for better quality (q8 can cause gibberish)
      kokoroInstance = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
        dtype: 'fp32', // Full precision for better quality
        device: 'wasm', // WASM backend for compatibility
      });
      
      // Log available voices
      try {
        const voices = kokoroInstance.list_voices?.() || [];
        console.log('Available Kokoro voices:', voices);
      } catch {
        // Ignore if list_voices not available
      }
      
      console.log('✅ Kokoro TTS loaded successfully!');
      return kokoroInstance;
    } catch (error) {
      console.error('Failed to load Kokoro TTS:', error);
      throw error;
    } finally {
      isLoading = false;
    }
  })();

  return loadPromise;
}

export class KokoroTTSProvider implements TTSProvider {
  name = 'Kokoro TTS (Browser)';
  private initialized = false;

  async isAvailable(): Promise<boolean> {
    // Kokoro runs in browser, always available
    // But we should check if WebAssembly is supported
    if (typeof WebAssembly === 'undefined') {
      console.warn('WebAssembly not supported - Kokoro TTS unavailable');
      return false;
    }
    return true;
  }

  async getVoices(): Promise<TTSVoice[]> {
    return Object.entries(KOKORO_VOICES).map(([id, info]) => ({
      id,
      name: info.name,
      language: info.lang,
      provider: 'ultimate-tts' as const, // Using this for compatibility
      gender: info.gender as 'male' | 'female',
    }));
  }

  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    const { text, voice = DEFAULT_HOST1_VOICE, speed = 1.0 } = request;

    try {
      // Load Kokoro if not already loaded
      const kokoro = await loadKokoro();
      
      // Generate audio
      console.log(`🔊 Generating speech for: "${text.substring(0, 50)}..."`);
      
      const audio = await kokoro.generate(text, {
        voice: voice as KokoroVoiceId,
        speed,
      });

      // Convert to WAV blob
      const audioBlob = await audio.toBlob();
      const audioUrl = URL.createObjectURL(audioBlob);

      return {
        audioBlob,
        audioUrl,
        duration: audio.duration,
      };
    } catch (error) {
      console.error('Kokoro TTS synthesis failed:', error);
      throw new Error(`TTS synthesis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Preload the model (call this early to reduce first-generation delay)
  async preload(): Promise<void> {
    if (!this.initialized) {
      await loadKokoro();
      this.initialized = true;
    }
  }

  isLoading(): boolean {
    return isLoading;
  }
}

// Export singleton instance
let providerInstance: KokoroTTSProvider | null = null;

export function getKokoroTTSProvider(): KokoroTTSProvider {
  if (!providerInstance) {
    providerInstance = new KokoroTTSProvider();
  }
  return providerInstance;
}
