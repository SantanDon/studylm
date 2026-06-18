/**
 * Ultimate TTS Studio Provider
 * Integrates with Ultimate TTS Studio running via Pinokio
 * Default endpoint: http://localhost:7860
 * 
 * Ultimate TTS Studio supports multiple TTS engines:
 * - XTTS v2 (high quality, voice cloning)
 * - Bark (expressive, emotional)
 * - Tortoise TTS (very high quality, slow)
 * - VITS (fast, good quality)
 */

import { TTSProvider, TTSVoice, TTSRequest, TTSResponse, getTTSConfig } from './ttsService';

interface UltimateTTSVoice {
  name: string;
  language: string;
  model: string;
  sample_rate?: number;
}

interface UltimateTTSAPIResponse {
  audio?: string; // base64 encoded audio
  audio_url?: string;
  error?: string;
  status?: string;
}

export class UltimateTTSProvider implements TTSProvider {
  name = 'Ultimate TTS Studio';
  private endpoint: string;
  private cachedVoices: TTSVoice[] | null = null;

  constructor(endpoint?: string) {
    const config = getTTSConfig();
    this.endpoint = endpoint || config.endpoint || 'http://localhost:7860';
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Try multiple common endpoints for Ultimate TTS Studio
      const endpoints = [
        `${this.endpoint}/api/health`,
        `${this.endpoint}/health`,
        `${this.endpoint}/api/v1/health`,
        `${this.endpoint}/`,
      ];

      for (const url of endpoints) {
        try {
          const response = await fetch(url, { 
            method: 'GET',
            signal: AbortSignal.timeout(3000),
          });
          if (response.ok) {
            return true;
          }
        } catch {
          // Try next endpoint
        }
      }
      

      return false;
    } catch {

      return false;
    }
  }

  async getVoices(): Promise<TTSVoice[]> {
    if (this.cachedVoices) return this.cachedVoices;

    try {
      // Try to get voices from the API
      const voiceEndpoints = [
        `${this.endpoint}/api/voices`,
        `${this.endpoint}/api/v1/voices`,
        `${this.endpoint}/voices`,
      ];

      for (const url of voiceEndpoints) {
        try {
          const response = await fetch(url, {
            signal: AbortSignal.timeout(5000),
          });
          
          if (response.ok) {
            const data = await response.json();
            const voices = this.parseVoicesResponse(data);
            if (voices.length > 0) {
              this.cachedVoices = voices;
              return voices;
            }
          }
        } catch {
          // Try next endpoint
        }
      }
    } catch (error) {
      console.warn('Failed to fetch Ultimate TTS voices:', error);
    }

    // Return default voices if API doesn't provide them
    return this.getDefaultVoices();
  }

  private parseVoicesResponse(data: unknown): TTSVoice[] {
    const voices: TTSVoice[] = [];
    
    if (Array.isArray(data)) {
      for (const voice of data) {
        if (typeof voice === 'object' && voice !== null) {
          const v = voice as UltimateTTSVoice;
          voices.push({
            id: v.name || String(voice),
            name: v.name || String(voice),
            language: v.language || 'en',
            provider: 'ultimate-tts',
          });
        } else if (typeof voice === 'string') {
          voices.push({
            id: voice,
            name: voice,
            language: 'en',
            provider: 'ultimate-tts',
          });
        }
      }
    } else if (typeof data === 'object' && data !== null) {
      // Handle object format { voices: [...] }
      const obj = data as { voices?: unknown[] };
      if (obj.voices && Array.isArray(obj.voices)) {
        return this.parseVoicesResponse(obj.voices);
      }
    }

    return voices;
  }

  private getDefaultVoices(): TTSVoice[] {
    // Common voices available in Ultimate TTS Studio
    return [
      { id: 'default', name: 'Default Voice', language: 'en', provider: 'ultimate-tts' },
      { id: 'male_1', name: 'Male Voice 1', language: 'en', provider: 'ultimate-tts', gender: 'male' },
      { id: 'female_1', name: 'Female Voice 1', language: 'en', provider: 'ultimate-tts', gender: 'female' },
      { id: 'male_2', name: 'Male Voice 2', language: 'en', provider: 'ultimate-tts', gender: 'male' },
      { id: 'female_2', name: 'Female Voice 2', language: 'en', provider: 'ultimate-tts', gender: 'female' },
    ];
  }

  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    const { text, voice, speed = 1.0 } = request;

    // Try multiple API formats that Ultimate TTS Studio might support
    const apiFormats = [
      // Gradio API format (most common for Pinokio apps)
      {
        url: `${this.endpoint}/api/predict`,
        body: {
          data: [text, voice || 'default', speed],
        },
      },
      // REST API format
      {
        url: `${this.endpoint}/api/tts`,
        body: {
          text,
          voice: voice || 'default',
          speed,
        },
      },
      // Alternative REST format
      {
        url: `${this.endpoint}/api/v1/tts`,
        body: {
          text,
          speaker: voice || 'default',
          speed,
        },
      },
      // Simple generate endpoint
      {
        url: `${this.endpoint}/generate`,
        body: {
          text,
          voice: voice || 'default',
        },
      },
    ];

    let lastError: Error | null = null;

    for (const format of apiFormats) {
      try {
        const response = await fetch(format.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(format.body),
          signal: AbortSignal.timeout(60000), // 60s timeout for TTS generation
        });

        if (!response.ok) {
          continue;
        }

        const contentType = response.headers.get('content-type');

        // Handle direct audio response
        if (contentType?.includes('audio/')) {
          const audioBlob = await response.blob();
          const audioUrl = URL.createObjectURL(audioBlob);
          return { audioBlob, audioUrl };
        }

        // Handle JSON response with base64 audio
        const data = await response.json() as UltimateTTSAPIResponse;
        
        if (data.error) {
          throw new Error(data.error);
        }

        // Handle Gradio response format
        if (Array.isArray(data)) {
          const audioData = data[0];
          if (typeof audioData === 'string') {
            return this.processAudioData(audioData);
          }
        }

        // Handle base64 audio in response
        if (data.audio) {
          return this.processAudioData(data.audio);
        }

        // Handle audio URL in response
        if (data.audio_url) {
          const audioResponse = await fetch(data.audio_url);
          const audioBlob = await audioResponse.blob();
          const audioUrl = URL.createObjectURL(audioBlob);
          return { audioBlob, audioUrl };
        }

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.warn(`TTS API format failed (${format.url}):`, error);
      }
    }

    throw lastError || new Error('Failed to synthesize speech with Ultimate TTS Studio');
  }

  private processAudioData(audioData: string): TTSResponse {
    // Remove data URL prefix if present
    let base64Data = audioData;
    if (audioData.includes(',')) {
      base64Data = audioData.split(',')[1];
    }

    // Decode base64 to blob
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Detect audio format from header
    const audioType = this.detectAudioType(bytes);
    const audioBlob = new Blob([bytes], { type: audioType });
    const audioUrl = URL.createObjectURL(audioBlob);

    return { audioBlob, audioUrl };
  }

  private detectAudioType(bytes: Uint8Array): string {
    // Check for WAV header
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
      return 'audio/wav';
    }
    // Check for MP3 header
    if (bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0) {
      return 'audio/mpeg';
    }
    // Check for OGG header
    if (bytes[0] === 0x4F && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) {
      return 'audio/ogg';
    }
    // Default to WAV
    return 'audio/wav';
  }
}
