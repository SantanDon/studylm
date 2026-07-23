import { parentPort, workerData } from 'worker_threads';
import { runFullAudiobookJob } from '../routes/audiobook.js';

try {
  const job = await runFullAudiobookJob(workerData);
  parentPort?.postMessage({
    status: 'completed',
    jobId: workerData.jobId,
    fileName: job?.fileName,
  });
} catch (error) {
  parentPort?.postMessage({
    status: 'failed',
    jobId: workerData.jobId,
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
}
