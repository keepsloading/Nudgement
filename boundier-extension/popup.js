document.addEventListener('DOMContentLoaded', () => {
  const loading = document.getElementById('loading');
  const content = document.getElementById('content');
  const error = document.getElementById('error');
  const reloadBtn = document.getElementById('reload-btn');

  function scoreColor(score) {
    if (score <= 35) return '#12A150';
    if (score <= 65) return '#F59E0B';
    return '#DC2626';
  }

  function riskLabel(score) {
    if (score <= 35) return 'Low pressure';
    if (score <= 65) return 'Moderate pressure';
    return 'High pressure';
  }

  function setText(id, value) {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  }

  function clearNode(node) {
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  function showError(message) {
    loading.style.display = 'none';
    content.style.display = 'none';
    error.textContent = message;
    error.style.display = 'block';
  }

  function canInjectIntoTab(tab) {
    return /^https?:\/\//.test(tab.url || '') || /^file:\/\//.test(tab.url || '');
  }

  function friendlyTabError(message) {
    if (/receiving end does not exist|could not establish connection/i.test(message || '')) {
      return 'Boundier was not attached to this tab yet. Reload analysis to attach it, or refresh the page once after updating the extension.';
    }

    if (/cannot access|chrome:|edge:|extension|webstore|permissions/i.test(message || '')) {
      return 'Boundier cannot analyze browser, extension, or store pages. Open a normal webpage and try again.';
    }

    return message || 'Analysis failed.';
  }

  function injectContentScript(tab, callback) {
    if (!chrome.scripting || !canInjectIntoTab(tab)) {
      callback(new Error('Boundier cannot analyze browser, extension, or store pages. Open a normal webpage and try again.'));
      return;
    }

    chrome.scripting.executeScript(
      {
        target: { tabId: tab.id },
        files: ['content.js']
      },
      () => {
        if (chrome.runtime.lastError) {
          callback(new Error(friendlyTabError(chrome.runtime.lastError.message)));
          return;
        }

        callback();
      }
    );
  }

  function requestAnalysis(tab, clearCache, didInject, callback) {
    chrome.tabs.sendMessage(tab.id, { action: 'get_analysis', clearCache }, (response) => {
      const lastError = chrome.runtime.lastError;
      const message = lastError?.message || '';

      if (lastError) {
        if (!didInject && /receiving end does not exist|could not establish connection/i.test(message)) {
          injectContentScript(tab, (injectError) => {
            if (injectError) {
              callback(injectError);
              return;
            }

            requestAnalysis(tab, clearCache, true, callback);
          });
          return;
        }

        callback(new Error(friendlyTabError(message)));
        return;
      }

      if (!response || response.error) {
        callback(new Error(friendlyTabError(response?.error || 'Analysis failed.')));
        return;
      }

      callback(null, response.result);
    });
  }

  function renderCategoryBars(scores = {}) {
    const container = document.getElementById('category-bars');
    clearNode(container);

    const preferredOrder = [
      'clickbait',
      'urgency',
      'fear',
      'outrage',
      'polarization',
      'manipulation',
      'certainty',
      'credibility',
      'attention'
    ];

    preferredOrder.forEach((key) => {
      if (typeof scores[key] !== 'number') return;

      const row = document.createElement('div');
      row.className = 'bar-row';

      const label = document.createElement('span');
      label.className = 'bar-label';
      label.textContent = key.replace('-', ' ');

      const track = document.createElement('div');
      track.className = 'bar-track';

      const fill = document.createElement('div');
      fill.className = 'bar-fill';
      fill.style.width = `${Math.max(0, Math.min(100, scores[key]))}%`;
      fill.style.backgroundColor = scoreColor(scores[key]);

      const value = document.createElement('span');
      value.className = 'bar-value';
      value.textContent = scores[key];

      track.appendChild(fill);
      row.appendChild(label);
      row.appendChild(track);
      row.appendChild(value);
      container.appendChild(row);
    });
  }

  function renderSignals(items = []) {
    const list = document.querySelector('#phrases ul');
    clearNode(list);

    items.forEach((item) => {
      const li = document.createElement('li');

      const topLine = document.createElement('div');
      topLine.className = 'phrase-topline';

      const phrase = document.createElement('div');
      phrase.className = 'phrase';
      phrase.textContent = item.signal || item.phrase || 'Signal';

      const category = document.createElement('span');
      category.className = 'category-tag';
      category.textContent = item.category || 'signal';

      const reason = document.createElement('div');
      reason.className = 'reason';
      reason.textContent = item.reason || '';

      topLine.appendChild(phrase);
      topLine.appendChild(category);
      li.appendChild(topLine);
      li.appendChild(reason);
      list.appendChild(li);
    });
  }

  function renderExplanations(items = []) {
    const list = document.querySelector('#explanations ul');
    clearNode(list);

    items.forEach((text) => {
      const li = document.createElement('li');
      li.textContent = text;
      list.appendChild(li);
    });
  }

  function renderResult(result) {
    const score = Number(result.rustmeter_score ?? result.aim_score ?? 0);
    const color = scoreColor(score);
    const pageLabel = result.site_name || result.page_title || result.host || result.content_type || 'This page';

    document.getElementById('score').textContent = score;
    document.getElementById('score').style.backgroundColor = color;
    setText('status', riskLabel(score));
    setText('meta', pageLabel);
    setText('attention-score', result.attention_score ?? result.clickbait_score ?? 0);
    setText('emotion-score', result.emotion_score ?? result.affect_score ?? 0);
    setText('framing-score', result.framing_score ?? result.manipulation_score ?? 0);
    setText('source-score', result.source_score ?? result.intent_score ?? 0);

    renderCategoryBars(result.category_scores || {});
    renderSignals(result.top_signals || result.top_phrases || []);
    renderExplanations(result.explanations || []);
  }

  function triggerAnalysis(clearCache = false) {
    loading.style.display = 'block';
    content.style.display = 'none';
    error.style.display = 'none';

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) {
        showError('No active tab found.');
        return;
      }

      requestAnalysis(tabs[0], clearCache, false, (analysisError, result) => {
        loading.style.display = 'none';

        if (analysisError) {
          showError(analysisError.message);
          return;
        }

        content.style.display = 'block';
        renderResult(result);
      });
    });
  }

  triggerAnalysis();

  reloadBtn.addEventListener('click', () => {
    triggerAnalysis(true);
  });
});
