/**
 * Audio Extraction Utilities using Transformers.js (Whisper)
 * Runs entirely client-side.
 */

import { pipeline, env } from '@huggingface/transformers';

// Configuration for browser environment
env.allowLocalModels = false;
env.useBrowserCache = true;

// Singleton to manage the model pipeline
class SpeechRecognitionPipeline {
  static task = 'automatic-speech-recognition';
  // The tiny Whisper checkpoint keeps first-run browser downloads manageable.
  static model = 'onnx-community/whisper-tiny';
  static instance: unknown = null;

  static async getInstance(progress_callback?: (data: { status: string; progress?: number }) => void) {
    if (this.instance === null) {
      console.log(`Loading Whisper model: ${this.model}...`);
      this.instance = await pipeline(this.task as "automatic-speech-recognition", this.model, { 
        progress_callback 
      });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.instance as any; // Cast back to any for legacy usage if necessary, but internal type is safe
  }
}

export interface AudioExtractionResult {
  text: string;
  language?: string;
  metadata: {
     duration?: number;
     model: string;
  }
}

/**
 * Extract text from an audio or video file using local Whisper model.
 */
export async function extractAudio(
    file: File, 
    onStatusUpdate?: (status: string) => void
): Promise<AudioExtractionResult> {
  
  const startTime = performance.now();
  
  try {
    if (onStatusUpdate) onStatusUpdate("Loading Whisper model...");
    
    // 1. Get the transcriber pipeline
    const transcriber = await SpeechRecognitionPipeline.getInstance((data: { status: string; progress?: number }) => {
        if (data.status === 'progress' && onStatusUpdate) {
            // Report download progress
            const percent = data.progress ? Math.round(data.progress) : 0;
            if (percent % 10 === 0) { // Throttle updates
                 onStatusUpdate(`Downloading model: ${percent}%`);
            }
        }
    });

    if (onStatusUpdate) onStatusUpdate("Transcribing audio (this may take a moment)...");

    // 2. Prepare input
    const url = URL.createObjectURL(file);

    // 3. Run transcription
    // Using chunk_length_s to handle longer files better
    const output = await transcriber(url, {
      chunk_length_s: 30,
      stride_length_s: 5,
      language: 'en', // Default to English for now, can be 'auto'
      task: 'transcribe',
      return_timestamps: true
    });

    URL.revokeObjectURL(url);

    const text = typeof output === 'string' ? output : 
                 (output.text || (Array.isArray(output) ? output.map(c => c.text).join(' ') : ''));

    const endTime = performance.now();
    const duration = (endTime - startTime) / 1000;
    
    console.log(`Audio transcription completed in ${duration.toFixed(2)}s`);

    return {
        text: text.trim(),
        metadata: {
            duration,
            model: SpeechRecognitionPipeline.model
        }
    };

  } catch (error) {
    console.error("Audio extraction failed:", error);
    throw new Error(`Audio extraction failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
