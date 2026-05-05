(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BoundierExtractor = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const NEGATIVE_HINT = /(nav|navbar|navigation|header|footer|menu|sidebar|aside|share|social|comment|advert|sponsor|promo|subscribe|sign-?in|login|register|breadcrumb|pagination|related|recommend|widget|newsletter|popup|modal|cookie|consent)/i;
  const POSITIVE_HINT = /(content|article|story|post|body|main|text|entry|liveblog|update|report|news|paragraph|field|item)/i;
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'CANVAS', 'IFRAME']);

  const cleanText = (v) => (v || '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
  const words = (t) => cleanText(t).split(/\s+/).filter(Boolean);

  function isHidden(el, win) {
    if (!el) return true;
    if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return true;
    const style = win.getComputedStyle(el);
    return style.display === 'none' || style.visibility === 'hidden';
  }

  function scoreElement(el, doc, win, h1) {
    if (!el || SKIP_TAGS.has(el.tagName) || isHidden(el, win)) return null;
    const text = cleanText(el.innerText || el.textContent);
    if (text.length < 40) return null;

    const tagWeight = /^(MAIN|ARTICLE|SECTION)$/.test(el.tagName) ? 25 : el.tagName === 'P' ? 10 : 0;
    const textWords = words(text);
    const sentenceCount = (text.match(/[.!?]+\s/g) || []).length;
    const punctCount = (text.match(/[,:;!?\.]/g) || []).length;
    const linksText = cleanText(Array.from(el.querySelectorAll('a')).map((a) => a.innerText || a.textContent).join(' '));
    const linkDensity = linksText.length / Math.max(1, text.length);
    const btnCount = el.querySelectorAll('button,input,select,textarea').length;
    const upperRatio = text ? ((text.match(/[A-Z]/g) || []).length / Math.max(1, (text.match(/[A-Za-z]/g) || []).length)) : 0;
    const classIdPath = [el.id, el.className, el.getAttribute('role'), el.parentElement?.className, el.parentElement?.id].filter(Boolean).join(' ');
    const neg = NEGATIVE_HINT.test(classIdPath) ? 45 : 0;
    const pos = POSITIVE_HINT.test(classIdPath) ? 18 : 0;

    let score = 0;
    score += Math.min(60, textWords.length / 4);
    score += Math.min(30, sentenceCount * 3);
    score += Math.min(20, punctCount / 5);
    score += tagWeight + pos;
    if (h1 && (el.contains(h1) || h1.contains(el) || el.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_PRECEDING)) score += 8;
    score -= Math.min(50, linkDensity * 120);
    score -= btnCount * 6;
    score -= upperRatio > 0.65 ? 20 : 0;
    score -= neg;

    return {
      el,
      text,
      score,
      length: text.length,
      classOrId: cleanText(`${el.id || ''} ${(el.className || '').toString()}`)
    };
  }

  function uniqueMerge(candidates, maxWords) {
    const selected = [];
    const chunks = [];
    const seen = new Set();
    let count = 0;
    for (const c of candidates) {
      const t = cleanText(c.text);
      if (!t || seen.has(t)) continue;
      if (selected.some((s) => s.el.contains(c.el) || c.el.contains(s.el))) continue;
      const w = words(t);
      if (!w.length) continue;
      seen.add(t);
      selected.push(c);
      chunks.push(t);
      count += w.length;
      if (count >= maxWords) break;
    }
    return { text: chunks.join(' '), selected };
  }

  function rankReadableCandidates(doc, opts = {}) {
    const win = doc.defaultView || window;
    const nodes = doc.querySelectorAll('main, section, article, div, p, h1, h2, h3, li');
    const h1 = doc.querySelector('h1');
    const candidates = [];
    nodes.forEach((el) => {
      const scored = scoreElement(el, doc, win, h1);
      if (scored) candidates.push(scored);
    });
    candidates.sort((a, b) => b.score - a.score);
    const merged = uniqueMerge(candidates, opts.maxWords || 700);
    return { text: merged.text, candidates, selected: merged.selected };
  }

  function cleanBodyFallback(doc, maxWords = 450) {
    const badLine = /(menu|subscribe|sign in|login|register|cookie|consent|share|related|recommended|advert|comment)/i;
    const lines = cleanText(doc.body?.innerText || '').split(/\n+/).map(cleanText).filter(Boolean);
    const kept = [];
    const seen = new Set();
    for (const line of lines) {
      if (line.length < 25 || badLine.test(line) || seen.has(line)) continue;
      if (!/[.!?]/.test(line) && line.split(' ').length < 8) continue;
      kept.push(line);
      seen.add(line);
      if (words(kept.join(' ')).length >= maxWords) break;
    }
    return kept.join(' ');
  }

  return { cleanText, rankReadableCandidates, cleanBodyFallback, words };
});
