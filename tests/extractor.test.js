const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const { rankReadableCandidates } = require('../boundier-extension/extractor.js');

function extract(html) {
  const dom = new JSDOM(html, { pretendToBeVisual: true });
  return rankReadableCandidates(dom.window.document, { maxWords: 200 }).text;
}

test('clean article page', () => {
  const t = extract('<main><article><p>This is a complete article paragraph with context and evidence.</p></article></main>');
  assert.match(t, /complete article paragraph/);
});

test('no article tag custom wrappers', () => {
  const t = extract('<div class="jsx-1"><div class="content-wrap"><div class="field__item">News report paragraph with readable sentence. Another sentence here.</div></div></div>');
  assert.match(t, /News report paragraph/);
});

test('heavy nav before content', () => {
  const t = extract('<nav><a>Home</a><a>Subscribe</a></nav><div class="story"><p>The policy briefing includes three sections with analysis and detail.</p></div>');
  assert.match(t, /policy briefing/);
  assert.doesNotMatch(t, /Subscribe/);
});

test('hidden text ignored', () => {
  const t = extract('<div style="display:none">Hidden paragraph with many words to trick extraction.</div><main><p>Visible report with factual statement and additional context.</p></main>');
  assert.match(t, /Visible report/);
  assert.doesNotMatch(t, /Hidden paragraph/);
});

test('liveblog updates collected', () => {
  const t = extract('<main><div class="update">10:00 Update. Officials confirmed closures in two districts.</div><div class="update">11:00 Update. Services resumed in central corridor with delays.</div></main>');
  assert.match(t, /10:00 Update/);
  assert.match(t, /11:00 Update/);
});
