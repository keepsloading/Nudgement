/**
 * Nudgement — background service worker
 * Handles: analysis queue, 7-day result cache, history persistence,
 *          nudge profile aggregation, optional backend routing.
 *
 * Preserved from original hackathon build (Boundier/IIT Bombay).
 * Changes: renamed globals, added history persistence, get_history /
 *          get_nudge_profile / clear_history message handlers,
 *          async processQueue with optional backend fallback.
 */
importScripts('scorer.js');

const { ENGINE_VERSION, DIMENSION_KEYS, scoreContent } = self.NudgementScorer;

const CACHE_TTL_MS   = 7 * 24 * 60 * 60 * 1000;  // 7 days
const HISTORY_MAX    = 500;                         // FIFO cap
const HISTORY_KEY    = 'nudge_history';
const HISTORY_DAYS   = 7;
const BACKEND_URL_KEY = 'nudgement_backend_url';   // optional: url of the api-server

const requestQueue = [];
let isProcessing = false;

// ─── Badge helpers ────────────────────────────────────────────────────────────
function getBadgeColor(score) {
  if (score <= 35) return '#10B981';  // green
  if (score <= 65) return '#F59E0B';  // amber
  return '#EF4444';                   // red
}

function setBadge(text, color, tabId) {
  if (!tabId) return;
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab) return;
    const score = Number(text);
    if (!Number.isFinite(score)) {
      chrome.action.setBadgeText({ text: '', tabId });
      return;
    }
    chrome.action.setBadgeBackgroundColor({ color, tabId });
    chrome.action.setBadgeText({ text: String(score), tabId });
  });
}

function updateBadge(result, tabId) {
  const score = Number(result?.nudgemeter_score);
  if (Number.isFinite(score)) {
    setBadge(score, getBadgeColor(score), tabId);
  } else {
    setBadge('', '#9ca3af', tabId);
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function cleanText(value) { return (value || '').replace(/\s+/g, ' ').trim(); }
function formatHost(host) { return cleanText(host || '').replace(/^www\./, '') || 'This page'; }

function normalizeIncomingMessage(msg) {
  return {
    headline:   cleanText(msg.headline),
    byline:     cleanText(msg.byline),
    snippet:    cleanText(msg.snippet),
    url:        msg.url || '',
    host:       msg.host || '',
    site_name:  cleanText(msg.site_name),
    page_title: cleanText(msg.page_title),
    surface:    msg.surface || 'page',
    word_count: msg.word_count || 0,
    hash:       msg.hash
  };
}

// ─── History helpers ──────────────────────────────────────────────────────────
function appendHistory(result, content) {
  const entry = {
    timestamp:        Date.now(),
    url:              content.url,
    domain:           content.host,
    surface:          content.surface,
    title:            result.page_title || result.site_name || content.host,
    nudge_profile:    result.nudge_profile || {},
    nudgemeter_score: result.nudgemeter_score
  };

  chrome.storage.local.get([HISTORY_KEY], (items) => {
    const history = Array.isArray(items[HISTORY_KEY]) ? items[HISTORY_KEY] : [];
    history.push(entry);
    const trimmed = history.length > HISTORY_MAX ? history.slice(history.length - HISTORY_MAX) : history;
    chrome.storage.local.set({ [HISTORY_KEY]: trimmed });
  });
}

function aggregateProfile(history, days = HISTORY_DAYS) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const recent = history.filter(e => e.timestamp >= cutoff);
  if (!recent.length) return { entryCount: 0, days };

  const sums = Object.fromEntries(DIMENSION_KEYS.map(k => [k, 0]));
  for (const entry of recent) {
    for (const k of DIMENSION_KEYS) {
      sums[k] += (entry.nudge_profile?.[k] || 0);
    }
  }
  const averages = Object.fromEntries(DIMENSION_KEYS.map(k => [k, Math.round(sums[k] / recent.length)]));
  return { ...averages, entryCount: recent.length, days };
}

// ─── Optional backend call ────────────────────────────────────────────────────
/**
 * Try to score content via the configured api-server backend.
 * Returns null if the backend is unreachable, returns an invalid result,
 * or times out — the caller falls back to local scoring.
 */
async function tryBackend(content, backendUrl) {
  try {
    const url = backendUrl.replace(/\/$/, '') + '/api/analyze';
    const response = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(content),
      signal:  AbortSignal.timeout(4000)
    });
    if (!response.ok) return null;
    const result = await response.json();
    // Validate the response has at minimum a numeric score
    if (!Number.isFinite(Number(result?.nudgemeter_score))) return null;
    return result;
  } catch {
    return null;
  }
}

// ─── Analysis queue processor ─────────────────────────────────────────────────
async function processQueueItem({ msg, tabId, sendResponse, requestId }) {
  const content = normalizeIncomingMessage(msg);

  if (!content.hash || (!content.headline && !content.snippet)) {
    setBadge('', '#9ca3af', tabId);
    sendResponse({ error: 'Missing required fields: hash and text', request_id: requestId });
    return;
  }

  const cacheKey = `analysis:${content.hash}`;

  // Read cache and backend URL together
  const storageItems = await chrome.storage.local.get([cacheKey, BACKEND_URL_KEY]);
  const cached     = storageItems[cacheKey];
  const backendUrl = (storageItems[BACKEND_URL_KEY] || '').trim();

  // Return cache hit if fresh and from the current engine version
  if (cached && cached.engine_version === ENGINE_VERSION && (Date.now() - cached.cached_at) < CACHE_TTL_MS) {
    const result = { ...cached, request_id: requestId };
    updateBadge(result, tabId);
    sendResponse(result);
    return;
  }

  // Try backend if a URL is configured; fall back to local scoring
  let result = backendUrl ? await tryBackend(content, backendUrl) : null;
  if (!result) {
    result = scoreContent(
      { ...content, site_name: content.site_name || formatHost(content.host) },
      requestId
    );
  } else {
    result.request_id = requestId;
    result.source = result.source || 'backend';
  }

  await chrome.storage.local.set({ [cacheKey]: { ...result, cached_at: Date.now() } });
  updateBadge(result, tabId);
  appendHistory(result, content);   // fire-and-forget
  sendResponse(result);
}

async function processQueue() {
  if (isProcessing || requestQueue.length === 0) return;
  isProcessing = true;
  try {
    await processQueueItem(requestQueue.shift());
  } catch (err) {
    console.error('Nudgement: processQueue error:', err);
  } finally {
    isProcessing = false;
    processQueue();
  }
}

// ─── Message router ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // Trigger a new analysis
  if (msg.action === 'analyze') {
    requestQueue.push({ msg, tabId: sender.tab?.id, sendResponse, requestId: crypto.randomUUID() });
    processQueue();
    return true;
  }

  // Return a cached analysis result by hash
  if (msg.action === 'get_analysis') {
    const hash = msg.hash;
    if (!hash) { sendResponse({ error: 'Missing hash.' }); return false; }
    const cacheKey = `analysis:${hash}`;
    chrome.storage.local.get([cacheKey], (items) => sendResponse({ result: items[cacheKey] || null }));
    return true;
  }

  // Return raw history array
  if (msg.action === 'get_history') {
    chrome.storage.local.get([HISTORY_KEY], (items) => {
      sendResponse({ history: items[HISTORY_KEY] || [] });
    });
    return true;
  }

  // Return aggregated 7-day nudge profile
  if (msg.action === 'get_nudge_profile') {
    const days = msg.days || HISTORY_DAYS;
    chrome.storage.local.get([HISTORY_KEY], (items) => {
      const history = items[HISTORY_KEY] || [];
      sendResponse({ profile: aggregateProfile(history, days) });
    });
    return true;
  }

  // Clear all history
  if (msg.action === 'clear_history') {
    chrome.storage.local.remove([HISTORY_KEY], () => sendResponse({ ok: true }));
    return true;
  }

  // Configure backend URL (empty string to disable)
  if (msg.action === 'set_backend_url') {
    const url = (msg.url || '').trim();
    chrome.storage.local.set({ [BACKEND_URL_KEY]: url }, () => sendResponse({ ok: true, url }));
    return true;
  }

  // Return currently configured backend URL
  if (msg.action === 'get_backend_url') {
    chrome.storage.local.get([BACKEND_URL_KEY], (items) => {
      sendResponse({ url: items[BACKEND_URL_KEY] || '' });
    });
    return true;
  }
});
