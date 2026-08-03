import fetch from "node-fetch";
import * as cheerio from "cheerio";
import { logger } from "../utils/logger.js";
import { assertSafeExternalHttpsUrl } from "../utils/externalUrlSafety.js";

// Cheerio keeps the serverless extraction pass lightweight and ESM-compatible.

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
];

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_SAFE_REDIRECTS = 4;

export async function fetchPublicUrl(url, options, fetchImpl = fetch) {
  let currentUrl = await assertSafeExternalHttpsUrl(url);

  for (let redirectCount = 0; redirectCount <= MAX_SAFE_REDIRECTS; redirectCount += 1) {
    const response = await fetchImpl(currentUrl, { ...options, redirect: "manual" });
    if (!REDIRECT_STATUSES.has(response.status)) return response;

    const location = response.headers.get("location");
    if (!location) return response;
    response.body?.destroy?.();
    if (redirectCount === MAX_SAFE_REDIRECTS) {
      throw new Error("External URL exceeded the redirect limit.");
    }

    currentUrl = await assertSafeExternalHttpsUrl(
      new URL(location, currentUrl).toString(),
    );
  }

  throw new Error("External URL could not be fetched safely.");
}

/**
 * Metadata extractor via Cheerio
 */
function extractMeta($) {
  return {
    title: $("title").text() || $("h1").first().text() || "Untitled",
    description:
      $('meta[name="description"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      "",
    author: $('meta[name="author"]').attr("content") || "Unknown",
  };
}

/**
 * Phase 1: Cheerio. Fast, static HTML extraction.
 */
async function extractWithCheerio(url) {
  const isReddit = url.includes("reddit.com");

  // Use a stable identity and broadly compatible response formats.
  const headers = {
    "User-Agent": USER_AGENTS[0],
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  };

  const response = await fetchPublicUrl(url, {
    headers,
    timeout: 15000,
  });

  if (!response.ok) {
    if (isReddit && response.status === 403) {
      throw new Error(
        "Reddit blocked standard extraction. Try Firecrawl fallback.",
      );
    }
    throw new Error(`HTTP ${response.status}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  // Clean up bloat
  $(
    "script, style, iframe, noscript, footer, nav, aside, .ad, .ads, #header, #footer",
  ).remove();

  // Transform to structural markdown (Simple conversion)
  $("h1, h2, h3").each((i, el) => {
    const level = el.tagName.substring(1);
    $(el).replaceWith(`\n\n${"#".repeat(level)} ${$(el).text().trim()}\n\n`);
  });

  $("p").each((i, el) => {
    $(el).replaceWith(`\n${$(el).text().trim()}\n`);
  });

  $("li").each((i, el) => {
    $(el).replaceWith(`\n- ${$(el).text().trim()}`);
  });

  // Reddit-specific content targeting (shrd:post-body etc)
  let content = isReddit
    ? $("shreddit-post, .post-content, #content").text()
    : $("article, main, body").text();

  if (!content || content.length < 200) {
    content = $("body").text();
  }

  // Cleanup whitespace but preserve structure
  content = content
    .replace(/\n\s*\n/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
  const meta = extractMeta($);

  // Only reject failure phrases in suspiciously short responses.
  const isLikelySystemError =
    content.length < 300 &&
    (content.toLowerCase().includes("access denied") ||
      content.toLowerCase().includes("pardon our interruption") ||
      content.toLowerCase().includes("bot detection") ||
      content.toLowerCase().includes("failed to fetch") ||
      content.toLowerCase().includes("403 forbidden"));

  if (isLikelySystemError)
    throw new Error(
      "Systemic extraction failure: Site blocked or denied access.",
    );
  if (content.length < 50) throw new Error("Insufficient content extracted.");

  return {
    content,
    title: meta.title,
    metadata: { ...meta, method: "cheerio-dynamic-porter" },
  };
}

/**
 * Phase 2 (ULTRA): Jina Reader. Handles JS/SPA rendering without an API key.
 */
async function extractWithJina(url) {
  const jinaUrl = `https://r.jina.ai/${url}`;
  logger.info(
    `[Extraction] Attempting Jina Reader fallback for: ${new URL(url).hostname}`,
  );

  const response = await fetch(jinaUrl, {
    method: "GET",
    headers: {
      Accept: "text/plain",
      "X-No-Cache": "true",
    },
    timeout: 30000, // Jina can take a moment to render
  });

  if (!response.ok) {
    throw new Error(`Jina Reader failed: ${response.status}`);
  }

  const markdown = await response.text();

  if (!markdown || markdown.length < 100) {
    throw new Error("Jina Reader returned insufficient content.");
  }

  // Jina returns "Title: ..." as the first line often
  const firstLine = markdown.split("\n")[0] || "";
  const titleMatch = firstLine.match(/^#?\s*(.+)$/);
  const title = titleMatch ? titleMatch[1].replace("Title: ", "").trim() : url;

  return {
    content: markdown,
    title: title,
    metadata: { method: "jina-reader-high-fidelity", author: "Jina AI" },
  };
}

/**
 * Phase 3: Direct Firecrawl API call.
 */
async function extractWithFirecrawl(url) {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error("Firecrawl API Key missing.");

  const response = await fetch("https://api.firecrawl.dev/v0/scrape", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ url }),
  });

  const json = await response.json();
  if (!json.success) throw new Error(json.error || "Firecrawl failed");

  return {
    content: json.data?.markdown || json.data?.content || "",
    title: json.data?.metadata?.title || url,
    metadata: { method: "firecrawl-api-v0" },
  };
}

/**
 * Deep recursive extraction for GitHub repositories
 */
async function extractGitHubRepo(url) {
  const urlObj = new URL(url);
  const pathParts = urlObj.pathname.split("/").filter(Boolean);
  if (pathParts.length < 2) {
    throw new Error("Invalid GitHub repository URL.");
  }
  const owner = pathParts[0];
  const repo = pathParts[1].replace(/\.git$/, "");

  logger.info(`[GitHub Extractor] owner: ${owner}, repo: ${repo}`);

  let branch = "main";
  if (pathParts[2] === "tree" && pathParts[3]) {
    branch = pathParts.slice(3).join("/");
  } else {
    try {
      const apiResponse = await fetch(
        `https://api.github.com/repos/${owner}/${repo}`,
        {
          headers: { "User-Agent": "StudyPodLM-Agent" },
          timeout: 5000,
        },
      );
      if (apiResponse.ok) {
        const repoData = await apiResponse.json();
        if (repoData.default_branch) {
          branch = repoData.default_branch;
        }
      }
    } catch (e) {
      logger.warn(
        `[GitHub Extractor] Failed to fetch default branch for ${owner}/${repo}: ${e.message}`,
      );
    }
  }

  logger.info(`[GitHub Extractor] Using branch: ${branch}`);

  let treeData;
  try {
    const treeResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
      {
        headers: { "User-Agent": "StudyPodLM-Agent" },
        timeout: 10000,
      },
    );
    if (!treeResponse.ok) {
      if (branch === "main" && !urlObj.pathname.includes("/tree/")) {
        logger.info(
          `[GitHub Extractor] Failed with branch 'main', trying 'master'...`,
        );
        const altTreeResponse = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/git/trees/master?recursive=1`,
          {
            headers: { "User-Agent": "StudyPodLM-Agent" },
            timeout: 10000,
          },
        );
        if (altTreeResponse.ok) {
          branch = "master";
          treeData = await altTreeResponse.json();
        }
      }
      if (!treeData) {
        throw new Error(
          `Failed to fetch tree from GitHub API: status ${treeResponse.status}`,
        );
      }
    } else {
      treeData = await treeResponse.json();
    }
  } catch (e) {
    logger.warn(
      `[GitHub Extractor] API tree fetch failed: ${e.message}. Using fallback direct files.`,
    );
    treeData = {
      tree: [
        { path: "README.md", type: "blob" },
        { path: "package.json", type: "blob" },
      ],
    };
  }

  const excludedDirs = [
    "node_modules",
    "dist",
    "build",
    ".git",
    ".github",
    ".vercel",
    ".next",
    "bin",
    "obj",
    "out",
  ];
  const excludedFiles = [
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "bun.lockb",
  ];
  const allowedExtensions = [
    ".js",
    ".ts",
    ".tsx",
    ".jsx",
    ".json",
    ".md",
    ".txt",
    ".py",
    ".go",
    ".java",
    ".cpp",
    ".c",
    ".h",
    ".cs",
    ".rs",
    ".css",
    ".html",
    ".yaml",
    ".yml",
    ".toml",
    ".sh",
  ];

  const filesToFetch = [];
  if (treeData && treeData.tree) {
    for (const item of treeData.tree) {
      if (item.type !== "blob") continue;

      const pathLower = item.path.toLowerCase();
      if (excludedDirs.some((dir) => item.path.split("/").includes(dir)))
        continue;
      if (excludedFiles.some((file) => pathLower.endsWith(file))) continue;

      const ext = item.path.substring(item.path.lastIndexOf("."));
      if (
        !allowedExtensions.includes(ext.toLowerCase()) &&
        !pathLower.endsWith("readme")
      ) {
        continue;
      }

      if (item.size && item.size > 200000) {
        continue;
      }

      filesToFetch.push(item.path);
    }
  }

  filesToFetch.sort((a, b) => {
    const aLower = a.toLowerCase();
    const bLower = b.toLowerCase();
    if (aLower.includes("readme")) return -1;
    if (bLower.includes("readme")) return 1;
    if (aLower.includes("package.json")) return -1;
    if (bLower.includes("package.json")) return 1;
    if (aLower.startsWith("src/") && !bLower.startsWith("src/")) return -1;
    if (bLower.startsWith("src/") && !aLower.startsWith("src/")) return 1;
    return a.localeCompare(b);
  });

  const selectedFiles = filesToFetch.slice(0, 40);

  if (selectedFiles.length === 0) {
    throw new Error("No readable text files found in the repository.");
  }

  logger.info(
    `[GitHub Extractor] Fetching contents of ${selectedFiles.length} files...`,
  );

  let consolidatedContent = `# GitHub Repository: ${owner}/${repo}\n`;
  consolidatedContent += `Branch: ${branch}\n`;
  consolidatedContent += `Total Files Extracted: ${selectedFiles.length}\n\n`;

  const fetchPromises = selectedFiles.map(async (filePath) => {
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
    try {
      const fileRes = await fetch(rawUrl, { timeout: 8000 });
      if (fileRes.ok) {
        const text = await fileRes.text();
        const extension = filePath.substring(filePath.lastIndexOf(".") + 1);
        let codeBlockType = extension;
        if (["ts", "tsx", "js", "jsx"].includes(extension))
          codeBlockType = "typescript";
        else if (extension === "md") codeBlockType = "markdown";

        return `\n## File: ${filePath}\n\n\`\`\`${codeBlockType}\n${text}\n\`\`\`\n`;
      } else {
        return `\n## File: ${filePath} (Failed to fetch, status: ${fileRes.status})\n`;
      }
    } catch (err) {
      return `\n## File: ${filePath} (Error: ${err.message})\n`;
    }
  });

  const fileContents = await Promise.all(fetchPromises);
  consolidatedContent += fileContents.join("\n");

  return {
    content: consolidatedContent,
    title: `${owner}/${repo}`,
    metadata: {
      method: "github-repo-extractor",
      author: owner,
      description: `Extracted repository: ${owner}/${repo} containing ${selectedFiles.length} files.`,
      branch,
    },
  };
}

export async function extractWebSource(url) {
  url = await assertSafeExternalHttpsUrl(url);
  const logHost = new URL(url).hostname;
  const isGitHubRepo =
    url.includes("github.com") &&
    !url.includes("/raw/") &&
    !url.includes("/blob/") &&
    !url.includes("/releases/");
  if (isGitHubRepo) {
    logger.info(
      `[Extraction] GitHub repository detected on ${logHost}. Initiating deep extraction...`,
    );
    try {
      return await extractGitHubRepo(url);
    } catch (err) {
      logger.error(
        `[Extraction] GitHub deep extraction failed: ${err.message}. Falling back to standard extraction.`,
      );
    }
  }

  try {
    return await extractWithCheerio(url);
  } catch (err) {
    logger.warn(
      `[Extraction] Cheerio failed for ${logHost}, trying Jina Reader...`,
    );
    try {
      return await extractWithJina(url);
    } catch (err2) {
      logger.warn(`[Extraction] Jina Reader failed, checking Firecrawl...`);
      try {
        return await extractWithFirecrawl(url);
      } catch (err3) {
        throw new Error("Extraction exhausted across all layers.");
      }
    }
  }
}

export default { extractWebSource };
