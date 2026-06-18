/**
 * AudioValidator
 * Validates generated podcast audio for integrity and speech content.
 * Detects silent/corrupt WAV files that would produce no audible output.
 */

export interface AudioValidationResult {
  valid: boolean;
  duration: number;
  sampleRate: number;
  channels: number;
  rms: number;
  peak: number;
  silenceRatio: number;
  hasSpeech: boolean;
  issues: string[];
}

const SILENCE_THRESHOLD = 0.005;
const SPEECH_RMS_THRESHOLD = 0.015;
const MIN_SPEECH_DURATION = 2;
const MAX_SILENCE_RATIO = 0.95;

export class AudioValidator {
  /**
   * Validate a single WAV blob for audio integrity and speech content.
   */
  static async validateBlob(blob: Blob): Promise<AudioValidationResult> {
    const issues: string[] = [];

    if (!blob || blob.size === 0) {
      return {
        valid: false,
        duration: 0,
        sampleRate: 0,
        channels: 0,
        rms: 0,
        peak: 0,
        silenceRatio: 1,
        hasSpeech: false,
        issues: ['Blob is empty or null'],
      };
    }

    if (blob.size < 44) {
      return {
        valid: false,
        duration: 0,
        sampleRate: 0,
        channels: 0,
        rms: 0,
        peak: 0,
        silenceRatio: 1,
        hasSpeech: false,
        issues: ['Blob too small to be a valid WAV file'],
      };
    }

    if (blob.size < 1024) {
      issues.push(`WAV file is very small (${blob.size} bytes), may be empty/silent`);
    }

    // Check WAV header integrity
    const headerValid = await AudioValidator.checkWavHeader(blob);
    if (!headerValid.valid) {
      return {
        valid: false,
        duration: 0,
        sampleRate: headerValid.sampleRate || 0,
        channels: headerValid.channels || 0,
        rms: 0,
        peak: 0,
        silenceRatio: 1,
        hasSpeech: false,
        issues: [...issues, ...headerValid.issues],
      };
    }

    const { sampleRate, channels } = headerValid;

    // Decode and analyze audio content
    const audioData = await AudioValidator.decodeAndAnalyze(blob);

    if (!audioData) {
      return {
        valid: false,
        duration: 0,
        sampleRate,
        channels,
        rms: 0,
        peak: 0,
        silenceRatio: 1,
        hasSpeech: false,
        issues: [...issues, 'Could not decode audio data'],
      };
    }

    const { rms, peak, silenceRatio, duration } = audioData;

    const hasSpeech = rms >= SPEECH_RMS_THRESHOLD && duration >= MIN_SPEECH_DURATION && silenceRatio < MAX_SILENCE_RATIO;

    if (!hasSpeech) {
      if (rms < SPEECH_RMS_THRESHOLD) {
        issues.push(`Audio energy too low (RMS: ${rms.toFixed(4)}) — likely silence`);
      }
      if (duration < MIN_SPEECH_DURATION) {
        issues.push(`Audio too short (${duration.toFixed(1)}s) for speech`);
      }
      if (silenceRatio >= MAX_SILENCE_RATIO) {
        issues.push(`Audio is ${(silenceRatio * 100).toFixed(0)}% silent`);
      }
    }

    return {
      valid: hasSpeech && issues.length === 0,
      duration,
      sampleRate,
      channels,
      rms,
      peak,
      silenceRatio,
      hasSpeech,
      issues,
    };
  }

  /**
   * Check WAV header integrity without decoding the full audio.
   */
  private static async checkWavHeader(blob: Blob): Promise<{
    valid: boolean;
    sampleRate?: number;
    channels?: number;
    dataSize?: number;
    issues: string[];
  }> {
    const issues: string[] = [];
    const header = await blob.slice(0, 44).arrayBuffer();
    const view = new DataView(header);

    const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    if (riff !== 'RIFF') {
      issues.push(`Invalid RIFF header: "${riff}"`);
      return { valid: false, issues };
    }

    const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
    if (wave !== 'WAVE') {
      issues.push(`Invalid WAVE identifier: "${wave}"`);
      return { valid: false, issues };
    }

    const fmt = String.fromCharCode(view.getUint8(12), view.getUint8(13), view.getUint8(14), view.getUint8(15));
    if (fmt !== 'fmt ') {
      issues.push(`Invalid fmt chunk: "${fmt}"`);
      return { valid: false, issues };
    }

    const audioFormat = view.getUint16(20, true);
    if (audioFormat !== 1) {
      issues.push(`Unsupported audio format: ${audioFormat} (expected 1 = PCM)`);
    }

    const channels = view.getUint16(22, true);
    const sampleRate = view.getUint32(24, true);

    if (channels === 0) {
      issues.push('Zero channels');
    }
    if (sampleRate === 0) {
      issues.push('Zero sample rate');
    }

    const fileSize = blob.size;
    const dataSize = fileSize - 44;

    if (dataSize <= 0) {
      issues.push(`No audio data (data chunk size: ${dataSize})`);
    }

    return {
      valid: issues.length === 0,
      sampleRate,
      channels,
      dataSize,
      issues,
    };
  }

  /**
   * Decode WAV and analyze audio samples for speech content.
   */
  private static async decodeAndAnalyze(
    blob: Blob,
  ): Promise<{ rms: number; peak: number; silenceRatio: number; duration: number } | null> {
    try {
      const audioContext = new AudioContext();
      const arrayBuffer = await blob.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      await audioContext.close();

      const duration = audioBuffer.duration;
      const numChannels = audioBuffer.numberOfChannels;
      const numSamples = audioBuffer.length;

      let sumSquares = 0;
      let peak = 0;
      let silentSamples = 0;

      for (let channel = 0; channel < numChannels; channel++) {
        const channelData = audioBuffer.getChannelData(channel);
        for (let i = 0; i < numSamples; i++) {
          const sample = Math.abs(channelData[i]);
          sumSquares += sample * sample;
          if (sample > peak) peak = sample;
          if (sample < SILENCE_THRESHOLD) silentSamples++;
        }
      }

      const totalSamples = numSamples * numChannels;
      const rms = Math.sqrt(sumSquares / totalSamples);
      const silenceRatio = silentSamples / totalSamples;

      return { rms, peak, silenceRatio, duration };
    } catch {
      return null;
    }
  }
}
