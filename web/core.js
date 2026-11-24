// Pure logic (no DOM), shared by the page and the tests.

// Style suggestions would rewrite text that is already correct: never applied.
const STYLE_ISSUE_TYPES = new Set(['style', 'register']);
const STYLE_CATEGORIES = new Set([
  'STYLE', 'REDUNDANCY', 'REPETITIONS_STYLE', 'PLAIN_ENGLISH', 'TON_ACADEMIC',
  'CREATIVE_WRITING', 'WIKIPEDIA', 'CAT_PLEONASMES',
]);

export const LANGS = { fr: 'fr', en: 'en-US' };

export function isStyle(match) {
  return STYLE_ISSUE_TYPES.has(match.rule?.issueType) || STYLE_CATEGORIES.has(match.rule?.category?.id);
}

function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// For grammar errors LanguageTool often lists a heavier rewrite first
// ("des pomme" → "de la pomme" before "des pommes"): prefer the smallest change.
// Spelling keeps LanguageTool's own order ("buyed" → "bought", not "buyer").
export function rankOptions(original, options, issueType) {
  if (issueType === 'misspelling') return options;
  return options
    .map((value, i) => [editDistance(original, value), i, value])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .map(([, , value]) => value);
}

// Splits `text` into plain strings and correction segments:
// { original, options, choice, message } — choice -1 means "keep the original".
export function buildSegments(text, matches) {
  const segments = [];
  let pos = 0;
  const sorted = matches.filter((m) => !isStyle(m)).sort((a, b) => a.offset - b.offset);
  for (const m of sorted) {
    if (m.offset < pos) continue;
    if (m.offset > pos) segments.push(text.slice(pos, m.offset));
    const original = text.slice(m.offset, m.offset + m.length);
    const unique = [...new Set((m.replacements || []).slice(0, 5).map((r) => r.value))]
      .filter((v) => v !== original);
    const options = rankOptions(original, unique, m.rule?.issueType);
    segments.push({ original, options, choice: options.length ? 0 : -1, message: m.message });
    pos = m.offset + m.length;
  }
  if (pos < text.length) segments.push(text.slice(pos));
  return segments;
}

export function segmentValue(seg) {
  if (typeof seg === 'string') return seg;
  return seg.choice < 0 ? seg.original : seg.options[seg.choice];
}

export function joinSegments(segments) {
  return segments.map(segmentValue).join('');
}

// Click cycle: suggestion 1 → 2 → … → original → suggestion 1.
export function cycle(seg) {
  if (seg.options.length) seg.choice = seg.choice === seg.options.length - 1 ? -1 : seg.choice + 1;
  return seg;
}

export function countFixes(segments) {
  return segments.filter((s) => typeof s !== 'string' && s.choice >= 0).length;
}
