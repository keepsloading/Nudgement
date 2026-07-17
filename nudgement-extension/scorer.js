/**
 * NudgementScorer
 * Scoring engine with two outputs:
 *   1. nudge_profile  — 8 topic-domain exposure dimensions (the main Nudgemeter view)
 *   2. nudgemeter_score — single 0-100 composite (for badge + quick read)
 *
 * Architecture preserved from original hackathon build (Boundier/IIT Bombay).
 * Added: dimension mapping, topic keyword detection, nudge_profile output,
 *        history entry format.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.NudgementScorer = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  const ENGINE_VERSION = 'nudgement-rules-2.0';

  // ─── Tactic Signals ─────────────────────────────────────────────────────────
  // Original 14 signal categories from the hackathon build, preserved.
  // These feed into both the legacy score and the new dimension system.
  const SIGNALS = [
    { category: 'attention_capture',       weight: 14, reason: 'Curiosity-gap wording captures attention before substance.',     pattern: /\b(everyone is talking about|what happened next|what happens next|the truth about|this is why|the reason why)\b/gi },
    { category: 'clickbait',               weight: 15, reason: 'Clickbait wording pushes curiosity pressure.',                    pattern: /\b(you won't believe|you will not believe|shocking|secret|hidden|mind-blowing|before you)\b/gi },
    { category: 'emotional_pressure',      weight: 13, reason: 'Identity or guilt pressure pushes emotional compliance.',          pattern: /\b(if you care|don't stay silent|do not stay silent|wake up|open your eyes|only idiots)\b/gi },
    { category: 'fear_appeal',             weight: 13, reason: 'Threat-oriented wording increases fear pressure.',                 pattern: /\b(warning|danger|collapse|crisis|deadly|panic|catastrophe)\b/gi },
    { category: 'outrage_amplification',   weight: 13, reason: 'Outrage-first wording primes anger over context.',                pattern: /\b(furious|outraged|slammed|destroy(?:ing|ed|s)?|humiliated|betrayed|scandal|enraged|appalling|disgrace)\b/gi },
    { category: 'false_urgency',           weight: 12, reason: 'Urgency cues pressure immediate reaction.',                        pattern: /\b(act now|right now|before it's too late|before it is too late|last chance|must see|don't miss|do not miss)\b/gi },
    { category: 'loaded_language',         weight: 11, reason: 'Loaded language can bias interpretation.',                         pattern: /\b(corrupt|evil|traitors|idiots|shameless|disgusting|lies)\b/gi },
    { category: 'enemy_construction',      weight: 13, reason: 'Us-versus-them framing constructs enemy targets.',                 pattern: /\b(traitors|enemies of the people|the elites|they don't want you to know|they do not want you to know|they are destroy(?:ing)? us|destroy(?:ing|ed)? everything|corrupt media)\b/gi },
    { category: 'polarization',            weight: 12, reason: 'Polarizing language frames rigid camps.',                          pattern: /\b(us vs them|real [a-z]+|anti-national|woke mob|leftists|right-wingers|pick a side)\b/gi },
    { category: 'certainty_inflation',     weight: 10, reason: 'Absolute certainty removes nuance.',                               pattern: /\b(always|never|everyone knows|nobody talks about|proves|proof that|undeniable|guaranteed|without question|no doubt)\b/gi },
    { category: 'source_obscurity',        weight: 10, reason: 'Vague sourcing weakens verifiability.',                            pattern: /\b(experts say|sources say|people are saying|some say|many believe|it is believed|reportedly|allegedly|rumor has it)\b/gi },
    { category: 'social_proof_pressure',   weight: 11, reason: 'Social-proof cues pressure conformity.',                           pattern: /\b(everyone is talking about|millions agree|people are waking up|the whole internet|viral|many believe)\b/gi },
    { category: 'engagement_bait',         weight: 10, reason: 'Engagement bait prompts interaction over understanding.',          pattern: /\b(like and share|comment below|tag someone|subscribe now|watch till the end|watch until the end|share before they delete this)\b/gi },
    { category: 'call_to_action_pressure', weight: 10, reason: 'Call-to-action pressure pushes immediate action.',                 pattern: /\b(share this if|send this to everyone|join now|don't stay silent|do not stay silent|boycott|act now|wake up)\b/gi }
  ];

  const CATEGORY_KEYS = [...new Set(SIGNALS.map(s => s.category))];

  // ─── Dimension Definitions ───────────────────────────────────────────────────
  // Each dimension has:
  //   - topicKeywords: regex to detect if content is *about* this domain
  //   - tactics: which tactic signals amplify this dimension when present
  //   - label / color: used by the UI
  const DIMENSIONS = {
    outrage: {
      label: 'Outrage',
      color: '#EF4444',
      topicKeywords: /\b(outrage|outraged|furious|enraged|disgusting|shameless|betrayed|humiliated|destroy(?:ing|ed|s)?|slammed|backlash|scandal|controversy|shocking|appalling|disgrace|rage|wrath)\b/gi,
      tactics: ['outrage_amplification', 'emotional_pressure', 'loaded_language', 'fear_appeal']
    },
    politics: {
      label: 'Politics',
      color: '#60A5FA',
      topicKeywords: /\b(political|politics|government|democrat|republican|liberal|conservative|election|vote|congress|senate|president|policy|legislation|partisan|woke|leftist|right.wing|parliament|minister|regime|administration)\b/gi,
      tactics: ['polarization', 'enemy_construction', 'certainty_inflation', 'loaded_language']
    },
    health: {
      label: 'Health',
      color: '#34D399',
      topicKeywords: /\b(health|disease|virus|vaccine|cancer|diet|weight|mental health|anxiety|depression|treatment|cure|symptoms|medical|doctor|wellness|nutrition|fitness|pandemic|epidemic|disorder|pharmaceutical)\b/gi,
      tactics: ['fear_appeal', 'source_obscurity', 'certainty_inflation']
    },
    finance: {
      label: 'Finance',
      color: '#FBBF24',
      topicKeywords: /\b(money|invest|stock|market|crypto|bitcoin|debt|inflation|economy|financial|wealth|profit|loss|bank|trading|recession|dollar|price|cost|afford|asset|fund|interest rate|mortgage)\b/gi,
      tactics: ['fear_appeal', 'false_urgency', 'certainty_inflation', 'social_proof_pressure']
    },
    consumerism: {
      label: 'Consumerism',
      color: '#F472B6',
      topicKeywords: /\b(buy|sale|deal|offer|discount|limited|product|brand|shopping|order|price|cheap|luxury|must.have|best|review|recommend|sponsored|advertisement|promo|exclusive|sold out)\b/gi,
      tactics: ['false_urgency', 'engagement_bait', 'call_to_action_pressure', 'social_proof_pressure']
    },
    ai_tech: {
      label: 'AI & Tech',
      color: '#A78BFA',
      topicKeywords: /\b(artificial intelligence|machine learning|chatgpt|gpt|llm|technology|software|app|digital|robot|automation|algorithm|data|privacy|cyber|hack|tech|startup|silicon valley|disruption|neural|model|compute|cloud)\b/gi,
      tactics: ['certainty_inflation', 'clickbait', 'attention_capture']
    },
    productivity: {
      label: 'Productivity',
      color: '#22D3EE',
      topicKeywords: /\b(productivity|hustle|grind|success|achieve|goal|habit|routine|morning|entrepreneur|side hustle|passive income|discipline|mindset|growth|optimize|efficiency|self.improvement|life hack)\b/gi,
      tactics: ['call_to_action_pressure', 'false_urgency', 'social_proof_pressure']
    },
    entertainment: {
      label: 'Entertainment',
      color: '#FB923C',
      topicKeywords: /\b(celebrity|famous|viral|trending|drama|gossip|dating|relationship|music|movie|tv|show|stream|influencer|follower|fan|pop culture|red carpet|award|chart|hit)\b/gi,
      tactics: ['clickbait', 'attention_capture', 'engagement_bait', 'social_proof_pressure']
    }
  };

  const DIMENSION_KEYS = Object.keys(DIMENSIONS);

  // ─── Utilities ───────────────────────────────────────────────────────────────
  function cleanText(v) { return (v || '').replace(/\s+/g, ' ').trim(); }
  function clamp(v, min = 0, max = 100) { return Math.max(min, Math.min(max, v)); }
  function tokenize(t) { return cleanText(t).match(/\b[\w'-]+\b/g) || []; }
  function toTitle(k) { return k.split('_').map(x => x[0].toUpperCase() + x.slice(1)).join(' '); }
  function humanCategory(c) { return toTitle(c || ''); }
  function formatSignal(s) { return s ? `"${s}"` : 'this pattern'; }

  // ─── Topic keyword scoring ────────────────────────────────────────────────────
  // Returns a raw count of how often topic keywords appear in the text.
  // Normalized to 0-40 range (topic presence bonus).
  function topicKeywordScore(text, pattern, wordCount) {
    if (!text) return 0;
    pattern.lastIndex = 0;
    const matches = text.match(pattern) || [];
    pattern.lastIndex = 0;
    // Normalize: each keyword match is worth ~5 points, capped at 40,
    // adjusted by doc length so short docs don't get unfair boosts.
    const raw = matches.length * 5;
    const lengthFactor = Math.max(0.5, Math.min(1.5, Math.log10(Math.max(wordCount, 15)) / Math.log10(100)));
    return clamp(Math.round(raw / lengthFactor), 0, 40);
  }

  // ─── Dimension profile computation ───────────────────────────────────────────
  // For each dimension:
  //   topicScore  = keyword presence in the text (0-40)
  //   tacticScore = average of normalized scores for dimension's associated tactics (0-100)
  //   final       = clamp(topicScore * 0.55 + tacticScore * 0.45)
  //
  // This way: a fearful health article gets high Health.
  //           political outrage content gets high Outrage AND Politics.
  //           pure clickbait with no topic context gets high Entertainment (default).
  function computeDimensionProfile(normCategoryScores, allText, wordCount) {
    const profile = {};
    for (const [key, dim] of Object.entries(DIMENSIONS)) {
      const topicScore = topicKeywordScore(allText, dim.topicKeywords, wordCount);
      const tacticAvg = dim.tactics.length
        ? Math.round(dim.tactics.reduce((sum, t) => sum + (normCategoryScores[t] || 0), 0) / dim.tactics.length)
        : 0;
      profile[key] = clamp(Math.round(topicScore * 0.55 + tacticAvg * 0.45));
    }
    return profile;
  }

  // ─── Explanation builder ─────────────────────────────────────────────────────
  function buildExplanations(nudgemeterScore, tactics, topSignals, categoryScores, surface, wordCount) {
    const level = nudgemeterScore >= 66 ? 'High' : nudgemeterScore >= 36 ? 'Moderate' : 'Low';
    const cleanTop = (topSignals || []).filter(s => s && s.signal !== 'No strong nudge signal found' && s.category !== 'baseline');
    const topCategories = Object.entries(categoryScores || {})
      .filter(([, v]) => v >= 28).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => humanCategory(k));
    const lines = [];

    if (level === 'Low') {
      lines.push(`Low nudge activity: few strong influence signals were detected across ${wordCount.toLocaleString()} analyzed words.`);
      if (cleanTop.length) {
        const t = cleanTop[0];
        lines.push(`Mild ${humanCategory(t.category)} signal ${formatSignal(t.signal)} found in the ${t.location}. ${t.reason}`);
      } else {
        lines.push('No dominant nudge patterns stood out in this content.');
      }
    } else {
      lines.push(`${level} nudge activity: strongest signals were ${topCategories.length ? topCategories.join(', ') : 'distributed across multiple categories'}.`);
      for (const t of cleanTop.slice(0, 3)) {
        lines.push(`${formatSignal(t.signal)} (${humanCategory(t.category)}): ${t.reason}`);
      }
      if (!cleanTop.length) {
        lines.push('Multiple weaker signals combined to raise the score without a single dominant phrase.');
      }
    }

    if (lines.length < 3) {
      lines.push(`Analysis based on visible ${surface || 'page'} text only, using local pattern matching.`);
    }

    return lines.slice(0, 5);
  }

  // ─── Main scoring function ────────────────────────────────────────────────────
  function scoreContent(content, requestId = '') {
    const headline = cleanText(content.headline);
    const body = cleanText([content.byline, content.snippet].filter(Boolean).join(' '));
    const allText = cleanText([headline, body].join(' '));

    // --- Tactic signal scanning (original engine, preserved) ---
    const scores = Object.fromEntries(CATEGORY_KEYS.map(k => [k, 0]));
    const evidence = [];

    for (const s of SIGNALS) {
      for (const scope of [
        { name: 'headline', text: headline, m: 1.45 },
        { name: 'body',     text: body,     m: 1.0  }
      ]) {
        s.pattern.lastIndex = 0;
        let m;
        while ((m = s.pattern.exec(scope.text))) {
          const p = cleanText(m[0]);
          const a = s.weight * scope.m;
          scores[s.category] += a;
          evidence.push({ signal: p, reason: s.reason, category: s.category, location: scope.name, weight: a });
        }
      }
    }

    // Punctuation / caps bonuses
    const ex = (allText.match(/!/g) || []).length;
    const q  = (allText.match(/\?/g) || []).length;
    const caps = (allText.match(/\b[A-Z]{3,}\b/g) || []).length;
    if (ex || q) { const p = Math.min(14, ex * 3 + Math.max(0, q - 1) * 2); scores.attention_capture += p; scores.false_urgency += p * 0.5; }
    if (caps)    { const p = Math.min(14, caps * 3); scores.false_urgency += p; scores.loaded_language += p * 0.4; }

    // Normalize by word count
    const wc = Math.max(content.word_count || tokenize(allText).length, 1);
    const norm = {};
    for (const [k, v] of Object.entries(scores)) {
      norm[k] = clamp(Math.round((v * 5.8) / Math.max(1.15, Math.log10(Math.max(wc, 15)))));
    }

    // --- Legacy composite scores (kept for compatibility) ---
    const attention = clamp(Math.round(norm.attention_capture * 0.28 + norm.clickbait * 0.26 + norm.engagement_bait * 0.28 + norm.social_proof_pressure * 0.18));
    const emotion   = clamp(Math.round(norm.emotional_pressure * 0.32 + norm.fear_appeal * 0.24 + norm.outrage_amplification * 0.24 + norm.false_urgency * 0.20));
    const framing   = clamp(Math.round(norm.loaded_language * 0.26 + norm.enemy_construction * 0.30 + norm.polarization * 0.24 + norm.certainty_inflation * 0.20));
    const source    = clamp(Math.round(norm.source_obscurity * 0.74 + norm.certainty_inflation * 0.14 + norm.social_proof_pressure * 0.12));
    const nudgemeterScore = clamp(Math.round(attention * 0.28 + emotion * 0.27 + framing * 0.27 + source * 0.18));

    // --- New: 8-dimension nudge profile ---
    const nudgeProfile = computeDimensionProfile(norm, allText, wc);

    // --- Top signals & tactics ---
    const sorted = evidence
      .sort((a, b) => b.weight - a.weight)
      .filter((it, idx, arr) => arr.findIndex(o => o.signal.toLowerCase() === it.signal.toLowerCase() && o.category === it.category) === idx);
    const topSignals = sorted.slice(0, 5).map(({ signal, reason, category, location }) => ({ signal, reason, category, location }));
    const tactics = Object.entries(norm).filter(([, v]) => v >= 28).sort((a, b) => b[1] - a[1]).map(([k]) => k);

    const unc = clamp(18 - Math.min(10, sorted.length * 2) + (wc < 40 ? 5 : 0), 6, 22);

    return {
      // Nudgemeter (new primary output)
      nudgemeter_score: nudgemeterScore,
      nudge_profile: nudgeProfile,

      // Legacy sub-scores (kept for compatibility)
      attention_score: attention,
      emotion_score: emotion,
      framing_score: framing,
      source_score: source,

      confidence_interval: `${clamp(nudgemeterScore - unc)}-${clamp(nudgemeterScore + unc)}`,
      top_signals: topSignals.length ? topSignals : [{ signal: 'No strong nudge signal found', reason: 'The scorer did not find enough high-confidence signals.', category: 'baseline', location: 'style' }],
      category_scores: norm,
      tactics,
      content_type: content.surface || 'page',
      site_name: content.site_name || 'This page',
      page_title: content.page_title || headline || '',
      host: content.host || '',
      word_count: wc,
      source: 'local_rules',
      engine_version: ENGINE_VERSION,
      request_id: requestId,
      explanations: buildExplanations(nudgemeterScore, tactics, topSignals, norm, content.surface || 'page', wc)
    };
  }

  return { ENGINE_VERSION, SIGNALS, DIMENSIONS, DIMENSION_KEYS, CATEGORY_KEYS, scoreContent, toTitle };
}));
