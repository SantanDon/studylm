import fetch from 'node-fetch';

async function test() {
  const videoId = 'fXfB9XUfA7M';
  const ua = 'com.google.android.youtube/20.10.38(Linux; U; Android 13) gzip';
  const pageResponse = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      'User-Agent': ua,
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });
  const html = await pageResponse.text();
  
  const captionMatch = html.match(/"captionTracks":(\[.*?\])/);
  console.log('captionTracks found in Android HTML?', !!captionMatch);
}

test();
