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
  console.log('HTML Length (Android):', html.length);
  
  // Try innerTube api key
  const apiKeyMatch = html.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/);
  console.log('Key found:', !!apiKeyMatch);
  
  if (apiKeyMatch) {
     console.log('Key:', apiKeyMatch[1]);
  }
  
  console.log('Bot detection?:', html.includes('captcha') || html.includes('consent'));
  
  // Test Piped API fallback just in case
  try {
    const pipedRes = await fetch(`https://pipedapi.kavin.rocks/streams/${videoId}`);
    const pipedData = await pipedRes.json();
    console.log('Piped API Subtitles Array Length:', pipedData.subtitles?.length || 0);
  } catch (e) {
    console.log('Piped error:', e.message);
  }
}

test();
