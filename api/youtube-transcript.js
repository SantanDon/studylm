// Vercel Serverless Function for fetching YouTube transcripts
import { YoutubeTranscript } from '@danielxceron/youtube-transcript';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    return res.status(204).end();
  }

  const videoUrl = req.query.url;

  if (!videoUrl) {
    return res.status(400).json({ error: 'Missing "url" query parameter' });
  }

  console.log(`[YouTube API] Fetching transcript for: ${videoUrl}`);

  const languages = ['en', 'en-US', 'en-GB', 'auto'];
  let transcript = null;
  let lastError = null;

  for (const lang of languages) {
    try {
      const options = lang === 'auto' ? {} : { lang };
      transcript = await YoutubeTranscript.fetchTranscript(videoUrl, options);
      if (transcript && transcript.length > 0) break;
    } catch (error) {
      lastError = error;
    }
  }

  // Piped API fallback
  if (!transcript || transcript.length === 0) {
    try {
      let videoId = videoUrl;
      if (videoUrl.includes('v=')) {
        videoId = videoUrl.split('v=')[1].split('&')[0];
      } else if (videoUrl.includes('youtu.be/')) {
        videoId = videoUrl.split('youtu.be/')[1].split('?')[0];
      }

      const pipedInstances = [
        "https://pipedapi.kavin.rocks",
        "https://api.piped.yt",
      ];

      for (const baseUrl of pipedInstances) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 3000);
          
          const pipedResponse = await fetch(`${baseUrl}/streams/${videoId}`, { signal: controller.signal });
          clearTimeout(timeoutId);
          
          if (pipedResponse.ok) {
            const data = await pipedResponse.json();
            if (data.subtitles && data.subtitles.length > 0) {
              const subtitleTrack = data.subtitles.find(s => s.code === 'en') || data.subtitles[0];
              if (subtitleTrack) {
                const subContentResponse = await fetch(subtitleTrack.url);
                const subText = await subContentResponse.text();
                const jsonSub = JSON.parse(subText);
                transcript = jsonSub.map(item => ({
                  text: item.text || item.content,
                  duration: item.duration,
                  offset: item.start
                }));
                break;
              }
            }
          }
        } catch (e) { /* continue */ }
      }
    } catch (e) { /* ignore */ }
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  
  if (transcript && transcript.length > 0) {
    return res.status(200).json({ transcript, segmentCount: transcript.length });
  }

  let errorMessage = lastError?.message || 'Failed to fetch transcript';
  return res.status(500).json({ error: errorMessage });
}
