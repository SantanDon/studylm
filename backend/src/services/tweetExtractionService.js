/**
 * Tweet Extraction Service
 *
 * Extracts tweet content, embedded links, and reply/comment links
 * from X/Twitter URLs. Designed to feed the Bookmark Deep-Dive pipeline.
 *
 * Strategy:
 *  1. oEmbed API (no auth) — tweet text + author
 *  2. URL regex from tweet body — finds GitHub, articles, etc.
 *  3. Twitter API v2 Bearer Token (optional) — fetches replies for link mining
 *     Falls back gracefully if no bearer token is configured.
 */

import fetch from "node-fetch";
import { logger } from "../utils/logger.js";

const TWITTER_BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN || null;

// URL regex that captures http/https links (excluding twitter.com self-links and t.co tracking)
const URL_REGEX = /https?:\/\/(?!(?:twitter\.com|x\.com|t\.co))[^\s"'<>]+/g;

/**
 * Parse tweet ID from a twitter/x.com URL
 */
export function parseTweetId(url) {
  const match = url.match(/(?:twitter|x)\.com\/[^/]+\/status(?:es)?\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * Fetch tweet text via oEmbed — no auth required, public tweets only.
 */
async function fetchViaOEmbed(tweetUrl) {
  const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(tweetUrl)}&omit_script=true&hide_thread=false`;

  const response = await fetch(oembedUrl, {
    headers: { "User-Agent": "StudyPodLM-Research/1.0" },
    timeout: 10000,
  });

  if (!response.ok) {
    throw new Error(`oEmbed request failed: HTTP ${response.status}`);
  }

  const data = await response.json();

  // Strip HTML tags from the embed HTML to get clean text
  const rawHtml = data.html || "";
  const textContent = rawHtml
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([^<]*)<\/a>/gi, "$2 [$1]")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();

  return {
    text: textContent,
    author: data.author_name || "Unknown",
    authorUrl: data.author_url || "",
    embedHtml: rawHtml,
  };
}

/**
 * Fetch tweet data via Twitter API v2 (requires Bearer Token)
 * Returns full tweet text + referenced tweets
 */
async function fetchViaTweetAPI(tweetId) {
  if (!TWITTER_BEARER_TOKEN) return null;

  const url = `https://api.twitter.com/2/tweets/${tweetId}?tweet.fields=text,entities,author_id&expansions=author_id&user.fields=name,username`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${TWITTER_BEARER_TOKEN}`,
        "User-Agent": "StudyPodLM-Research/1.0",
      },
      timeout: 10000,
    });

    if (!response.ok) {
      logger.warn(
        `[TweetAPI] API v2 failed for tweet ${tweetId}: HTTP ${response.status}`,
      );
      return null;
    }

    const data = await response.json();
    if (!data.data) return null;

    const tweet = data.data;
    const users = data.includes?.users || [];
    const author = users.find((u) => u.id === tweet.author_id);

    // Extract URLs from entities
    const entityUrls = (tweet.entities?.urls || [])
      .filter(
        (u) =>
          !u.expanded_url.includes("twitter.com") &&
          !u.expanded_url.includes("x.com"),
      )
      .map((u) => u.expanded_url);

    return {
      text: tweet.text,
      author: author ? `${author.name} (@${author.username})` : "Unknown",
      entityUrls,
      tweetId,
    };
  } catch (err) {
    logger.warn(`[TweetAPI] v2 fetch failed: ${err.message}`);
    return null;
  }
}

/**
 * Fetch replies/comments for a tweet via Twitter API v2.
 * Mines links from the replies — this is the "comments with links" feature.
 * Returns at most 50 replies, extracting all URLs found.
 */
async function fetchReplyLinks(tweetId) {
  if (!TWITTER_BEARER_TOKEN) {
    logger.info("[TweetAPI] No bearer token — skipping reply link mining");
    return [];
  }

  // Search for replies to this tweet
  const query = encodeURIComponent(
    `conversation_id:${tweetId} has:links -is:retweet`,
  );
  const url = `https://api.twitter.com/2/tweets/search/recent?query=${query}&tweet.fields=text,entities&max_results=50`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${TWITTER_BEARER_TOKEN}`,
        "User-Agent": "StudyPodLM-Research/1.0",
      },
      timeout: 12000,
    });

    if (!response.ok) {
      logger.warn(
        `[TweetAPI] Reply search failed for ${tweetId}: HTTP ${response.status}`,
      );
      return [];
    }

    const data = await response.json();
    if (!data.data || data.data.length === 0) return [];

    // Collect all unique URLs from reply entities
    const replyLinks = new Set();
    for (const reply of data.data) {
      const urls = (reply.entities?.urls || [])
        .filter(
          (u) =>
            !u.expanded_url.includes("twitter.com") &&
            !u.expanded_url.includes("x.com") &&
            !u.expanded_url.includes("t.co"),
        )
        .map((u) => u.expanded_url);
      urls.forEach((u) => replyLinks.add(u));
    }

    logger.info(
      `[TweetAPI] Found ${replyLinks.size} unique links across ${data.data.length} replies`,
    );
    return Array.from(replyLinks);
  } catch (err) {
    logger.warn(`[TweetAPI] Reply link mining failed: ${err.message}`);
    return [];
  }
}

/**
 * Extract all URLs from a raw text string (tweet body fallback)
 */
export function extractUrlsFromText(text) {
  const matches = text.match(URL_REGEX) || [];
  // Clean up trailing punctuation that gets caught
  return [...new Set(matches.map((u) => u.replace(/[.,;:!?)\]"']+$/, "")))];
}

/**
 * Classify a URL into a source type StudyPod understands
 */
export function classifyUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");

    if (host === "github.com") return "github";
    if (host === "youtube.com" || host === "youtu.be") return "youtube";
    if (host === "reddit.com") return "reddit";
    if (host === "arxiv.org") return "arxiv";
    if (host === "medium.com" || u.pathname.includes("/p/")) return "article";
    if (host === "substack.com" || u.hostname.includes(".substack.com"))
      return "article";
    if (host === "twitter.com" || host === "x.com") return "tweet";
    return "website";
  } catch {
    return "website";
  }
}

/**
 * Main entry point: Extract everything from a tweet URL.
 *
 * Returns:
 * {
 *   tweetId, tweetUrl,
 *   text, author, authorUrl,
 *   bodyLinks: string[],    // links found in the tweet text itself
 *   replyLinks: string[],   // links found in reply/comment threads
 *   allLinks: string[],     // deduplicated union
 *   classifiedLinks: { url, type }[]
 * }
 */
export async function extractTweet(tweetUrl) {
  logger.info(`[TweetExtraction] Processing: ${tweetUrl}`);

  const tweetId = parseTweetId(tweetUrl);
  if (!tweetId) {
    throw new Error(`Could not parse tweet ID from URL: ${tweetUrl}`);
  }

  let tweetText = "";
  let author = "Unknown";
  let authorUrl = "";
  let entityUrls = [];

  // Try Twitter API v2 first (richer entity URLs), fall back to oEmbed
  const apiResult = await fetchViaTweetAPI(tweetId);
  if (apiResult) {
    tweetText = apiResult.text;
    author = apiResult.author;
    entityUrls = apiResult.entityUrls;
    logger.info(
      `[TweetExtraction] Got tweet via API v2: "${tweetText.substring(0, 80)}..."`,
    );
  } else {
    const oembedResult = await fetchViaOEmbed(tweetUrl);
    tweetText = oembedResult.text;
    author = oembedResult.author;
    authorUrl = oembedResult.authorUrl;
    logger.info(
      `[TweetExtraction] Got tweet via oEmbed: "${tweetText.substring(0, 80)}..."`,
    );
  }

  // Extract URLs from tweet body text (catches t.co expanded links too)
  const textUrls = extractUrlsFromText(tweetText);

  // Combine entity URLs (from API) with text-extracted URLs, deduplicate
  const bodyLinks = [...new Set([...entityUrls, ...textUrls])].filter(
    (u) => !u.includes("twitter.com") && !u.includes("x.com"),
  );

  // Mine reply threads for links (only with Bearer Token)
  const replyLinks = await fetchReplyLinks(tweetId);

  // Final deduplication across all sources
  const allLinks = [...new Set([...bodyLinks, ...replyLinks])];

  const classifiedLinks = allLinks.map((url) => ({
    url,
    type: classifyUrl(url),
  }));

  logger.info(
    `[TweetExtraction] Complete: ${bodyLinks.length} body links, ${replyLinks.length} reply links`,
  );

  return {
    tweetId,
    tweetUrl,
    text: tweetText,
    author,
    authorUrl,
    bodyLinks,
    replyLinks,
    allLinks,
    classifiedLinks,
  };
}

/**
 * Parse a Twitter bookmarks export JSON file.
 * Twitter data archive format: bookmark-0.js / bookmarks.json
 * Returns array of tweet URLs.
 */
export function parseTwitterBookmarksExport(fileContent) {
  try {
    let data;

    // Handle the JS-wrapped format: window.YTD.bookmarks.part0 = [...]
    const jsMatch = fileContent.match(/=\s*(\[[\s\S]+\])/);
    if (jsMatch) {
      data = JSON.parse(jsMatch[1]);
    } else {
      data = JSON.parse(fileContent);
    }

    // Extract tweet URLs from the archive format
    const urls = [];

    const extractFromItem = (item) => {
      const tweetId = item?.tweet?.id_str || item?.tweetId || item?.id;
      const username =
        item?.tweet?.user?.screen_name || item?.user?.screen_name || "unknown";
      const text =
        item?.tweet?.full_text || item?.tweet?.text || item?.text || "";
      const author =
        item?.tweet?.user?.name ||
        item?.user?.name ||
        (username !== "unknown" ? `@${username}` : "Unknown");

      if (tweetId) {
        urls.push({
          url: `https://x.com/${username}/status/${tweetId}`,
          text: text.trim(),
          author: author.trim(),
        });
      }
    };

    if (Array.isArray(data)) {
      data.forEach((item) => {
        if (item?.tweet) {
          extractFromItem(item);
        } else if (item?.bookmarkTimeline?.instructions) {
          // Alternative export format
          const instructions = item.bookmarkTimeline.instructions;
          instructions.forEach((inst) => {
            (inst?.entries || []).forEach((entry) => {
              const tweetResult =
                entry?.content?.itemContent?.tweet_results?.result?.tweet ||
                entry?.content?.itemContent?.tweet_results?.result;
              const id = tweetResult?.rest_id;
              const screenName =
                tweetResult?.core?.user_results?.result?.legacy?.screen_name;
              const text =
                tweetResult?.legacy?.full_text ||
                tweetResult?.legacy?.text ||
                "";
              const author =
                tweetResult?.core?.user_results?.result?.legacy?.name ||
                (screenName ? `@${screenName}` : "Unknown");
              if (id && screenName) {
                urls.push({
                  url: `https://x.com/${screenName}/status/${id}`,
                  text: text.trim(),
                  author: author.trim(),
                });
              }
            });
          });
        } else {
          extractFromItem(item);
        }
      });
    }

    // Deduplicate by url
    const seen = new Set();
    const uniqueUrls = urls.filter((item) => {
      if (!item.url || seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    });

    logger.info(
      `[BookmarkParser] Parsed ${uniqueUrls.length} unique tweet bookmarks from archive`,
    );
    return uniqueUrls;
  } catch (err) {
    throw new Error(`Failed to parse Twitter bookmarks export: ${err.message}`);
  }
}

export default { extractTweet, parseTwitterBookmarksExport, classifyUrl };
