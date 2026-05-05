const { cleanText, rankReadableCandidates, cleanBodyFallback, words } = self.BoundierExtractor;

const MAX_SNIPPET_WORDS = 650;
const AUTO_ANALYZE_DEBOUNCE_MS = 2500;
const MIN_AUTO_INTERVAL_MS = 20000;

let analysisTimeout = null;
let lastAutoHash = null;
let lastAutoRunAt = 0;

function truncateWords(text, limit = MAX_SNIPPET_WORDS) {
  return words(text).slice(0, limit).join(' ');
}

function textFromSelectors(selectors, limit = 14000) {
  const seen = new Set();
  const chunks = [];

  selectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((node) => {
      if (!node || seen.has(node)) return;
      seen.add(node);

      const text = cleanText(node.innerText || node.textContent);
      if (text.length >= 24) {
        chunks.push(text);
      }
    });
  });

  return truncateWords(chunks.join(' '), limit);
}

function getMetaContent(selectors) {
  for (const selector of selectors) {
    const node = document.querySelector(selector);
    const content = cleanText(node?.getAttribute('content'));
    if (content) return content;
  }
  return '';
}

function getHeadline() {
  const metaTitle = getMetaContent([
    'meta[property="og:title"]',
    'meta[name="twitter:title"]'
  ]);

  const h1 = cleanText(document.querySelector('h1')?.textContent);
  const firstHeading = cleanText(
    Array.from(document.querySelectorAll('h1, h2'))
      .map((node) => cleanText(node.textContent))
      .find((text) => text.length >= 12) || ''
  );
  const bodyFallback = truncateWords(getVisibleBodyText(36), 18);
  const title = cleanText(document.title).replace(/\s+[|\-–—]\s+[^|\-–—]+$/, '');
  return cleanText(metaTitle || h1 || firstHeading || title || bodyFallback);
}

function getByline() {
  const author = getMetaContent([
    'meta[name="author"]',
    'meta[property="article:author"]',
    'meta[name="parsely-author"]'
  ]);
  return cleanText(author);
}

function getSiteName() {
  const siteName = getMetaContent([
    'meta[property="og:site_name"]',
    'meta[name="application-name"]'
  ]);

  return cleanText(siteName || location.hostname.replace(/^www\./, ''));
}

function detectSurface() {
  const host = location.hostname.toLowerCase();
  const path = location.pathname.toLowerCase();
  const ogType = getMetaContent(['meta[property="og:type"]']).toLowerCase();

  if (host.includes('youtube.com') || host.includes('youtu.be')) return 'video';
  if (host.includes('reddit.com')) return 'social';
  if (host.includes('twitter.com') || host.includes('x.com')) return 'social';
  if (host.includes('facebook.com') || host.includes('instagram.com') || host.includes('threads.net')) return 'social';
  if (ogType === 'article' || document.querySelector('article')) return 'article';
  if (path.includes('/blog') || path.includes('/news') || path.includes('/story')) return 'article';
  return 'page';
}

function getArticleText() {
  return textFromSelectors([
    'article p',
    'article li',
    '[itemprop="articleBody"] p',
    '[data-testid="article-body"] p',
    '.article-body p',
    '.story-body p',
    '.post-content p',
    'main p'
  ]);
}

function getSocialText() {
  return textFromSelectors([
    '[data-testid="tweetText"]',
    '[data-testid="post_message"]',
    '[slot="text-body"]',
    '[data-adclicklocation="title"]',
    '[data-click-id="text"]',
    '[data-testid="post-container"]',
    '[role="article"]',
    'shreddit-post',
    'main h1',
    'main h2',
    'main p'
  ], 450);
}

function getVideoText() {
  const metaDescription = getMetaContent([
    'meta[name="description"]',
    'meta[property="og:description"]',
    'meta[name="twitter:description"]'
  ]);

  const pageText = textFromSelectors([
    '#title h1',
    'h1',
    '#description',
    'ytd-watch-metadata',
    'main h1',
    'main p'
  ], 320);

  return truncateWords([metaDescription, pageText].filter(Boolean).join(' '), 320);
}

function getGenericText() {
  const metaDescription = getMetaContent([
    'meta[name="description"]',
    'meta[property="og:description"]',
    'meta[name="twitter:description"]'
  ]);

  const pageText = textFromSelectors([
    'main h1',
    'main h2',
    'main p',
    'article',
    '[role="main"] p',
    'body p'
  ], 500);

  return truncateWords([metaDescription, pageText].filter(Boolean).join(' '), 500);
}

function runReadabilityExtraction() {
  if (!self.Readability) return { attempted: false, success: false };
  try {
    const clone = document.cloneNode(true);
    const article = new self.Readability(clone, { charThreshold: 120, nbTopCandidates: 5 }).parse();
    const text = cleanText(article?.textContent || '');
    return { attempted: true, success: text.length >= 120, article, text };
  } catch (e) {
    return { attempted: true, success: false };
  }
}

function getVisibleBodyText(limit = 700) {
  if (!document.body) return '';

  const ignoredTags = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'CANVAS', 'IFRAME']);
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || ignoredTags.has(parent.tagName)) return NodeFilter.FILTER_REJECT;

      const text = cleanText(node.textContent);
      if (text.length < 24) return NodeFilter.FILTER_REJECT;

      const style = window.getComputedStyle(parent);
      if (style.display === 'none' || style.visibility === 'hidden') {
        return NodeFilter.FILTER_REJECT;
      }

      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const chunks = [];
  const seen = new Set();
  while (walker.nextNode()) {
    const text = cleanText(walker.currentNode.textContent);
    if (text && !seen.has(text)) {
      seen.add(text);
      chunks.push(text);
    }
  }

  const treeWalkerText = truncateWords(chunks.join(' '), limit);
  if (treeWalkerText.length >= 40) {
    return treeWalkerText;
  }

  const bodyInnerText = truncateWords(cleanText(document.body.innerText || ''), limit);
  if (bodyInnerText.length >= treeWalkerText.length) {
    return bodyInnerText;
  }

  return treeWalkerText;
}

function isSupportedSurface(surface) {
  return ['article', 'video', 'social', 'page'].includes(surface);
}

function isUnsupportedPage() {
  const protocol = location.protocol.toLowerCase();
  if (protocol.startsWith('chrome') || protocol.startsWith('edge') || protocol.startsWith('about')) {
    return true;
  }

  const host = location.hostname.toLowerCase();
  return host.includes('chrome.google.com') || host.includes('microsoftedge.microsoft.com');
}

function getFastSnippetLimit(surface) {
  if (surface === 'article') return 360;
  if (surface === 'video') return 180;
  if (surface === 'social') return 120;
  return 180;
}

function extractContent(full = false) {
  const surface = detectSurface();
  const headline = getHeadline();
  const byline = getByline();
  let snippet = '';

  if (surface === 'video') {
    snippet = getVideoText();
  } else if (surface === 'social') {
    snippet = getSocialText();
  } else if (surface === 'article') {
    snippet = getArticleText();
  } else {
    snippet = getGenericText();
  }

  const targeted = snippet;
  const readability = runReadabilityExtraction();
  let strategy = targeted && targeted.length >= 80 ? 'targeted-selectors' : 'none';
  if ((!snippet || snippet.length < 80) && readability.success) {
    snippet = truncateWords(readability.text, surface === 'article' ? 700 : 500);
    strategy = 'mozilla-readability';
  }
  const ranked = rankReadableCandidates(document, { maxWords: surface === 'article' ? 700 : 500 });
  if ((!snippet || snippet.length < 80) && ranked.text.length >= 80) {
    snippet = ranked.text;
    strategy = 'adaptive-ranked-candidates';
  }
  if (!snippet || snippet.length < 80) {
    snippet = cleanBodyFallback(document, surface === 'article' ? 700 : 450);
    strategy = 'clean-body-fallback';
  }

  if (!full) {
    snippet = truncateWords(snippet, getFastSnippetLimit(surface));
  }

  const primaryText = cleanText([headline, byline, snippet].filter(Boolean).join(' '));

  return {
    headline,
    byline,
    snippet,
    url: location.href,
    host: location.hostname,
    site_name: getSiteName(),
    page_title: cleanText(document.title),
    surface,
    word_count: words(primaryText).length,
    text_length: primaryText.length,
    excerpt: cleanText(getMetaContent(['meta[name="description"]','meta[property="og:description"]','meta[name="twitter:description"]']) || readability?.article?.excerpt),
    published_time: cleanText(getMetaContent(['meta[property="article:published_time"]','time[datetime]']) || readability?.article?.publishedTime),
    byline: cleanText(byline || readability?.article?.byline),
    site_name: cleanText(getSiteName() || readability?.article?.siteName),
    extraction_debug: {
      extraction_strategy_used: strategy, readability_attempted: readability.attempted, readability_success: readability.success,
      candidate_count: ranked.candidates.length,
      top_candidate_lengths: ranked.candidates.slice(0,5).map(c=>c.length),
      top_candidate_scores: ranked.candidates.slice(0,5).map(c=>Math.round(c.score)),
      top_candidate_class_or_id: ranked.candidates.slice(0,5).map(c=>c.classOrId),
      article_tag_exists: !!document.querySelector('article'),
      main_tag_exists: !!document.querySelector('main')
    }
  };
}

async function getHash(content) {
  const combined = [
    content.surface,
    content.headline,
    content.byline,
    content.snippet,
    content.url
  ].join('|');

  const encoder = new TextEncoder();
  const data = encoder.encode(combined);

  try {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  } catch (err) {
    console.error('Boundier hash computation failed:', err);
    return '';
  }
}

function hasEnoughContent(content, forceFull = false) {
  const combinedLength = cleanText(`${content.headline} ${content.snippet}`).length;
  if (combinedLength >= 60) return true;
  if (forceFull && content.snippet.length >= 40) return true;
  if (content.headline.length >= 24) return true;
  return false;
}

async function buildPayload(full = false) {
  const content = extractContent(full);

  if (!isSupportedSurface(content.surface) || isUnsupportedPage()) {
    return {
      error: 'Boundier could not extract enough readable page content.',
      debug: { ...content.extraction_debug, url: content.url, host: content.host, surface: content.surface, headline: content.headline, headline_length: content.headline.length, snippet_length: content.snippet.length, text_length: content.text_length, reason: 'insufficient-readable-content' }
    };
  }

  if (!hasEnoughContent(content, full)) {
    return {
      error: 'Boundier could not extract enough readable page content.',
      debug: { ...content.extraction_debug, url: content.url, host: content.host, surface: content.surface, headline: content.headline, headline_length: content.headline.length, snippet_length: content.snippet.length, text_length: content.text_length, reason: 'insufficient-readable-content' }
    };
  }

  const hash = await getHash(content);
  if (!hash) {
    return { error: 'invalid request' };
  }

  return {
    action: 'analyze',
    ...content,
    hash,
    fast: !full
  };
}

async function triggerAnalysis(full = false) {
  if (analysisTimeout) {
    clearTimeout(analysisTimeout);
  }

  analysisTimeout = setTimeout(async () => {
    if (!full && Date.now() - lastAutoRunAt < MIN_AUTO_INTERVAL_MS) return;
    const payload = await buildPayload(full);
    if (payload.error) {
      console.log('Boundier skipped analysis:', payload.error);
      return;
    }

    if (payload.hash === lastAutoHash && !full) {
      return;
    }

    lastAutoHash = payload.hash;
    if (!full) lastAutoRunAt = Date.now();
    chrome.runtime.sendMessage(payload, () => {
      if (chrome.runtime.lastError) {
        console.error('Boundier failed to send analysis message:', chrome.runtime.lastError);
      }
    });
  }, AUTO_ANALYZE_DEBOUNCE_MS);
}

function waitForDOMStable(callback) {
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(callback, 500);
    return;
  }

  document.addEventListener('DOMContentLoaded', () => setTimeout(callback, 500), { once: true });
}

waitForDOMStable(() => triggerAnalysis(false));

const observer = new MutationObserver(() => {
  clearTimeout(observer.timeout);
  observer.timeout = setTimeout(() => triggerAnalysis(false), AUTO_ANALYZE_DEBOUNCE_MS);
});

if (document.body) {
  observer.observe(document.body, { childList: true, subtree: true });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action !== 'get_analysis') return false;

  async function handleAnalysis() {
    const payload = await buildPayload(true);
    if (payload.error) {
      console.warn('Boundier extraction failure (page context):', payload.debug);
      sendResponse({ error: payload.error, debug: payload.debug });
      return;
    }

    if (msg.clearCache) {
      chrome.storage.local.remove([payload.hash]);
    }

    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message || 'analysis failed' });
        return;
      }

      if (!response || response.error) {
        sendResponse({ error: response?.error || 'analysis failed' });
        return;
      }

      sendResponse(response);
    });
  }

  handleAnalysis();
  return true;
});
