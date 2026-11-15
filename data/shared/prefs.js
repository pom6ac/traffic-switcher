/* Shared validation for stored preferences.
 * Loaded as a classic script by the service worker (importScripts),
 * the popup and the options page. Exposes `self.prefs`.
 */
'use strict';

self.prefs = (() => {
  const MAX_SCRIPT = 512 * 1024;
  const MAX_URL = 2048;
  const MAX_PACS = 50;

  const isColor = v => typeof v === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v);

  // PAC files fetched over plain HTTP (or file:, data:, ...) can be swapped
  // by anyone on the network path and take over routing of all traffic.
  const isHttpsUrl = v => {
    // the URL parser silently strips tabs/newlines; reject them so stored and shown values are exact
    if (typeof v !== 'string' || v.length > MAX_URL || /[\s\x00-\x1f\x7f]/.test(v)) {
      return false;
    }
    try {
      const u = new URL(v);
      return u.protocol === 'https:' && !u.username && !u.password;
    }
    catch (e) {
      return false;
    }
  };

  const isScript = v => typeof v === 'string' && v.length <= MAX_SCRIPT && v.includes('FindProxyForURL');

  // whitelist of keys that may live in chrome.storage.local
  const SCHEMA = {
    'color-direct': isColor,
    'color-pac_script_url': isColor,
    'color-pac_script_data': isColor,
    'color-other': isColor,
    'startup-proxy': v => v === 'no' || v === 'direct',
    'pac-type': v => v === 'url' || v === 'data',
    'script': isScript,
    'last-pac': isHttpsUrl,
    'pacs': v => Array.isArray(v) && v.length <= MAX_PACS && v.every(isHttpsUrl)
  };

  // keys written by the original extension for features that were removed
  const OBSOLETE = [
    'profiles', 'last-manual', 'text', 'counter', 'color', 'validate-mode', 'faqs', 'last-update',
    'import-version', 'import-json',
    'color-auto_detect', 'color-system', 'color-fixed_servers'
  ];

  /* returns {clean, rejected} — only whitelisted keys with valid values survive */
  const sanitize = obj => {
    const clean = {};
    const rejected = [];
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return {clean, rejected: ['<root is not an object>']};
    }
    for (const [key, value] of Object.entries(obj)) {
      const check = Object.prototype.hasOwnProperty.call(SCHEMA, key) ? SCHEMA[key] : null;
      if (check && check(value)) {
        clean[key] = value;
      }
      else {
        rejected.push(key);
      }
    }
    return {clean, rejected};
  };

  const obsoleteKeys = stored => Object.keys(stored).filter(k => OBSOLETE.includes(k) || k.startsWith('profile.'));

  return {isColor, isHttpsUrl, isScript, sanitize, obsoleteKeys, SCHEMA};
})();
