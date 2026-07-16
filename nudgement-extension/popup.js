/**
 * Nudgement — popup script
 * Renders: Nudgemeter (current page), 7-day history, signal list, explanations.
 */
document.addEventListener('DOMContentLoaded', () => {

  // ─── DOM refs ──────────────────────────────────────────────────────────────
  const $loading          = document.getElementById('loading');
  const $content          = document.getElementById('content');
  const $errorState       = document.getElementById('error-state');
  const $errorMsg         = document.getElementById('error-msg');
  const $reloadBtn        = document.getElementById('reload-btn');
  const $pageSurface      = document.getElementById('page-surface');
  const $pageName         = document.getElementById('page-name');
  const $nudgemeterLabel  = document.getElementById('nudgemeter-score-label');
  const $dimensionBars    = document.getElementById('dimension-bars');
  const $nudgeSummary     = document.getElementById('nudge-summary');
  const $historyCount     = document.getElementById('history-count');
  const $dayDots          = document.getElementById('day-dots');
  const $historySummary   = document.getElementById('history-summary');
  const $signalList       = document.getElementById('signal-list');
  const $explanations     = document.getElementById('explanations');

  // ─── Dimension config ──────────────────────────────────────────────────────
  const DIMENSIONS = [
    { key: 'outrage',       label: 'Outrage',       color: '#EF4444' },
    { key: 'politics',      label: 'Politics',      color: '#60A5FA' },
    { key: 'health',        label: 'Health',         color: '#34D399' },
    { key: 'finance',       label: 'Finance',        color: '#FBBF24' },
    { key: 'consumerism',   label: 'Consumerism',   color: '#F472B6' },
    { key: 'ai_tech',       label: 'AI & Tech',      color: '#A78BFA' },
    { key: 'productivity',  label: 'Productivity',  color: '#22D3EE' },
    { key: 'entertainment', label: 'Entertainment', color: '#FB923C' }
  ];

  const SURFACE_LABELS = {
    article: 'Article',
    video:   'Video',
    social:  'Social',
    page:    'Page'
  };

  const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // ─── Helpers ───────────────────────────────────────────────────────────────
  function clamp(v, min = 0, max = 100) { return Math.max(min, Math.min(max, v)); }

  function nudgemeterLabel(score) {
    if (score <= 15) return 'Very low nudge activity';
    if (score <= 35) return 'Low nudge activity';
    if (score <= 55) return 'Moderate nudge activity';
    if (score <= 75) return 'Notable nudge activity';
    return 'High nudge activity';
  }

  function topDimensions(profile, n = 3) {
    if (!profile) return [];
    return DIMENSIONS
      .map(d => ({ ...d, score: profile[d.key] || 0 }))
      .filter(d => d.score > 10)
      .sort((a, b) => b.score - a.score)
      .slice(0, n);
  }

  function buildNudgeSummary(profile, nudgemeterScore) {
    const top = topDimensions(profile, 3);
    if (!top.length || nudgemeterScore <= 12) {
      return 'This page shows very few nudge patterns — relatively neutral content.';
    }
    const names = top.map(d => d.label);
    if (names.length === 1) return `This page leans heavily toward ${names[0]} content.`;
    if (names.length === 2) return `This page leans toward ${names[0]} and ${names[1]} content.`;
    return `This page leans toward ${names[0]}, ${names[1]}, and ${names[2]} content.`;
  }

  function buildHistorySummary(profile) {
    if (!profile || profile.entryCount === 0) return null;
    const top = topDimensions(profile, 2);
    if (!top.length) return 'Your recent content is fairly balanced across dimensions.';
    if (top.length === 1) return `Your recent content has leaned toward ${top[0].label} this week.`;
    return `Your recent content has leaned toward ${top[0].label} and ${top[1].label} this week.`;
  }

  function getDominantDimension(entry) {
    if (!entry?.nudge_profile) return null;
    let best = null, bestScore = 0;
    for (const d of DIMENSIONS) {
      const s = entry.nudge_profile[d.key] || 0;
      if (s > bestScore) { bestScore = s; best = d; }
    }
    return bestScore > 10 ? best : null;
  }

  function clearNode(node) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  // ─── State management ──────────────────────────────────────────────────────
  function showLoading() {
    $loading.style.display = 'flex';
    $content.hidden = true;
    $errorState.hidden = true;
  }

  function showError(message) {
    $loading.style.display = 'none';
    $content.hidden = true;
    $errorState.hidden = false;
    $errorMsg.textContent = message;
  }

  function showContent() {
    $loading.style.display = 'none';
    $content.hidden = false;
    $errorState.hidden = true;
  }

  // ─── Renderers ─────────────────────────────────────────────────────────────
  function renderNudgemeter(result) {
    const profile = result.nudge_profile || {};
    const score   = result.nudgemeter_score ?? 0;
    const top     = topDimensions(profile, 1)[0];

    // Header label
    $nudgemeterLabel.textContent = nudgemeterLabel(score);

    // Dimension bars — sorted by score descending
    clearNode($dimensionBars);
    const sorted = DIMENSIONS
      .map(d => ({ ...d, score: clamp(profile[d.key] || 0) }))
      .sort((a, b) => b.score - a.score);

    for (const dim of sorted) {
      const row = document.createElement('div');
      row.className = 'dim-row';

      const label = document.createElement('span');
      label.className = 'dim-label';
      label.textContent = dim.label;

      const track = document.createElement('div');
      track.className = 'dim-track';

      const fill = document.createElement('div');
      fill.className = `dim-fill ${dim.key}`;
      fill.style.width = `${dim.score}%`;

      const value = document.createElement('span');
      value.className = 'dim-value' + (dim.score > 30 ? ' active' : '');
      value.textContent = dim.score;

      track.appendChild(fill);
      row.appendChild(label);
      row.appendChild(track);
      row.appendChild(value);
      $dimensionBars.appendChild(row);
    }

    // Summary sentence
    $nudgeSummary.textContent = buildNudgeSummary(profile, score);
  }

  function render7DayDots(history) {
    clearNode($dayDots);

    // Build a map of date string → [entries]
    const today = new Date();
    const dayMap = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = d.toDateString();
      dayMap[key] = { date: d, entries: [] };
    }
    for (const entry of history) {
      const key = new Date(entry.timestamp).toDateString();
      if (dayMap[key]) dayMap[key].entries.push(entry);
    }

    let totalEntries = 0;
    for (const [, day] of Object.entries(dayMap)) {
      totalEntries += day.entries.length;
      const isToday = day.date.toDateString() === today.toDateString();

      const dot = document.createElement('div');
      dot.className = 'day-dot' + (isToday ? ' today' : '');

      const circle = document.createElement('div');
      circle.className = 'day-dot-circle';

      if (day.entries.length > 0) {
        // Find the dominant dimension across all entries for this day
        const dimScores = {};
        for (const entry of day.entries) {
          if (!entry.nudge_profile) continue;
          for (const d of DIMENSIONS) {
            dimScores[d.key] = (dimScores[d.key] || 0) + (entry.nudge_profile[d.key] || 0);
          }
        }
        let bestKey = null, bestScore = 0;
        for (const [k, v] of Object.entries(dimScores)) {
          if (v > bestScore) { bestScore = v; bestKey = k; }
        }
        const dimDef = DIMENSIONS.find(d => d.key === bestKey);
        if (dimDef && bestScore > 0) {
          circle.classList.add('has-data');
          circle.style.background = dimDef.color + '33'; // 20% opacity
          circle.style.borderColor = dimDef.color;
          // Small count badge
          circle.title = `${day.entries.length} page${day.entries.length > 1 ? 's' : ''}: ${dimDef.label}`;
        }
      }

      const label = document.createElement('span');
      label.className = 'day-dot-label';
      label.textContent = isToday ? 'Today' : DAYS_SHORT[day.date.getDay()];

      dot.appendChild(circle);
      dot.appendChild(label);
      $dayDots.appendChild(dot);
    }

    return totalEntries;
  }

  function renderHistorySection(weekProfile, history) {
    const entryCount = render7DayDots(history);
    $historyCount.textContent = entryCount > 0 ? `${entryCount} page${entryCount > 1 ? 's' : ''} this week` : '';

    const summary = buildHistorySummary(weekProfile);
    if (summary) {
      $historySummary.textContent = summary;
      $historySummary.className = 'history-summary';
    } else {
      $historySummary.textContent = 'Browse more pages to see your weekly pattern here.';
      $historySummary.className = 'no-history';
    }
  }

  function renderSignals(signals = [], explanations = []) {
    clearNode($signalList);
    clearNode($explanations);

    const cleanSignals = signals.filter(s => s && s.signal !== 'No strong nudge signal found' && s.category !== 'baseline');

    if (!cleanSignals.length) {
      const empty = document.createElement('p');
      empty.className = 'no-signals';
      empty.textContent = 'No strong nudge signals detected on this page.';
      $signalList.appendChild(empty);
    } else {
      for (const item of cleanSignals.slice(0, 4)) {
        const el = document.createElement('div');
        el.className = 'signal-item';

        const top = document.createElement('div');
        top.className = 'signal-top';

        const phrase = document.createElement('span');
        phrase.className = 'signal-phrase';
        phrase.textContent = `"${item.signal}"`;

        const tag = document.createElement('span');
        tag.className = 'signal-tag';
        tag.textContent = (item.category || '').split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');

        const reason = document.createElement('p');
        reason.className = 'signal-reason';
        reason.textContent = item.reason || '';

        top.appendChild(phrase);
        top.appendChild(tag);
        el.appendChild(top);
        el.appendChild(reason);
        $signalList.appendChild(el);
      }
    }

    // Explanations
    for (const text of (explanations || []).slice(0, 3)) {
      const p = document.createElement('p');
      p.className = 'explanation-item';
      p.textContent = text;
      $explanations.appendChild(p);
    }
  }

  function renderResult(result, weekProfile, history) {
    // Page bar
    $pageSurface.textContent = SURFACE_LABELS[result.content_type] || SURFACE_LABELS[result.surface] || 'Page';
    $pageName.textContent = result.site_name || result.host || '';

    renderNudgemeter(result);
    renderHistorySection(weekProfile, history);
    renderSignals(result.top_signals, result.explanations);

    showContent();
  }

  // ─── Extension communication ───────────────────────────────────────────────
  function canInjectIntoTab(tab) {
    return /^https?:\/\//.test(tab.url || '') || /^file:\/\//.test(tab.url || '');
  }

  function friendlyError(message) {
    if (/receiving end does not exist|could not establish connection/i.test(message || '')) {
      return 'Could not reach this tab. Try clicking "Re-analyse" or refreshing the page.';
    }
    if (/cannot access|chrome:|edge:|extension|webstore|permissions/i.test(message || '')) {
      return 'Nudgement works on regular web pages — open a news site, YouTube, or Reddit and try again.';
    }
    return message || 'Analysis failed.';
  }

  function injectContentScript(tab, callback) {
    if (!chrome.scripting || !canInjectIntoTab(tab)) {
      callback(new Error('Nudgement works on regular web pages — open a news site, YouTube, or Reddit and try again.'));
      return;
    }
    chrome.scripting.executeScript(
      { target: { tabId: tab.id }, files: ['Readability.js', 'extractor.js', 'content.js'] },
      () => {
        if (chrome.runtime.lastError) { callback(new Error(friendlyError(chrome.runtime.lastError.message))); return; }
        callback();
      }
    );
  }

  function normalizeResponse(response) {
    if (!response) return null;
    return response.result || response;
  }

  function requestAnalysis(tab, clearCache, didInject, callback) {
    chrome.tabs.sendMessage(tab.id, { action: 'get_analysis', clearCache }, (response) => {
      const lastError = chrome.runtime.lastError;
      const message = lastError?.message || '';

      if (lastError) {
        if (!didInject && /receiving end does not exist|could not establish connection/i.test(message)) {
          injectContentScript(tab, (injectError) => {
            if (injectError) { callback(injectError); return; }
            requestAnalysis(tab, clearCache, true, callback);
          });
          return;
        }
        callback(new Error(friendlyError(message)));
        return;
      }

      if (!response) { callback(new Error('Analysis failed.')); return; }
      if (response.error) { callback(new Error(friendlyError(response.error))); return; }

      const result = normalizeResponse(response);
      const score = Number(result?.nudgemeter_score);
      if (!Number.isFinite(score)) { callback(new Error('Received an invalid result. Try re-analysing.')); return; }

      callback(null, result);
    });
  }

  function fetchHistory(callback) {
    chrome.runtime.sendMessage({ action: 'get_history' }, (response) => {
      callback(response?.history || []);
    });
  }

  function fetchWeekProfile(callback) {
    chrome.runtime.sendMessage({ action: 'get_nudge_profile', days: 7 }, (response) => {
      callback(response?.profile || null);
    });
  }

  // ─── Main analysis flow ────────────────────────────────────────────────────
  function runAnalysis(clearCache = false) {
    showLoading();

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) { showError('No active tab found.'); return; }

      // Fire analysis and history fetches; render when both are ready
      let analysisResult = null;
      let weekProfile    = null;
      let historyData    = null;
      let analysisError  = null;
      let pending        = 3;

      function tryRender() {
        pending--;
        if (pending > 0) return;
        if (analysisError) { showError(analysisError.message); return; }
        renderResult(analysisResult, weekProfile, historyData);
      }

      requestAnalysis(tabs[0], clearCache, false, (err, result) => {
        if (err) { analysisError = err; }
        else { analysisResult = result; }
        tryRender();
      });

      fetchWeekProfile((profile) => { weekProfile = profile; tryRender(); });
      fetchHistory((history) => { historyData = history; tryRender(); });
    });
  }

  // ─── Init ──────────────────────────────────────────────────────────────────
  runAnalysis();
  $reloadBtn.addEventListener('click', () => runAnalysis(true));
});
