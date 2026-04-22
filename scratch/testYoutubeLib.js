import { YoutubeTranscript } from 'youtube-transcript';

async function run() {
  try {
    const transcript = await YoutubeTranscript.fetchTranscript('fXfB9XUfA7M');
    console.log('Success! Transcript length:', transcript.length);
  } catch (err) {
    console.error('Failed:', err.message);
  }
}

run();
