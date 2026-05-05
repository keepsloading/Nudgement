const test = require('node:test');
const assert = require('node:assert');
const cases = require('./eval_cases.json');
const { scoreContent, CATEGORY_KEYS } = require('../boundier-extension/scorer.js');

test('rustmeter schema and category coverage', () => {
  const result = scoreContent({ headline: 'You won\'t believe this secret', snippet: 'Like and share now', surface: 'page' }, 't1');
  assert.ok(Number.isFinite(result.rustmeter_score));
  assert.equal(result.aim_score, undefined);
  ['rustmeter_score','attention_score','emotion_score','framing_score','source_score','category_scores','top_signals','explanations','source','engine_version'].forEach((k)=>assert.ok(Object.hasOwn(result,k), k));
  for (const key of CATEGORY_KEYS) assert.ok(Object.hasOwn(result.category_scores, key));
});

test('neutral text scores lower than bait text', () => {
  const neutral = scoreContent({ headline: 'City council meeting minutes released', snippet: 'Members discussed transport budget allocations.' }, 'n');
  const bait = scoreContent({ headline: 'You won\'t believe this scandal', snippet: 'Act now, share this if you care.' }, 'b');
  assert.ok(neutral.rustmeter_score < bait.rustmeter_score);
});

test('eval fixtures are within ranges', () => {
  for (const c of cases) {
    const r = scoreContent(c.input, c.name);
    assert.ok(r.rustmeter_score >= c.expect.min && r.rustmeter_score <= c.expect.max, `${c.name}: ${r.rustmeter_score}`);
  }
});
