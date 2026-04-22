import fetch from 'node-fetch';

async function test() {
  const videoId = 'fXfB9XUfA7M';
  const url = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';
  const ua = 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)';
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': ua
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: 'ANDROID',
          clientVersion: '20.10.38'
        }
      },
      videoId: videoId
    })
  });
  
  const data = await response.json();
  const captions = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  console.log('Captions found:', !!captions);
  if (captions) {
    console.log('Number of tracks:', captions.length);
  } else {
    console.log('Keys returned:', Object.keys(data));
    console.log('Error block?:', !!data.responseContext);
  }
}

test();
