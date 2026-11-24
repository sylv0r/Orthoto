import { LANGS, buildSegments, joinSegments, segmentValue, cycle, countFixes } from './core.js';

const $ = (id) => document.getElementById(id);
const input = $('input');
const output = $('output');
const status = $('status');
const copyBtn = $('copy');
const langButtons = document.querySelectorAll('[data-lang]');

let lang = 'fr';
let segments = [];
let controller;

function render() {
  output.replaceChildren(...segments.map((seg, i) => {
    if (typeof seg === 'string') return document.createTextNode(seg);
    const mark = document.createElement('mark');
    mark.dataset.i = i;
    mark.textContent = segmentValue(seg);
    if (!seg.options.length) mark.className = 'warn';
    else if (seg.choice < 0) mark.className = 'orig';
    const alternatives = seg.options.length ? `\n${seg.original} → ${seg.options.join(' | ')}` : '';
    mark.title = seg.message + alternatives;
    return mark;
  }));
  copyBtn.disabled = !segments.length;
}

async function correct() {
  const text = input.value;
  if (!text.trim()) return;
  controller?.abort();
  controller = new AbortController();
  status.textContent = '…';
  const t0 = performance.now();
  try {
    const res = await fetch('/v2/check', {
      method: 'POST',
      body: new URLSearchParams({ language: LANGS[lang], text }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { matches } = await res.json();
    segments = buildSegments(text, matches);
    render();
    const n = countFixes(segments);
    const ms = Math.round(performance.now() - t0);
    status.textContent = n ? `${n} correction${n > 1 ? 's' : ''} · ${ms} ms` : `Aucune faute ✓ · ${ms} ms`;
  } catch (err) {
    if (err.name !== 'AbortError') status.textContent = `Erreur : ${err.message}`;
  }
}

async function copy() {
  const text = joinSegments(segments);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard API requires HTTPS; plain-HTTP fallback (e.g. LAN access).
    const tmp = document.createElement('textarea');
    tmp.value = text;
    document.body.append(tmp);
    tmp.select();
    document.execCommand('copy');
    tmp.remove();
  }
  status.textContent = 'Copié ✓';
}

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    correct();
  }
});
$('correct').addEventListener('click', correct);
copyBtn.addEventListener('click', copy);

output.addEventListener('click', (e) => {
  const mark = e.target.closest('mark[data-i]');
  if (!mark) return;
  cycle(segments[mark.dataset.i]);
  render();
});

langButtons.forEach((btn) => btn.addEventListener('click', () => {
  lang = btn.dataset.lang;
  langButtons.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
  document.documentElement.lang = lang;
  if (segments.length) correct();
  input.focus();
}));

input.focus();
