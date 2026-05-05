const ENGINE_VERSION = 'local-rules-1.1';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const requestQueue = [];
let isProcessing = false;

const SIGNALS = [
  {
    category: 'clickbait',
    weight: 18,
    reason: 'Curiosity-gap phrasing withholds the key information.',
    pattern: /\b(you won't believe|you will not believe|what happens next|what happened next|this is why|the reason why|the truth about|things you need to know|before you|everyone is talking about)\b/gi
  },
  {
    category: 'clickbait',
    weight: 15,
    reason: 'Reveal-style wording pushes curiosity before substance.',
    pattern: /\b(shocking|shocked|revealed|exposed|secret|hidden|jaw-dropping|mind-blowing|finally discovered|went viral)\b/gi
  },
  {
    category: 'false_urgency',
    weight: 14,
    reason: 'Urgency language pressures quick reaction.',
    pattern: /\b(breaking|urgent|act now|right now|immediately|before it's too late|before it is too late|last chance|don't miss|do not miss|must see)\b/gi
  },
  {
    category: 'fear_appeal',
    weight: 13,
    reason: 'Fear framing emphasizes threat or danger.',
    pattern: /\b(warning|dangerous|threat|crisis|disaster|nightmare|collapse|chaos|catastrophe|deadly|risk|panic)\b/gi
  },
  {
    category: 'outrage_amplification',
    weight: 13,
    reason: 'Outrage framing primes anger before evidence.',
    pattern: /\b(furious|outraged|rage|backlash|slammed|blasted|destroyed|humiliated|meltdown|scandal|betrayed)\b/gi
  },
  {
    category: 'polarization',
    weight: 14,
    reason: 'Us-vs-them wording increases tribal framing.',
    pattern: /\b(us vs them|real americans|anti-national|traitors|enemies of the people|the elites|mainstream media|corrupt media|woke mob|leftists|right-wingers)\b/gi
  },
  {
    category: 'loaded_language',
    weight: 12,
    reason: 'Coercive wording pushes guilt, shame, or forced agreement.',
    pattern: /\b(if you care|share this if|only idiots|wake up|open your eyes|they don't want you to know|they do not want you to know|you are being lied to)\b/gi
  },
  {
    category: 'certainty_inflation',
    weight: 10,
    reason: 'Absolute certainty can flatten nuance.',
    pattern: /\b(always|never|everyone knows|nobody talks about|proves|proof that|undeniable|guaranteed|without question|no doubt)\b/gi
  },
  {
    category: 'source_obscurity',
    weight: 9,
    reason: 'Vague attribution weakens verifiability.',
    pattern: /\b(experts say|sources say|people are saying|some say|many believe|it is believed|reportedly|allegedly|rumor has it)\b/gi
  },
  {
    category: 'engagement_bait',
    weight: 10,
    reason: 'Engagement bait asks for interaction instead of understanding.',
    pattern: /\b(like and share|share before|comment below|tag someone|subscribe now|watch till the end|watch until the end)\b/gi
  }
];

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function cleanText(value) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function tokenize(text) {
  return cleanText(text).match(/\b[\w'-]+\b/g) || [];
}

function getColor(score) {
  if (score <= 35) return '#12A150';
  if (score <= 65) return '#F59E0B';
  return '#DC2626';
}

function setBadge(text, color, tabId) {
  if (!tabId) return;

  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab) {
      return;
    }

    chrome.action.setBadgeBackgroundColor({ color, tabId });
    chrome.action.setBadgeText({ text: String(text), tabId });
  });
}

function addScore(scores, category, amount) {
  scores[category] = (scores[category] || 0) + amount;
}

function collectMatches(content) {
  const headline = cleanText(content.headline);
  const body = cleanText([content.byline, content.snippet].filter(Boolean).join(' '));
  const allText = cleanText([headline, body].filter(Boolean).join(' '));
  const scores = {
    attention_capture: 0,
    clickbait: 0,
    emotional_pressure: 0,
    fear_appeal: 0,
    outrage_amplification: 0,
    false_urgency: 0,
    loaded_language: 0,
    enemy_construction: 0,
    polarization: 0,
    certainty_inflation: 0,
    source_obscurity: 0,
    social_proof_pressure: 0,
    engagement_bait: 0,
    call_to_action_pressure: 0
  };
  const evidence = [];

  SIGNALS.forEach((signal) => {
    const scopes = [
      { name: 'headline', text: headline, multiplier: 1.45 },
      { name: 'body', text: body, multiplier: 1 }
    ];

    scopes.forEach((scope) => {
      signal.pattern.lastIndex = 0;
      let match;
      while ((match = signal.pattern.exec(scope.text)) !== null) {
        const phrase = cleanText(match[0]);
        const amount = signal.weight * scope.multiplier;
        addScore(scores, signal.category, amount);
        evidence.push({
          phrase,
          reason: signal.reason,
          category: signal.category,
          weight: amount,
          location: scope.name
        });
      }
    });
  });

  const exclamationCount = (allText.match(/!/g) || []).length;
  const questionCount = (allText.match(/\?/g) || []).length;
  const capsWords = (allText.match(/\b[A-Z]{3,}\b/g) || []).length;
  const sensationalPunctuation = Math.min(18, exclamationCount * 4 + Math.max(0, questionCount - 1) * 2);
  const capsPressure = Math.min(16, capsWords * 3);

  if (sensationalPunctuation > 0) {
    addScore(scores, 'clickbait', sensationalPunctuation);
    addScore(scores, 'false_urgency', sensationalPunctuation * 0.6);
    evidence.push({
      phrase: exclamationCount ? 'Exclamation-heavy phrasing' : 'Question-heavy phrasing',
      reason: 'Punctuation increases emotional pressure.',
      category: 'clickbait',
      weight: sensationalPunctuation,
      location: 'style'
    });
  }

  if (capsPressure > 0) {
    addScore(scores, 'false_urgency', capsPressure);
    addScore(scores, 'loaded_language', capsPressure * 0.5);
    evidence.push({
      phrase: 'All-caps emphasis',
      reason: 'Capitalized words can simulate shouting or urgency.',
      category: 'false_urgency',
      weight: capsPressure,
      location: 'style'
    });
  }

  return { scores, evidence, allText };
}

function normalizeBucket(raw, wordCount) {
  const lengthFactor = Math.max(1.15, Math.log10(Math.max(wordCount, 15)));
  return clamp(Math.round((raw * 5.8) / lengthFactor));
}

function scoreContent(content, requestId) {
  const { scores, evidence, allText } = collectMatches(content);
  const wordCount = Math.max(content.word_count || tokenize(allText).length, 1);

  const normalized = Object.fromEntries(
    Object.entries(scores).map(([key, raw]) => [key, normalizeBucket(raw, wordCount)])
  );

  const attentionScore = clamp(Math.round(
    normalized.attention_capture * 0.24 +
    normalized.clickbait * 0.28 +
    normalized.false_urgency * 0.22 +
    normalized.engagement_bait * 0.16 +
    normalized.call_to_action_pressure * 0.10
  ));

  const emotionScore = clamp(Math.round(
    normalized.emotional_pressure * 0.26 +
    normalized.fear_appeal * 0.24 +
    normalized.outrage_amplification * 0.24 +
    normalized.loaded_language * 0.16 +
    normalized.social_proof_pressure * 0.10
  ));

  const framingScore = clamp(Math.round(
    normalized.enemy_construction * 0.28 +
    normalized.polarization * 0.24 +
    normalized.loaded_language * 0.20 +
    normalized.certainty_inflation * 0.18 +
    normalized.outrage_amplification * 0.10
  ));

  const sourceScore = clamp(Math.round(
    normalized.source_obscurity * 0.42 +
    normalized.certainty_inflation * 0.24 +
    normalized.social_proof_pressure * 0.18 +
    normalized.call_to_action_pressure * 0.16
  ));

  const rustmeterScore = clamp(Math.round(
    attentionScore * 0.29 +
    emotionScore * 0.27 +
    framingScore * 0.26 +
    sourceScore * 0.18
  ));

  const sortedEvidence = evidence
    .sort((a, b) => b.weight - a.weight)
    .filter((item, index, arr) => {
      const phrase = item.phrase.toLowerCase();
      return arr.findIndex((other) => other.phrase.toLowerCase() === phrase) === index;
    });

  const topSignals = sortedEvidence.slice(0, 5).map((item) => ({
    signal: item.phrase,
    reason: item.reason,
    category: item.category
  }));

  while (topSignals.length < 3) {
    topSignals.push({
      signal: 'No strong influence signal found',
      reason: 'The local scorer did not find enough high-confidence signals.',
      category: 'baseline'
    });
  }

  const activeTactics = Object.entries(normalized)
    .filter(([, value]) => value >= 28)
    .sort((a, b) => b[1] - a[1])
    .map(([category]) => category);

  const uncertainty = clamp(18 - Math.min(10, sortedEvidence.length * 2) + (wordCount < 40 ? 5 : 0), 6, 22);
  const low = clamp(rustmeterScore - uncertainty);
  const high = clamp(rustmeterScore + uncertainty);

  return {
    attention_score: attentionScore,
    emotion_score: emotionScore,
    framing_score: framingScore,
    source_score: sourceScore,
    rustmeter_score: rustmeterScore,
    aim_score: rustmeterScore,
    confidence_interval: `${low}-${high}`,
    top_signals: topSignals.slice(0, 5),
    top_phrases: topSignals.slice(0, 5),
    explanations: buildExplanations(rustmeterScore, activeTactics, content.surface, wordCount),
    category_scores: normalized,
    tactics: activeTactics,
    content_type: content.surface || 'page',
    site_name: content.site_name || formatHost(content.host),
    page_title: content.page_title || content.headline || '',
    host: content.host || '',
    word_count: wordCount,
    source: 'local_rules',
    engine_version: ENGINE_VERSION,
    request_id: requestId
  };
}

function buildExplanations(rustmeterScore, tactics, surface, wordCount) {
  const severity = rustmeterScore >= 70 ? 'High' : rustmeterScore >= 40 ? 'Moderate' : 'Low';
  const mainTactics = tactics.length ? tactics.slice(0, 3).join(', ') : 'few clear pressure tactics';

  return [
    `${severity} Rustmeter influence pressure based on local scoring of ${surface || 'page'} content.`,
    `Primary signals: ${mainTactics}.`,
    `Analyzed ${wordCount} words without external AI calls.`
  ];
}

function formatHost(host) {
  return cleanText(host || '').replace(/^www\./, '') || 'This page';
}

function normalizeIncomingMessage(msg) {
  return {
    headline: cleanText(msg.headline),
    byline: cleanText(msg.byline),
    snippet: cleanText(msg.snippet),
    url: msg.url || '',
    host: msg.host || '',
    site_name: cleanText(msg.site_name),
    page_title: cleanText(msg.page_title),
    surface: msg.surface || 'page',
    word_count: msg.word_count || 0,
    hash: msg.hash,
    fast: Boolean(msg.fast)
  };
}

async function processQueue() {
  if (isProcessing || requestQueue.length === 0) return;
  isProcessing = true;

  const { msg, tabId, sendResponse, requestId } = requestQueue.shift();
  const content = normalizeIncomingMessage(msg);

  if (!content.hash || (!content.headline && !content.snippet)) {
    setBadge('ERR', '#6B7280', tabId);
    sendResponse({ error: 'invalid request', requestId });
    isProcessing = false;
    processQueue();
    return;
  }

  setBadge('...', '#6B7280', tabId);

  chrome.storage.local.get([content.hash], (data) => {
    const cached = data[content.hash];
    const cacheIsFresh = cached &&
      cached.timestamp &&
      Date.now() - cached.timestamp < CACHE_TTL_MS &&
      cached.version === ENGINE_VERSION;

    if (cacheIsFresh) {
      setBadge(cached.result.aim_score, getColor(cached.result.aim_score), tabId);
      sendResponse({ fromCache: true, result: cached.result, requestId });
      isProcessing = false;
      processQueue();
      return;
    }

    const result = scoreContent(content, requestId);
    chrome.storage.local.set({
      [content.hash]: {
        version: ENGINE_VERSION,
        result,
        timestamp: Date.now()
      }
    });

    setBadge(result.aim_score, getColor(result.aim_score), tabId);
    sendResponse({ success: true, result, requestId });
    isProcessing = false;
    processQueue();
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action !== 'analyze') return false;

  const tabId = sender.tab ? sender.tab.id : null;
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  requestQueue.push({ msg, tabId, sendResponse, requestId });
  processQueue();
  return true;
});
