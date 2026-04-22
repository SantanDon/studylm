import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

// STABILITY PATCH v8: jsdom and readability PURGED.
// These libraries trigger fatal linkage errors (ERR_REQUIRE_ESM) on Vercel.
// We are using native Cheerio for robust extraction.

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
];

/**
 * Metadata extractor via Cheerio
 */
function extractMeta($) {
  return {
    title: $('title').text() || $('h1').first().text() || 'Untitled',
    description: $('meta[name="description"]').attr('content') || 
                  $('meta[property="og:description"]').attr('content') || '',
    author: $('meta[name="author"]').attr('content') || 'Unknown'
  };
}

/**
 * Phase 1: Cheerio. Fast, static HTML extraction.
 */
async function extractWithCheerio(url) {
  const isReddit = url.includes('reddit.com');
  
  // High-fidelity headers to bypass bot walls (Reddit/X)
  const headers = {
    'User-Agent': isReddit 
      ? 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' 
      : USER_AGENTS[0],
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache'
  };

  const response = await fetch(url, {
    headers,
    timeout: 15000 
  });

  if (!response.ok) {
    if (isReddit && response.status === 403) {
      throw new Error('Reddit blocked standard extraction. Try Firecrawl fallback.');
    }
    throw new Error(`HTTP ${response.status}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  
  // Clean up bloat
  $('script, style, iframe, noscript, footer, nav, aside, .ad, .ads, #header, #footer').remove();
  
  // Transform to structural markdown (Simple conversion)
  $('h1, h2, h3').each((i, el) => {
    const level = el.tagName.substring(1);
    $(el).replaceWith(`\n\n${'#'.repeat(level)} ${$(el).text().trim()}\n\n`);
  });
  
  $('p').each((i, el) => {
    $(el).replaceWith(`\n${$(el).text().trim()}\n`);
  });

  $('li').each((i, el) => {
    $(el).replaceWith(`\n- ${$(el).text().trim()}`);
  });

  // Reddit-specific content targeting (shrd:post-body etc)
  let content = isReddit 
    ? $('shreddit-post, .post-content, #content').text() 
    : $('article, main, body').text();

  if (!content || content.length < 200) {
    content = $('body').text();
  }

  // Cleanup whitespace but preserve structure
  content = content.replace(/\n\s*\n/g, '\n\n').replace(/[ \t]+/g, ' ').trim();
  const meta = extractMeta($);

  // STABILITY PATCH: Refined error detection
  // We only block if the content is suspiciously short AND contains systemic failure words.
  // Legitimate startup post-mortems or legal research will be much longer.
  const isLikelySystemError = content.length < 300 && (
    content.toLowerCase().includes("access denied") ||
    content.toLowerCase().includes("pardon our interruption") ||
    content.toLowerCase().includes("bot detection") ||
    content.toLowerCase().includes("failed to fetch") ||
    content.toLowerCase().includes("403 forbidden")
  );

  if (isLikelySystemError) throw new Error('Systemic extraction failure: Site blocked or denied access.');
  if (content.length < 50) throw new Error('Insufficient content extracted.');

  return {
    content,
    title: meta.title,
    metadata: { ...meta, method: 'cheerio-dynamic-porter' }
  };
}

/**
 * Phase 2 (ULTRA): Jina Reader. Handles JS/SPA rendering without an API key.
 */
async function extractWithJina(url) {
  const jinaUrl = `https://r.jina.ai/${url}`;
  console.log(`[Extraction] Attempting Jina Reader fallback for: ${url}`);
  
  const response = await fetch(jinaUrl, {
    method: 'GET',
    headers: {
      'Accept': 'text/plain',
      'X-No-Cache': 'true'
    },
    timeout: 30000 // Jina can take a moment to render
  });

  if (!response.ok) {
    throw new Error(`Jina Reader failed: ${response.status}`);
  }

  const markdown = await response.text();
  
  if (!markdown || markdown.length < 100) {
    throw new Error('Jina Reader returned insufficient content.');
  }

  // Jina returns "Title: ..." as the first line often
  const firstLine = markdown.split('\n')[0] || '';
  const titleMatch = firstLine.match(/^#?\s*(.+)$/);
  const title = titleMatch ? titleMatch[1].replace('Title: ', '').trim() : url;

  return {
    content: markdown,
    title: title,
    metadata: { method: 'jina-reader-high-fidelity', author: 'Jina AI' }
  };
}

/**
 * Phase 3: Direct Firecrawl API call.
 */
async function extractWithFirecrawl(url) {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error('Firecrawl API Key missing.');
  
  const response = await fetch('https://api.firecrawl.dev/v0/scrape', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({ url })
  });

  const json = await response.json();
  if (!json.success) throw new Error(json.error || 'Firecrawl failed');

  return {
    content: json.data?.markdown || json.data?.content || '',
    title: json.data?.metadata?.title || url,
    metadata: { method: 'firecrawl-api-v0' }
  };
}

export async function extractWebSource(url) {
  try {
    return await extractWithCheerio(url);
  } catch (err) {
    console.warn(`[Extraction] Cheerio failed for ${url}, trying Jina Reader...`);
    try {
      return await extractWithJina(url);
    } catch (err2) {
      console.warn(`[Extraction] Jina Reader failed, checking Firecrawl...`);
      try {
        return await extractWithFirecrawl(url);
      } catch (err3) {
        throw new Error('Extraction exhausted across all layers.');
      }
    }
  }
}

export default { extractWebSource };
