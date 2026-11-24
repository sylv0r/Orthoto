import { getSettings } from './settings.js';
import { check } from './api.js';

let badgeError = null;

function setBadgeError(message) {
  if (message === badgeError) return;
  badgeError = message;
  chrome.action.setBadgeText({ text: message ? '!' : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#e5484d' });
  chrome.action.setTitle({ title: message ? `Orthoto: ${message}` : 'Orthoto' });
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'check') {
    getSettings()
      .then((s) => check(s, msg.text))
      .then((result) => {
        setBadgeError(null);
        sendResponse(result);
      })
      .catch((err) => {
        setBadgeError(err.message);
        sendResponse({ error: err.message });
      });
    return true;
  }
  if (msg?.type === 'openOptions') chrome.runtime.openOptionsPage();
  return false;
});
