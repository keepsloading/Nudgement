const MAX_SNIPPET_WORDS = 650;
const AUTO_ANALYZE_DEBOUNCE_MS = 1800;
const MIN_AUTO_TEXT_CHARS = 24;

let analysisTimeout = null;
let lastAutoHash = null;

function cleanText(value) {
  return (value || '')
    .replace(/\s+/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
}

function truncateWords(text, limit = MAX_SNIPPET_WORDS) {
  return cleanText(text).split(' ').filter(Boolean).slice(0, limit).join(' ');
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
  const title = cleanText(document.title);
  return cleanText(h1 || metaTitle || title);
}

function getByline() {
  const author = getMetaContent([
    'meta[name="author"]',
    'meta[property="article:author"]',
    'meta[name="parsely-author"]'
  ]);
  const published = getMetaContent([
    'meta[property="article:published_time"]',
    'meta[name="pubdate"]',
    'meta[name="date"]',
    'time[datetime]'
  ]);

  return [author, published].filter(Boolean).join(' - ');
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
    word_count: primaryText ? primaryText.split(/\s+/).length : 0,
    text_length: primaryText.length
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
  if (content.headline.length >= MIN_AUTO_TEXT_CHARS) return true;
  if (forceFull && content.snippet.length >= MIN_AUTO_TEXT_CHARS) return true;
  return content.snippet.length >= 80;
}

async function buildPayload(full = false) {
  const content = extractContent(full);

  if (!hasEnoughContent(content, full)) {
    return { error: 'not enough content' };
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
    const payload = await buildPayload(full);
    if (payload.error) {
      console.log('Boundier skipped analysis:', payload.error);
      return;
    }

    if (payload.hash === lastAutoHash && !full) {
      return;
    }

    lastAutoHash = payload.hash;
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
      sendResponse({ error: payload.error });
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
