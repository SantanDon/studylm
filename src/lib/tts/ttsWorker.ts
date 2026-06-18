/**
 * TTS Web Worker Manager
 * Manages the TTS worker for non-blocking audio generation
 * 
 * This class handles:
 * 1. Worker lifecycle (creation, termination)
 * 2. Message passing to/from worker
 * 3. Promise-based API for synthesis
 * 4. Fallback detection when workers aren't supported
 */

// Worker message types
export interface TTSWorkerRequest {
  type: 'init' | 'synthesize' | 'cancel' | 'checkWebGPU';
  id?: string;
  text?: string;
  voice?: string;
  speed?: number;
}

export interface TTSWorkerResponse {
  type: 'ready' | 'progress' | 'audio' | 'error' | 'webgpu-status';
  id?: string;
  audioData?: ArrayBuffer;
  duration?: number;
  message?: string;
  percentage?: number;
  webgpuAvailable?: boolean;
}

export interface SynthesisResult {
  audioBlob: Blob;
  audioUrl: string;
  duration: number;
}

export type ProgressCallback = (message: string, percentage: number) => void;

class TTSWorkerManager {
  private worker: Worker | null = null;
  private isReady = false;
  private isInitializing = false;
  private pendingRequests = new Map<string, {
    resolve: (result: SynthesisResult) => void;
    reject: (error: Error) => void;
  }>();
  private progressCallbacks = new Map<string, ProgressCallback>();
  private initPromise: Promise<void> | null = null;
  private webgpuAvailable: boolean | null = null;

  /**
   * Check if Web Workers with SharedArrayBuffer are supported
   */
  static isSupported(): boolean {
    try {
      // Check for Worker support
      if (typeof Worker === 'undefined') return false;
      
      // Check for SharedArrayBuffer (required for ONNX threading)
      if (typeof SharedArrayBuffer === 'undefined') {
        console.warn('SharedArrayBuffer not available - COOP/COEP headers may be missing');
        return false;
      }
      
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Initialize the worker
   */
  async initialize(onProgress?: ProgressCallback): Promise<void> {
    if (this.isReady) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._doInitialize(onProgress);
    return this.initPromise;
  }

  private async _doInitialize(onProgress?: ProgressCallback): Promise<void> {
    if (this.isInitializing) return;
    this.isInitializing = true;

    try {
      // Create worker from the worker script
      this.worker = new Worker(
        new URL('./ttsWorkerScript.ts', import.meta.url),
        { type: 'module' }
      );

      // Set up message handler
      this.worker.onmessage = (event: MessageEvent<TTSWorkerResponse>) => {
        this.handleWorkerMessage(event.data);
      };

      this.worker.onerror = (error) => {
        console.error('TTS Worker error:', error);
        this.handleWorkerError(new Error(error.message || 'Worker error'));
      };

      // Wait for worker to be ready
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Worker initialization timeout - model loading took too long. This may be due to slow network or large model size.'));
        }, 120000); // 120 second timeout for model loading (increased for slow connections)

        const originalHandler = this.worker!.onmessage;
        this.worker!.onmessage = (event: MessageEvent<TTSWorkerResponse>) => {
          const data = event.data;
          
          if (data.type === 'progress' && onProgress) {
            onProgress(data.message || '', data.percentage || 0);
          }
          
          if (data.type === 'ready') {
            clearTimeout(timeout);
            this.isReady = true;
            this.worker!.onmessage = originalHandler;
            resolve();
          } else if (data.type === 'error' && !this.isReady) {
            clearTimeout(timeout);
            reject(new Error(data.message || 'Initialization failed'));
          }
          
          // Also call original handler
          if (originalHandler) {
            originalHandler.call(this.worker, event);
          }
        };

        // Send init message
        this.worker!.postMessage({ type: 'init' } as TTSWorkerRequest);
      });

    } catch (error) {
      this.isInitializing = false;
      this.initPromise = null;
      throw error;
    }
  }


  /**
   * Handle messages from the worker
   */
  private handleWorkerMessage(data: TTSWorkerResponse): void {
    const { type, id, audioData, duration, message, percentage, webgpuAvailable } = data;

    switch (type) {
      case 'audio':
        if (id && this.pendingRequests.has(id)) {
          const { resolve } = this.pendingRequests.get(id)!;
          this.pendingRequests.delete(id);
          this.progressCallbacks.delete(id);

          if (audioData) {
            const blob = new Blob([audioData], { type: 'audio/wav' });
            const url = URL.createObjectURL(blob);
            resolve({
              audioBlob: blob,
              audioUrl: url,
              duration: duration || 0,
            });
          }
        }
        break;

      case 'error':
        if (id && this.pendingRequests.has(id)) {
          const { reject } = this.pendingRequests.get(id)!;
          this.pendingRequests.delete(id);
          this.progressCallbacks.delete(id);
          reject(new Error(message || 'Synthesis failed'));
        }
        break;

      case 'progress':
        if (id && this.progressCallbacks.has(id)) {
          const callback = this.progressCallbacks.get(id)!;
          callback(message || '', percentage || 0);
        }
        break;

      case 'webgpu-status':
        this.webgpuAvailable = webgpuAvailable || false;
        break;
    }
  }

  /**
   * Handle worker errors
   */
  private handleWorkerError(error: Error): void {
    // Reject all pending requests
    for (const [, { reject }] of this.pendingRequests) {
      reject(error);
    }
    this.pendingRequests.clear();
    this.progressCallbacks.clear();
  }

  /**
   * Synthesize text to audio
   */
  async synthesize(
    text: string,
    voice: string,
    speed: number = 1.0,
    onProgress?: ProgressCallback
  ): Promise<SynthesisResult> {
    if (!this.worker || !this.isReady) {
      throw new Error('Worker not initialized. Call initialize() first.');
    }

    const id = `synth-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      
      if (onProgress) {
        this.progressCallbacks.set(id, onProgress);
      }

      this.worker!.postMessage({
        type: 'synthesize',
        id,
        text,
        voice,
        speed,
      } as TTSWorkerRequest);
    });
  }

  /**
   * Cancel ongoing synthesis
   */
  cancel(): void {
    if (this.worker) {
      this.worker.postMessage({ type: 'cancel' } as TTSWorkerRequest);
    }
    
    // Reject all pending requests
    for (const [, { reject }] of this.pendingRequests) {
      reject(new Error('Cancelled'));
    }
    this.pendingRequests.clear();
    this.progressCallbacks.clear();
  }

  /**
   * Check if WebGPU is available
   */
  async checkWebGPU(): Promise<boolean> {
    if (this.webgpuAvailable !== null) {
      return this.webgpuAvailable;
    }

    // Check directly if worker not ready
    try {
      if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
        const adapter = await (navigator as unknown as { gpu: { requestAdapter: () => Promise<unknown> } }).gpu.requestAdapter();
        this.webgpuAvailable = adapter !== null;
        return this.webgpuAvailable;
      }
    } catch {
      // Ignore
    }
    
    this.webgpuAvailable = false;
    return false;
  }

  /**
   * Check if the worker is ready
   */
  isWorkerReady(): boolean {
    return this.isReady;
  }

  /**
   * Terminate the worker
   */
  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.isReady = false;
    this.isInitializing = false;
    this.initPromise = null;
    this.pendingRequests.clear();
    this.progressCallbacks.clear();
  }
}

// Singleton instance
let workerManager: TTSWorkerManager | null = null;

export function getTTSWorkerManager(): TTSWorkerManager {
  if (!workerManager) {
    workerManager = new TTSWorkerManager();
  }
  return workerManager;
}

export { TTSWorkerManager };
