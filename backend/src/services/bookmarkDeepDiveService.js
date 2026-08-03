/**
 * Bookmark Deep-Dive Service
 *
 * Given a list of tweet URLs, this service:
 *  1. Extracts each tweet (text, links in body, links in replies)
 *  2. Classifies every discovered link (GitHub, YouTube, article, Reddit, etc.)
 *  3. Crawls those links using the existing extractionService pipeline
 *  4. Creates notebook sources for each discovered resource
 *  5. Fires signal hook generation for the root tweet and its discovered sources
 *  6. Generates a "Research Trail" note summarising what was found
 *
 * This is the core of the "bookmark as a research seed" concept.
 */

import { v4 as uuidv4 } from 'uuid';
import { extractTweet, classifyUrl, extractUrlsFromText, parseTweetId } from './tweetExtractionService.js';
import { extractWebSource } from './extractionService.js';
import { dbHelpers } from '../db/database.js';
import { MemoryService } from './memoryService.js';
import { generateSovereignHooks } from './outreachService.js';
import { WebhookDispatcher } from './webhookDispatcher.js';
import { logger } from '../utils/logger.js';

// Maximum number of sub-links to crawl per tweet to avoid runaway costs
const MAX_LINKS_PER_TWEET = 8;
// Minimum content length to bother creating a source
const MIN_CONTENT_LENGTH = 200;

/**
 * Process a single tweet URL or pre-parsed object:
 *  - Extract tweet text + all links
 *  - Create a `tweet` type source in the notebook
 *  - Crawl up to MAX_LINKS_PER_TWEET discovered links
 *  - Return summary of what was found
 */
async function processSingleTweet(tweetInput, notebookId, userId) {
  const tweetUrl = typeof tweetInput === 'string' ? tweetInput : tweetInput.url;
  const result = {
    tweetUrl,
    tweetSourceId: null,
    discoveredSources: [],
    errors: []
  };

  // ── 1. Extract the tweet ─────────────────────────────────────────────────
  let tweetData;
  if (tweetInput && typeof tweetInput === 'object' && tweetInput.text && tweetInput.author) {
    logger.info(`[DeepDive] Using pre-parsed tweet data for ${tweetUrl}`);
    const bodyLinks = extractUrlsFromText(tweetInput.text).filter(
      u => !u.includes('twitter.com') && !u.includes('x.com')
    );
    const classifiedLinks = bodyLinks.map(url => ({
      url,
      type: classifyUrl(url)
    }));
    tweetData = {
      tweetId: parseTweetId(tweetUrl),
      tweetUrl,
      text: tweetInput.text,
      author: tweetInput.author,
      authorUrl: '',
      bodyLinks,
      replyLinks: [], // No replies inside the local JSON file
      allLinks: bodyLinks,
      classifiedLinks
    };
  } else {
    try {
      tweetData = await extractTweet(tweetUrl);
    } catch (err) {
      logger.error(`[DeepDive] Failed to extract tweet ${tweetUrl}: ${err.message}`);
      result.errors.push(`Tweet extraction failed: ${err.message}`);
      return result;
    }
  }

  // ── 2. Create the tweet source ────────────────────────────────────────────
  const tweetSourceId = uuidv4();
  const tweetContent = [
    `**Author:** ${tweetData.author}`,
    `**URL:** ${tweetData.tweetUrl}`,
    `**Tweet:**\n${tweetData.text}`,
    tweetData.bodyLinks.length > 0
      ? `\n**Links in tweet:**\n${tweetData.bodyLinks.map(l => `- ${l}`).join('\n')}`
      : '',
    tweetData.replyLinks.length > 0
      ? `\n**Links found in replies/comments:**\n${tweetData.replyLinks.map(l => `- ${l}`).join('\n')}`
      : ''
  ].filter(Boolean).join('\n\n');

  // Let's create a beautiful, descriptive title for the tweet source
  let cleanText = tweetData.text || '';
  cleanText = cleanText.replace(/https?:\/\/[^\s]+/g, '').trim();
  cleanText = cleanText.replace(/\s+/g, ' ');
  const textSnippet = cleanText.length > 50 ? cleanText.substring(0, 50) + '...' : cleanText;
  const sourceTitle = textSnippet.length > 0 
    ? `Tweet: ${tweetData.author} - "${textSnippet}"` 
    : `Tweet by ${tweetData.author}`;

  try {
    await dbHelpers.createSource(
      tweetSourceId,
      notebookId,
      userId,
      sourceTitle,
      'tweet',
      tweetContent,
      tweetData.tweetUrl,
      JSON.stringify({
        author: tweetData.author,
        tweetId: tweetData.tweetId,
        bodyLinks: tweetData.bodyLinks,
        replyLinks: tweetData.replyLinks,
        allLinks: tweetData.allLinks,
        classifiedLinks: tweetData.classifiedLinks
      })
    );

    await dbHelpers.updateSource(tweetSourceId, userId, { processing_status: 'completed' });
    result.tweetSourceId = tweetSourceId;
    result.author = tweetData.author;
    result.text = tweetData.text; // Store for renaming use
    logger.info(`[DeepDive] Tweet source created: ${tweetSourceId}`);
  } catch (err) {
    logger.error(`[DeepDive] Failed to create tweet source: ${err.message}`);
    result.errors.push(`Source creation failed: ${err.message}`);
    return result;
  }

  // Store tweet in memory for semantic search
  MemoryService.storeMemory(userId, notebookId, tweetContent, {
    source: 'tweet_import',
    actor: tweetData.author,
    sourceId: tweetSourceId
  }).catch(e => logger.warn(`[DeepDive] Memory store failed: ${e.message}`));

  // ── 3. Crawl discovered links (prioritise by type: GitHub > article > Reddit > website) ──
  const linksToProcess = tweetData.classifiedLinks
    .filter(l => l.type !== 'tweet') // don't recurse into tweets
    .slice(0, MAX_LINKS_PER_TWEET);

  logger.info(`[DeepDive] Processing ${linksToProcess.length} discovered links for tweet ${tweetData.tweetId}`);

  for (const link of linksToProcess) {
    const linkSourceId = uuidv4();
    try {
      // Mark as pending immediately
      await dbHelpers.createSource(
        linkSourceId,
        notebookId,
        userId,
        link.url, // title will be updated after extraction
        link.type === 'youtube' ? 'youtube' : 'website',
        null,
        link.url,
        JSON.stringify({
          discoveredFrom: tweetData.tweetUrl,
          discoveredFromAuthor: tweetData.author,
          linkType: link.type,
          sourceNote: `Discovered from bookmark: "${tweetData.text.substring(0, 100)}..."`
        })
      );

      // Extract the content using the full extraction pipeline
      logger.info(`[DeepDive] Extracting ${link.type} source: ${link.url}`);
      const extracted = await extractWebSource(link.url);

      if (!extracted.content || extracted.content.length < MIN_CONTENT_LENGTH) {
        await dbHelpers.updateSource(linkSourceId, userId, { processing_status: 'failed' });
        result.errors.push(`Thin content at ${link.url} (${extracted.content?.length || 0} chars)`);
        continue;
      }

      // Update source with real content and title
      await dbHelpers.updateSource(linkSourceId, userId, {
        title: extracted.title || link.url,
        content: extracted.content,
        processing_status: 'completed',
        metadata: JSON.stringify({
          ...extracted.metadata,
          discoveredFrom: tweetData.tweetUrl,
          discoveredFromAuthor: tweetData.author,
          linkType: link.type
        })
      });

      // Store in memory
      MemoryService.storeMemory(userId, notebookId, extracted.content.substring(0, 3000), {
        source: 'bookmark_deep_dive',
        sourceId: linkSourceId,
        linkType: link.type
      }).catch(e => logger.warn(`[DeepDive] Memory store failed for ${link.url}: ${e.message}`));

      result.discoveredSources.push({
        id: linkSourceId,
        url: link.url,
        type: link.type,
        title: extracted.title
      });

      logger.info(`[DeepDive] ✓ Extracted ${link.type} source: "${extracted.title?.substring(0, 60)}"`);
    } catch (err) {
      logger.warn(`[DeepDive] Failed to extract ${link.url}: ${err.message}`);
      // Mark the pre-created source as failed
      await dbHelpers.updateSource(linkSourceId, userId, { processing_status: 'failed' }).catch(() => {});
      result.errors.push(`${link.url}: ${err.message}`);
    }
  }

  let noteId = null;
  // ── 4. Generate Research Trail note ──────────────────────────────────────
  try {
    const trailNote = generateResearchTrailNote(tweetData, result.discoveredSources);
    noteId = uuidv4();
    await dbHelpers.createNote(noteId, notebookId, userId, trailNote, userId);
    logger.info(`[DeepDive] Research trail note created: ${noteId}`);
  } catch (err) {
    logger.warn(`[DeepDive] Research trail note failed: ${err.message}`);
  }

  // ── 5. Fire signal hooks for the tweet (async, non-blocking) ─────────────
  if (tweetContent.length > 100) {
    generateSovereignHooks(tweetContent, `Bookmark: ${tweetData.author}`).then(async (hooks) => {
      // Persist to signal_queue
      try {
        if (hooks.linkedin) {
          await dbHelpers.createSignalQueueItem(
            uuidv4(), userId, notebookId, 'linkedin', hooks.linkedin,
            null, result.tweetSourceId, null, noteId
          );
        }
        if (hooks.twitter) {
          await dbHelpers.createSignalQueueItem(
            uuidv4(), userId, notebookId, 'twitter', hooks.twitter,
            null, result.tweetSourceId, null, noteId
          );
        }
        if (hooks.reddit) {
          await dbHelpers.createSignalQueueItem(
            uuidv4(), userId, notebookId, 'reddit', hooks.reddit,
            null, result.tweetSourceId, null, noteId
          );
        }
      } catch (err) {
        logger.warn(`[DeepDive] Failed to persist signal hooks to queue: ${err.message}`);
      }
      logger.info(`[DeepDive] Signal hooks generated for tweet by ${tweetData.author}`);
      await WebhookDispatcher.recordActivityAndNotify(
        notebookId, userId, 'system', 'bookmark.deep_dive',
        `Deep-dive complete: ${tweetData.tweetUrl.substring(0, 80)}`
      );
    }).catch(e => logger.warn(`[DeepDive] Signal hook generation failed: ${e.message}`));
  }

  return result;
}

/**
 * Generate a markdown "Research Trail" note for a processed bookmark
 */
function generateResearchTrailNote(tweetData, discoveredSources) {
  const lines = [
    `# 🔖 Research Trail: Bookmark by ${tweetData.author}`,
    ``,
    `**Source tweet:** ${tweetData.tweetUrl}`,
    `**Author:** ${tweetData.author}`,
    ``,
    `## Tweet`,
    tweetData.text,
    ``,
  ];

  if (discoveredSources.length > 0) {
    lines.push(`## Discovered Sources (${discoveredSources.length})`);
    lines.push(`*These were found linked in the tweet or its replies and have been added as sources:*`);
    lines.push('');
    for (const src of discoveredSources) {
      const typeIcon = {
        github: '⚙️',
        youtube: '▶️',
        reddit: '💬',
        arxiv: '📄',
        article: '📰',
        website: '🌐'
      }[src.type] || '🔗';
      lines.push(`${typeIcon} **${src.title || src.url}** — [${src.type}](${src.url})`);
    }
    lines.push('');
  }

  if (tweetData.replyLinks.length > 0) {
    lines.push(`## Links Found in Replies (${tweetData.replyLinks.length})`);
    lines.push(`*Links shared in the discussion thread — crawled and added above:*`);
    tweetData.replyLinks.slice(0, 10).forEach(l => lines.push(`- ${l}`));
    lines.push('');
  }

  lines.push(`---`);
  lines.push(`*Research trail generated by StudyPod Bookmark Deep-Dive at ${new Date().toISOString()}*`);

  return lines.join('\n');
}

/**
 * Main public API: Process multiple tweet URLs in sequence.
 * Returns a summary of all processing results.
 *
 * @param {string[]} tweetUrls - Array of tweet URLs
 * @param {string} notebookId
 * @param {string} userId
 * @returns {Promise<{ processed: number, totalSources: number, errors: string[], results: object[] }>}
 */
export async function deepDiveBookmarks(tweetUrls, notebookId, userId) {
  logger.info(`[DeepDive] Starting deep-dive for ${tweetUrls.length} bookmark(s)`);

  const results = [];
  let totalSources = 0;
  const allErrors = [];

  // Process sequentially to avoid hammering APIs
  for (const url of tweetUrls) {
    const result = await processSingleTweet(url, notebookId, userId);
    results.push(result);
    totalSources += result.discoveredSources.length + (result.tweetSourceId ? 1 : 0);
    allErrors.push(...result.errors);
  }

  logger.info(`[DeepDive] Complete: ${results.length} tweets, ${totalSources} total sources created`);

  // Notebook Rename Logic (If generic name)
  try {
    const successfulTweets = results.filter(r => r.tweetSourceId && r.author);
    if (successfulTweets.length > 0) {
      const firstTweet = successfulTweets[0];
      const notebook = await dbHelpers.getNotebookById(notebookId, userId);
      const isGeneric = !notebook || 
        notebook.title === 'Untitled notebook' || 
        notebook.title === 'Untitled Notebook' || 
        notebook.title === 'Recovered Notebook' ||
        notebook.title === 'Auto-provisioned' ||
        notebook.title.startsWith('Automatically provisioned');

      if (isGeneric) {
        let cleanText = firstTweet.text || '';
        cleanText = cleanText.replace(/https?:\/\/[^\s]+/g, '').trim();
        cleanText = cleanText.replace(/\s+/g, ' ');

        let title = `Research: ${firstTweet.author}`;
        if (cleanText.length > 0) {
          const snippet = cleanText.length > 40 ? cleanText.substring(0, 40) + '...' : cleanText;
          title = `${firstTweet.author}: "${snippet}"`;
        }

        const description = `Automatically organized from bookmarks. Starting seed: "${cleanText.substring(0, 200)}${cleanText.length > 200 ? '...' : ''}"`;

        await dbHelpers.updateNotebook(notebookId, userId, {
          title,
          description
        });
        logger.info(`[DeepDive] Auto-renamed generic notebook ${notebookId} to "${title}"`);
      }
    }
  } catch (err) {
    logger.warn(`[DeepDive] Auto-renaming notebook failed: ${err.message}`);
  }

  // Closed Loop: broker newly created sources against active research goals
  const newlyCreatedSourceIds = [];
  for (const r of results) {
    if (r.tweetSourceId) newlyCreatedSourceIds.push(r.tweetSourceId);
    r.discoveredSources.forEach(s => newlyCreatedSourceIds.push(s.id));
  }

  if (newlyCreatedSourceIds.length > 0) {
    import('./goalBrokerService.js')
      .then(({ brokerResearchGoals }) => {
        brokerResearchGoals(notebookId, userId, newlyCreatedSourceIds)
          .then(brokerResult => {
            if (brokerResult) {
              logger.info(`[DeepDive] Goal broker synthesis complete: noteId=${brokerResult.noteId}, tasks=${brokerResult.tasksCount}, signals=${brokerResult.signalsCount}`);
            }
          })
          .catch(err => logger.error(`[DeepDive] Goal broker synthesis failed: ${err.message}`));
      })
      .catch(err => logger.error(`[DeepDive] Failed to load goal broker service: ${err.message}`));
  }

  return {
    processed: results.filter(r => r.tweetSourceId).length,
    totalSources,
    errors: allErrors,
    results
  };
}

export default { deepDiveBookmarks };
