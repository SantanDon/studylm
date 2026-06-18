/**
 * Kokoro Premium TTS Provider
 * Enhanced version of Kokoro optimized for Deep Think podcast generation
 * Uses higher-quality voices and improved settings for professional audio
 */

import { TTSProvider, TTSVoice, TTSRequest, TTSResponse } from './ttsService';
import { KokoroVoiceId } from './kokoroTTSProvider';

// Premium voices with enhanced quality - more options than base
export interface PremiumVoiceInfo {
  id: string;
  name: string;
  gender: 'male' | 'female';
  category: string;
  description: string;
}

export const KOKORO_PREMIUM_VOICES: PremiumVoiceInfo[] = [
  // Enhanced Male Voices
  { id: 'am_michael', name: 'Michael (Enhanced)', gender: 'male', category: 'American', description: 'Authoritative, warm male voice' },
  { id: 'am_adam', name: 'Adam (Enhanced)', gender: 'male', category: 'American', description: 'Deep, resonant male voice' },
  { id: 'am_onyx', name: 'Onyx (Enhanced)', gender: 'male', category: 'American', description: 'Deep, smooth male voice' },
  { id: 'bm_daniel', name: 'Daniel (Enhanced)', gender: 'male', category: 'British', description: 'Sophisticated British male' },
  { id: 'bm_george', name: 'George (Enhanced)', gender: 'male', category: 'British', description: 'Professional British male' },
  
  // Enhanced Female Voices  
  { id: 'af_bella', name: 'Bella (Enhanced)', gender: 'female', category: 'American', description: 'Warm, engaging female voice' },
  { id: 'af_nova', name: 'Nova (Enhanced)', gender: 'female', category: 'American', description: 'Clear, energetic female' },
  { id: 'af_sarah', name: 'Sarah (Enhanced)', gender: 'female', category: 'American', description: 'Friendly, conversational' },
  { id: 'af_sky', name: 'Sky (Enhanced)', gender: 'female', category: 'American', description: 'Light, airy female voice' },
  { id: 'bf_emma', name: 'Emma (Enhanced)', gender: 'female', category: 'British', description: 'Elegant British female' },
  { id: 'bf_lily', name: 'Lily (Enhanced)', gender: 'female', category: 'British', description: 'Sweet, clear British female' },
];

export class KokoroPremiumTTSProvider implements TTSProvider {
  public name = 'kokoro-premium';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private kokoroInstance: any = null;
  private isInitialized = false;

  // Premium voices optimized for Deep Think mode
  private readonly PREMIUM_HOST_VOICES = {
    host1: 'am_michael' as KokoroVoiceId, // Alex - authoritative, clear male voice
    host2: 'af_bella' as KokoroVoiceId,   // Sarah - warm, engaging female voice
  };

  async isAvailable(): Promise<boolean> {
    try {
      // Check if WebAssembly and required APIs are available
      if (typeof WebAssembly !== 'object') return false;
      if (typeof SharedArrayBuffer === 'undefined') return false;

      // Try to initialize Kokoro
      await this.initialize();
      return this.isInitialized;
    } catch (error) {
      console.warn('Kokoro Premium TTS not available:', error);
      return false;
    }
  }

  private async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Dynamic import to avoid loading unless needed
      const { KokoroTTS } = await import('kokoro-js');

      console.log('🎭 Initializing Kokoro Premium TTS...');

      // Use larger model for better quality (Kokoro-82M instead of smaller variants)
      // Detect if we are in Node.js environment for tests
      const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;

      this.kokoroInstance = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
        device: isNode ? 'cpu' : 'wasm',
        dtype: 'fp32', // Full precision for best quality
      });

      this.isInitialized = true;
      console.log('✅ Kokoro Premium TTS initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize Kokoro Premium TTS:', error);
      throw error;
    }
  }

  async getVoices(): Promise<TTSVoice[]> {
    // Return all premium voices - more options than base
    const premiumVoices: TTSVoice[] = KOKORO_PREMIUM_VOICES.map(voice => ({
      id: voice.id,
      name: `${voice.name}`,
      language: 'en',
      provider: 'kokoro-premium' as const,
      gender: voice.gender,
    }));

    return premiumVoices;
  }

  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!this.kokoroInstance) {
      throw new Error('Kokoro Premium TTS not initialized');
    }

    try {
      console.log(`🎭 Generating premium speech: "${request.text.substring(0, 50)}..."`);

      // Use premium settings for Deep Think mode
      const voice = request.voice as KokoroVoiceId || this.PREMIUM_HOST_VOICES.host1;

      // Enhanced settings for premium quality
      const result = await this.kokoroInstance.generate(request.text, {
        voice: voice,
        speed: request.speed || 0.9, // Slightly slower for more natural delivery
      });

      // Convert to blob and create URL
      const audioBlob = await result.toBlob();
      const audioUrl = URL.createObjectURL(audioBlob);

      // Ensure we have a valid duration
      let duration = result.duration;
      if (duration === undefined || duration === null || isNaN(duration) || duration === 0) {
        console.warn(`Kokoro TTS (Premium): Received invalid duration (${duration}s). Estimating...`);
        duration = request.text.length * 0.08 / (request.speed || 0.9);
      }

      return {
        audioBlob,
        audioUrl,
        duration: duration,
      };
    } catch (error) {
      console.error('❌ Kokoro Premium TTS generation failed:', error);
      throw error;
    }
  }

  // Premium voice mapping for podcast hosts
  getHostVoice(hostName: 'Alex' | 'Sarah'): KokoroVoiceId {
    return hostName === 'Alex' ? this.PREMIUM_HOST_VOICES.host1 : this.PREMIUM_HOST_VOICES.host2;
  }
}

// Singleton instance
let kokoroPremiumInstance: KokoroPremiumTTSProvider | null = null;

export function getKokoroPremiumProvider(): KokoroPremiumTTSProvider {
  if (!kokoroPremiumInstance) {
    kokoroPremiumInstance = new KokoroPremiumTTSProvider();
  }
  return kokoroPremiumInstance;
}