import fetch from 'node-fetch';

async function test() {
  const videoId = 'fXfB9XUfA7M';
  const pageResponse = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cookie': 'CONSENT=YES+cb.20210328-17-p0.en-GB+FX+413; SOCS=CAESEwgDEgk0ODE3Nzk3MjQaAnNnIAEaBgiA_LyaBg',
    }
  });
  const html = await pageResponse.text();
  
  console.log('HTML Length:', html.length);
  
  const captionMatch = html.match(/"captionTracks":(\[.*?\])/);
  if (captionMatch) {
    console.log('Found captionTracks via regex!');
    console.log(captionMatch[1]);
  } else {
    console.log('NO captionTracks field found in raw HTML. Bot block check:', html.includes('captcha') || html.includes('consent'));
  }
}

test();
