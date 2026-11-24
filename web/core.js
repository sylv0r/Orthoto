// Pure logic (no DOM), shared by the page, the browser extension and the tests.

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

// Up to 5 distinct suggestions for a LanguageTool match, best first.
export function matchOptions(match, original) {
  const unique = [...new Set((match.replacements || []).slice(0, 5).map((r) => r.value))]
    .filter((v) => v !== original);
  return rankOptions(original, unique, match.rule?.issueType);
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
    const options = matchOptions(m, original);
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

// Keeps `{ offset, length }` matches aligned while the user types, until the next
// check: matches before the edit stay, matches after it move, the edited ones go
// (including a word being extended: "pomme" + "s").
const isWordChar = (ch) => ch !== undefined && /[\p{L}\p{N}'’-]/u.test(ch);

export function shiftMatches(matches, before, after) {
  if (before === after) return matches;
  const max = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < max && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (suffix < max - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
  const editEnd = before.length - suffix;
  const delta = after.length - before.length;
  const kept = [];
  for (const m of matches) {
    const end = m.offset + m.length;
    if (end < prefix || (end === prefix && !isWordChar(after[prefix]))) kept.push(m);
    else if (m.offset > editEnd || (m.offset === editEnd && !isWordChar(after[m.offset + delta - 1]))) {
      kept.push({ ...m, offset: m.offset + delta });
    }
  }
  return kept;
}

// Words that are frequent in one language and (almost) never seen in the other.
const FR_WORDS = new Set(('le la les des du de et est une un je tu il elle nous vous ils elles que qui ' +
  'pas pour dans sur avec ce cette ces mais ou au aux ne se sa ses mon mes ton ta tes leur leurs très ' +
  'être avoir été c j l qu n y en merci bonjour salut oui non bien tout tous fait faire comme aussi ' +
  'alors donc chez sont suis ont était peut').split(' '));
const EN_WORDS = new Set(('the and is are of to in it that this for with you not be have has was were ' +
  'at but or my your we they do does did will would can could should what which there their them he ' +
  'she his her its i if so by from about thanks thank hello hi yes please just all get got like good ' +
  'great some one been who how when').split(' '));

// FR/EN score of a text: > 0 French, < 0 English, 0 no signal.
function langScore(text) {
  let score = 0;
  for (const word of text.toLowerCase().split(/[^a-zàâçéèêëîïôûùüÿœæ]+/)) {
    if (FR_WORDS.has(word)) score++;
    else if (EN_WORDS.has(word)) score--;
  }
  return score + (text.match(/[àâçéèêëîïôûùüÿœæ]/gi) || []).length / 2;
}

// Cheap FR/EN guess for the extension's "auto" mode; ties go to French.
export function guessLang(text) {
  return langScore(text) < 0 ? 'en' : 'fr';
}

// Auto mode: splits the text into runs of lines in the same language, so that a
// French reply under an English quote is not checked as English. Lines without
// any signal ("OK", a signature...) join the run around them.
export function languageChunks(text) {
  const lines = [];
  let start = 0;
  for (const line of text.split('\n')) {
    const score = langScore(line);
    lines.push({ start, end: start + line.length, lang: score > 0 ? 'fr' : score < 0 ? 'en' : null });
    start += line.length + 1;
  }
  let lang = lines.find((l) => l.lang)?.lang ?? guessLang(text);
  const chunks = [];
  for (const line of lines) {
    lang = line.lang ?? lang;
    const last = chunks.at(-1);
    if (last?.lang === lang) last.end = line.end;
    else chunks.push({ lang, start: line.start, end: line.end });
  }
  return chunks;
}
