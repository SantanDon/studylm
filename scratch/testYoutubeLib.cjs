const { YoutubeTranscript } = require('youtube-transcript');

async function run() {
  try {
    const transcript = await YoutubeTranscript.fetchTranscript('fXfB9XUfA7M');
    console.log('Success! Transcript length:', transcript.length);
    console.log(transcript.slice(0, 3));
  } catch (err) {
    console.error('Failed:', err.message);
  }
}

run();
