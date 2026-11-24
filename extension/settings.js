export const DEFAULTS = {
  server: 'http://localhost:8080',
  user: 'admin',
  password: '',
  lang: 'auto',
  enabled: true,
  disabledSites: [],
};

export const getSettings = () => chrome.storage.local.get(DEFAULTS);
