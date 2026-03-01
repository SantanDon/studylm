// Vercel Serverless Function for Firecrawl API (free tier: 500 credits/month)
// Falls back gracefully if no API key or rate limited

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  const targetUrl = req.query.url;

  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing "url" query parameter' });
  }

  const apiKey = process.env.FIRECRAWL_API_KEY;
  
  // If no API key, return a signal to use fallback
  if (!apiKey) {
    console.log('[Firecrawl] No API key configured, signaling fallback');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json({ 
      success: false,
      fallback: true,
      reason: 'No API key configured'
    });
  }

  console.log(`[Firecrawl] Scraping: ${targetUrl}`);

  try {
    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url: targetUrl,
        formats: ['markdown', 'html'],
        onlyMainContent: true,
        waitFor: 1000,
        timeout: 25000,
      }),
    });

    const data = await response.json();

    if (response.status === 429 || response.status === 402) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(200).json({ 
        success: false,
        fallback: true,
        reason: response.status === 429 ? 'Rate limited' : 'Quota exceeded'
      });
    }

    if (!response.ok) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(200).json({ 
        success: false,
        fallback: true,
        reason: data.error || `API error ${response.status}`
      });
    }

    if (!data.success || !data.data) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(200).json({ 
        success: false,
        fallback: true,
        reason: 'Extraction failed'
      });
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json({
      success: true,
      data: {
        markdown: data.data.markdown || '',
        html: data.data.html || '',
        title: data.data.metadata?.title || '',
        description: data.data.metadata?.description || '',
        url: data.data.metadata?.sourceURL || targetUrl,
      }
    });

  } catch (error) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json({ 
      success: false,
      fallback: true,
      reason: `Network error: ${error.message}`
    });
  }
}
