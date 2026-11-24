import { LANGS, isStyle, matchOptions, languageChunks } from './core.js';

const baseUrl = (s) => s.server.trim().replace(/\/+$/, '');

function authHeader(s) {
  const bytes = new TextEncoder().encode(`${s.user}:${s.password}`);
  return `Basic ${btoa(String.fromCharCode(...bytes))}`;
}

async function request(s, path, init = {}) {
  if (!s.password) throw new Error('server not configured');
  let res;
  try {
    res = await fetch(baseUrl(s) + path, {
      ...init,
      headers: { Authorization: authHeader(s) },
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch {
    throw new Error('server unreachable');
  }
  if (res.status === 401) throw new Error('invalid credentials');
  if (!res.ok) throw new Error(`HTTP error ${res.status}`);
  return res;
}

export async function ping(s) {
  const t0 = performance.now();
  await request(s, '/v2/languages');
  return Math.round(performance.now() - t0);
}

// Returns compact matches, without style suggestions (never rephrase correct text).
// In auto mode, each language run is checked with its own language, in parallel.
export async function check(s, text) {
  const chunks = s.lang === 'auto' ? languageChunks(text) : [{ lang: s.lang, start: 0, end: text.length }];
  const parts = await Promise.all(chunks.map(async ({ lang, start, end }) => {
    const part = text.slice(start, end);
    if (!part.trim()) return [];
    const res = await request(s, '/v2/check', {
      method: 'POST',
      body: new URLSearchParams({ language: LANGS[lang] ?? LANGS.fr, text: part }),
    });
    const { matches } = await res.json();
    return matches.map((m) => ({ ...m, offset: m.offset + start }));
  }));
  return {
    matches: parts.flat().filter((m) => !isStyle(m)).map((m) => {
      const original = text.slice(m.offset, m.offset + m.length);
      return {
        offset: m.offset,
        length: m.length,
        original,
        message: m.message,
        ruleId: m.rule.id,
        kind: m.rule.issueType === 'misspelling' ? 'spell' : 'grammar',
        options: matchOptions(m, original),
      };
    }),
  };
}
