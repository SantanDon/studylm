import fetch from 'node-fetch';

function parseInlineJson(html, variableName) {
  const searchPrefix = `var ${variableName} = `;
  let startIndex = html.indexOf(searchPrefix);
  if (startIndex === -1) {
    // sometimes it's window["..."] = or without var
    const altSearch = `${variableName} = `;
    startIndex = html.indexOf(altSearch);
    if (startIndex === -1) return null;
    startIndex += altSearch.length;
  } else {
    startIndex += searchPrefix.length;
  }

  let openBraces = 0;
  for (let i = startIndex; i < html.length; i++) {
    if (html[i] === '{') {
      openBraces++;
    } else if (html[i] === '}') {
      openBraces--;
      if (openBraces === 0) {
        try {
          return JSON.parse(html.slice(startIndex, i + 1));
        } catch (e) {
          return null;
        }
      }
    }
  }
  return null;
}

async function test() {
  const videoId = 'j51uMah-3js';
  const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.83 Safari/537.36,gzip(gfe)';
  
  const pageResponse = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      'User-Agent': ua,
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });
  const html = await pageResponse.text();
  console.log('HTML Length:', html.length);
  
  const data = parseInlineJson(html, 'ytInitialPlayerResponse');
  console.log('Parsed JSON?', !!data);
  if (data) {
    const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    console.log('Tracks found:', tracks?.length || 0);
  }
}

test();
