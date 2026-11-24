import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSegments, joinSegments, cycle, countFixes } from '../web/core.js';

const match = (text, word, values, issueType = 'uncategorized', category = 'CAT_GRAMMAIRE') => ({
  offset: text.indexOf(word),
  length: word.length,
  message: 'msg',
  replacements: values.map((value) => ({ value })),
  rule: { issueType, category: { id: category } },
});

test('applies the first suggestion of each error', () => {
  const text = 'Je suis aller au marché, merci beaucoups.';
  const segs = buildSegments(text, [
    match(text, 'beaucoups', ['beaucoup'], 'misspelling', 'TYPOS'),
    match(text, 'aller', ['allé', 'allés']),
  ]);
  assert.equal(joinSegments(segs), 'Je suis allé au marché, merci beaucoup.');
  assert.equal(countFixes(segs), 2);
});

test('text without errors is returned unchanged', () => {
  const text = 'Bonjour,\nje suis allé au marché.';
  assert.equal(joinSegments(buildSegments(text, [])), text);
});

test('style suggestions are never applied', () => {
  const text = 'Je suis monté en haut. Je suis très très content.';
  const segs = buildSegments(text, [
    match(text, 'monté en haut', ['monté'], 'style', 'CAT_PLEONASMES'),
    match(text, 'très très', ['très'], 'style', 'CAT_REGLES_DE_BASE'),
    match(text, 'content', ['heureux'], 'uncategorized', 'REPETITIONS_STYLE'),
  ]);
  assert.equal(joinSegments(segs), text);
  assert.equal(countFixes(segs), 0);
});

test('overlapping matches keep only the first one', () => {
  const text = 'des pomme rouge';
  const segs = buildSegments(text, [
    match(text, 'des pomme', ['des pommes']),
    match(text, 'pomme rouge', ['pommes rouges']),
  ]);
  assert.equal(joinSegments(segs), 'des pommes rouge');
});

test('errors without suggestion are flagged but left untouched', () => {
  const text = 'Un mot zorglubesque ici.';
  const segs = buildSegments(text, [match(text, 'zorglubesque', [], 'misspelling', 'TYPOS')]);
  assert.equal(joinSegments(segs), text);
  assert.equal(segs.filter((s) => typeof s !== 'string').length, 1);
  assert.equal(countFixes(segs), 0);
});

test('grammar errors prefer the smallest change, spelling keeps LanguageTool order', () => {
  const text = 'Elle sont là avec des pomme, il a buyed.';
  const segs = buildSegments(text, [
    match(text, 'Elle sont', ['Elles ont', 'Elles sont', 'Elle est'], 'uncategorized', 'AGREEMENT'),
    match(text, 'des pomme', ['de la pomme', 'des pommes'], 'uncategorized', 'AGREEMENT'),
    match(text, 'buyed', ['bought', 'buyer', 'guyed'], 'misspelling', 'TYPOS'),
  ]);
  assert.equal(joinSegments(segs), 'Elles sont là avec des pommes, il a bought.');
});

test('cycle goes through alternatives, then back to the original', () => {
  const text = 'Les enfant jouent.';
  const segs = buildSegments(text, [match(text, 'Les enfant', ["L'enfant", 'Les enfants'], 'uncategorized', 'AGREEMENT')]);
  const seg = segs[0];
  assert.equal(joinSegments(segs), 'Les enfants jouent.');
  cycle(seg);
  assert.equal(joinSegments(segs), "L'enfant jouent.");
  cycle(seg);
  assert.equal(joinSegments(segs), text);
  cycle(seg);
  assert.equal(joinSegments(segs), 'Les enfants jouent.');
});
