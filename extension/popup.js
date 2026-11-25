import { getSettings } from './settings.js';
import { ping } from './api.js';

const $ = (id) => document.getElementById(id);
const settings = await getSettings();
const save = (values) => {
  Object.assign(settings, values);
  return chrome.storage.local.set(values);
};

function setStatus(text, kind = '') {
  $('status').textContent = text;
  $('status').className = kind;
}

async function testServer() {
  setStatus('…');
  try {
    setStatus(`connected · ${await ping(settings)} ms`, 'ok');
  } catch (err) {
    setStatus(err.message, 'err');
    $('server-box').open = true;
  }
}

// Firefox lets the user withhold or revoke host access: content scripts then never run.
const ALL_SITES = { origins: ['<all_urls>'] };
const renderAccess = async () => { $('access').hidden = await chrome.permissions.contains(ALL_SITES); };
$('grant').addEventListener('click', () => chrome.permissions.request(ALL_SITES).then(renderAccess));
renderAccess();

const langButtons = document.querySelectorAll('[data-lang]');
const renderLang = () => langButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === settings.lang)));
langButtons.forEach((b) => b.addEventListener('click', () => save({ lang: b.dataset.lang }).then(renderLang)));
renderLang();

$('enabled').checked = settings.enabled;
$('enabled').addEventListener('change', (e) => save({ enabled: e.target.checked }));

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
let site = null;
try {
  const url = new URL(tab?.url);
  if (url.protocol === 'http:' || url.protocol === 'https:') site = url.hostname;
} catch {}
if (site) {
  $('site-row').hidden = false;
  $('site').textContent = site;
  $('site-enabled').checked = !settings.disabledSites.includes(site);
  $('site-enabled').addEventListener('change', (e) => {
    const others = settings.disabledSites.filter((s) => s !== site);
    save({ disabledSites: e.target.checked ? others : [...others, site] });
  });
}

$('server').value = settings.server;
$('user').value = settings.user;
$('password').value = settings.password;
$('server-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  await save({ server: $('server').value.trim(), user: $('user').value, password: $('password').value });
  testServer();
});

testServer();
