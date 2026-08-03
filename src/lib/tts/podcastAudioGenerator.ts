/**
 * Podcast Audio Generator
 * Generates full podcast audio from script segments using TTS providers
 *
 * UPDATED: Now uses TTSWorkerManager for Kokoro TTS to prevent UI freezing
 */

import { PodcastScript } from "../podcastGenerator";
import { TTSProvider, getTTSConfig, saveTTSConfig } from "./ttsService";
import { UltimateTTSProvider } from "./ultimateTTSProvider";
import { WebSpeechProvider } from "./webSpeechProvider";
import { TTSWorkerManager, getTTSWorkerManager } from "./ttsWorker";
import { combineWavBlobs } from "./wavUtils";

export interface PodcastAudioConfig {
  host1Voice: string;
  host2Voice: string;
  speed: number;
  pauseBetweenSegments: number; // milliseconds
  enableStudioEQ?: boolean;
}

export interface PodcastAudioResult {
  audioBlob: Blob;
  audioUrl: string;
  duration: number;
  provider: string;
  segments: SegmentAudio[];
}

export interface SegmentAudio {
  index: number;
  speaker: string;
  audioUrl: string;
  duration: number;
}

export interface GenerationProgress {
  currentSegment: number;
  totalSegments: number;
  status: string;
  percentage: number;
}

const DEFAULT_AUDIO_CONFIG: PodcastAudioConfig = {
  host1Voice: "am_onyx",
  host2Voice: "af_nova",
  speed: 0.95,
  pauseBetweenSegments: 600,
  enableStudioEQ: true,
};

const AUDIO_CONFIG_KEY = "podcast_audio_config";

export function getPodcastAudioConfig(): PodcastAudioConfig {
  try {
    const stored = localStorage.getItem(AUDIO_CONFIG_KEY);
    if (stored) {
      return { ...DEFAULT_AUDIO_CONFIG, ...JSON.parse(stored) };
    }
  } catch (e) {
    console.warn("Failed to load podcast audio config:", e);
  }
  return DEFAULT_AUDIO_CONFIG;
}

export function savePodcastAudioConfig(
  config: Partial<PodcastAudioConfig>,
): void {
  const current = getPodcastAudioConfig();
  const updated = { ...current, ...config };
  localStorage.setItem(AUDIO_CONFIG_KEY, JSON.stringify(updated));
}

export class PodcastAudioGenerator {
  private provider: TTSProvider | null = null;
  private workerManager: TTSWorkerManager;
  private webSpeechFallback: WebSpeechProvider;
  private isUsingFallback = false;
  private isUsingWorker = false;

  constructor() {
    this.workerManager = getTTSWorkerManager();
    this.webSpeechFallback = new WebSpeechProvider();
  }

  async initialize(): Promise<{ provider: string; available: boolean }> {
    const config = getTTSConfig();

    // Try Ultimate TTS Studio ONLY if explicitly configured (avoid unnecessary health checks)
    if (config.provider === "ultimate-tts") {
      try {
        const ultimateTTS = new UltimateTTSProvider(config.endpoint);
        const isAvailable = await ultimateTTS.isAvailable();

        if (isAvailable) {
          this.provider = ultimateTTS;
          this.isUsingFallback = false;
          this.isUsingWorker = false;
          console.log("🎙️ Using Ultimate TTS Studio for podcast generation");
          return { provider: "Ultimate TTS Studio", available: true };
        }
      } catch (e) {
        console.warn("Ultimate TTS Studio not available:", e);
      }
    }

    // Try Kokoro TTS (via Worker)
    // This is the default preferred method for high quality
    if (config.provider === "kokoro") {
      const workerSupported = TTSWorkerManager.isSupported();
      if (workerSupported) {
        try {
          await this.workerManager.initialize();
          this.isUsingWorker = true;
          this.isUsingFallback = false;
          console.log("🎙️ Using Kokoro TTS (Worker) for podcast generation");
          return { provider: "Kokoro TTS (Worker)", available: true };
        } catch (e) {
          console.error("Failed to initialize Kokoro Worker:", e);
          // Fall through to fallback
        }
      } else {
        console.warn("Web Workers not supported, falling back...");
      }
    }

    // Default to Web Speech API (always available fallback)
    const webSpeechAvailable = await this.webSpeechFallback.isAvailable();
    if (webSpeechAvailable) {
      this.provider = this.webSpeechFallback;
      this.isUsingFallback = true;
      this.isUsingWorker = false;
      console.log("🔊 Using Web Speech API for podcast generation");
      return { provider: "Web Speech API", available: true };
    }

    return { provider: "None", available: false };
  }

  async getAvailableVoices(): Promise<
    { id: string; name: string; gender?: string }[]
  > {
    if (!this.provider && !this.isUsingWorker) {
      await this.initialize();
    }

    // If using worker, return Kokoro voices (we can import the list or ask the worker,
    // but for now reusing the constant from the provider file is safe/fastest)
    if (this.isUsingWorker) {
      // We can dynamically load if needed, but for now specific imports are cleaner than circular deps
      // Re-using the known list from the constant file which we already imported keys for
      // In a perfect world, we'd ask the worker, but this is synchronous UI data
      const { KOKORO_VOICES } = await import("./kokoroTTSProvider");
      return Object.entries(KOKORO_VOICES).map(([id, info]) => ({
        id,
        name: info.name,
        gender: info.gender,
      }));
    }

    if (this.provider) {
      const voices = await this.provider.getVoices();
      return voices.map((v) => ({
        id: v.id,
        name: v.name,
        gender: v.gender,
      }));
    }

    return [];
  }

  async generatePodcastAudio(
    script: PodcastScript,
    config?: Partial<PodcastAudioConfig>,
    onProgress?: (progress: GenerationProgress) => void,
  ): Promise<PodcastAudioResult> {
    // Ensure initialized
    if (!this.provider && !this.isUsingWorker) {
      const init = await this.initialize();
      if (!init.available) {
        throw new Error("No TTS provider available.");
      }
    }

    const audioConfig = { ...getPodcastAudioConfig(), ...config };
    const segmentAudios: SegmentAudio[] = [];
    const audioBlobs: Blob[] = [];
    let totalDuration = 0;

    // Use Web Speech fallback
    if (this.isUsingFallback) {
      return this.generateWithWebSpeech(script, audioConfig, onProgress);
    }

    console.log(
      `🎙️ Generating unified podcast audio for ${script.segments.length} segments...`,
    );
    const providerName = this.isUsingWorker
      ? "Kokoro TTS (Worker)"
      : this.provider!.name;

    // Optimize/Combine segments for fewer calls if possible?
    // For now, keep 1:1 to ensure granular progress updates and easy stitching

    for (let i = 0; i < script.segments.length; i++) {
      const segment = script.segments[i];

      const speakerName = segment.speaker as string;
      const scriptMeta = script.metadata;
      const host1Name = scriptMeta?.host1Name || "Alex";
      const voice =
        speakerName === host1Name
          ? audioConfig.host1Voice
          : audioConfig.host2Voice;

      onProgress?.({
        currentSegment: i + 1,
        totalSegments: script.segments.length,
        status: `Generating ${segment.speaker}'s line (${i + 1}/${script.segments.length})...`,
        percentage: Math.round((i / script.segments.length) * 100),
      });

      try {
        let audioBlob: Blob;
        let audioUrl: string;
        let duration: number;

        if (this.isUsingWorker) {
          const result = await this.workerManager.synthesize(
            segment.text,
            voice,
            audioConfig.speed,
          );
          audioBlob = result.audioBlob;
          audioUrl = result.audioUrl;
          duration = result.duration;
        } else {
          // Main thread provider (Ultimate TTS)
          const response = await this.provider!.synthesize({
            text: segment.text,
            voice,
            speed: audioConfig.speed,
          });
          audioBlob = response.audioBlob;
          audioUrl = response.audioUrl;
          duration =
            response.duration ||
            this.estimateDuration(segment.text, audioConfig.speed);
        }

        segmentAudios.push({
          index: i,
          speaker: segment.speaker,
          audioUrl: audioUrl,
          duration,
        });

        audioBlobs.push(audioBlob);
        totalDuration += duration;

        // Add natural pause between speakers
        if (i < script.segments.length - 1) {
          const nextSpeaker = script.segments[i + 1].speaker;
          const pauseDuration =
            segment.speaker === nextSpeaker
              ? audioConfig.pauseBetweenSegments / 2000 // 250ms for same speaker
              : audioConfig.pauseBetweenSegments / 1000; // 500ms for different speaker

          const pauseBlob = this.createSilence(pauseDuration);
          audioBlobs.push(pauseBlob);
          totalDuration += pauseBlob.size > 0 ? pauseDuration : 0; // Approximate
        }
      } catch (error) {
        console.error(`Failed to generate audio for segment ${i}:`, error);
        continue;
      }
    }

    if (audioBlobs.length === 0) {
      throw new Error("Failed to generate any audio segments");
    }

    onProgress?.({
      currentSegment: script.segments.length,
      totalSegments: script.segments.length,
      status: "Creating unified audio file...",
      percentage: 95,
    });

    const combinedBlob = await this.combineAudioBlobs(audioBlobs);
    const combinedUrl = URL.createObjectURL(combinedBlob);

    console.log(
      `✅ Podcast audio ready: ${totalDuration.toFixed(1)}s total duration`,
    );

    onProgress?.({
      currentSegment: script.segments.length,
      totalSegments: script.segments.length,
      status: "Complete!",
      percentage: 100,
    });

    return {
      audioBlob: combinedBlob,
      audioUrl: combinedUrl,
      duration: totalDuration,
      provider: providerName,
      segments: segmentAudios,
    };
  }

  private async generateWithWebSpeech(
    script: PodcastScript,
    config: PodcastAudioConfig,
    onProgress?: (progress: GenerationProgress) => void,
  ): Promise<PodcastAudioResult> {
    // For Web Speech API, we create a script-based result
    const segmentAudios: SegmentAudio[] = script.segments.map((segment, i) => ({
      index: i,
      speaker: segment.speaker,
      audioUrl: "",
      duration: this.estimateDuration(segment.text, config.speed),
    }));

    const totalDuration = segmentAudios.reduce((sum, s) => sum + s.duration, 0);

    const scriptData = {
      type: "web-speech-script",
      script,
      config,
    };
    const scriptBlob = new Blob([JSON.stringify(scriptData)], {
      type: "application/json",
    });
    const scriptUrl = URL.createObjectURL(scriptBlob);

    onProgress?.({
      currentSegment: script.segments.length,
      totalSegments: script.segments.length,
      status: "Ready for playback (Web Speech)",
      percentage: 100,
    });

    return {
      audioBlob: scriptBlob,
      audioUrl: scriptUrl,
      duration: totalDuration,
      provider: "Web Speech API",
      segments: segmentAudios,
    };
  }

  private estimateDuration(text: string, speed: number): number {
    const words = text.split(/\s+/).length;
    const minutes = words / (150 * speed);
    return minutes * 60;
  }

  private createSilence(durationSeconds: number): Blob {
    const sampleRate = 44100;
    const numSamples = Math.floor(sampleRate * durationSeconds);
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);

    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, "RIFF");
    view.setUint32(4, 36 + numSamples * 2, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, numSamples * 2, true);

    return new Blob([buffer], { type: "audio/wav" });
  }

  private async combineAudioBlobs(blobs: Blob[]): Promise<Blob> {
    return combineWavBlobs(blobs);
  }

  // Check if Ultimate TTS Studio is available at a given endpoint
  static async checkEndpoint(endpoint: string): Promise<boolean> {
    const provider = new UltimateTTSProvider(endpoint);
    return provider.isAvailable();
  }

  // Update the TTS endpoint
  static setEndpoint(endpoint: string): void {
    saveTTSConfig({ endpoint, provider: "ultimate-tts" });
  }
}

// Singleton instance
let generatorInstance: PodcastAudioGenerator | null = null;

export function getPodcastAudioGenerator(): PodcastAudioGenerator {
  if (!generatorInstance) {
    generatorInstance = new PodcastAudioGenerator();
  }
  return generatorInstance;
}
