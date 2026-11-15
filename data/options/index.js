/* globals prefs */
'use strict';

const toast = document.getElementById('toast');
const notify = (msg, timeout = 1500) => {
  toast.textContent = msg;
  clearTimeout(notify.id);
  notify.id = setTimeout(() => toast.textContent = '', timeout);
};

const DEFAULTS = {
  'startup-proxy': 'no',
  'color-direct': '#000000',
  'color-pac_script_url': '#fb9426',
  'color-pac_script_data': '#fb9426'
};

document.getElementById('save').addEventListener('click', () => {
  const values = {};
  for (const key of Object.keys(DEFAULTS)) {
    values[key] = document.getElementById(key).value;
  }
  const {clean, rejected} = prefs.sanitize(values);
  chrome.storage.local.set(clean, () => {
    notify(rejected.length ? 'Ignored invalid values: ' + rejected.join(', ') : 'Options saved.');
    chrome.runtime.sendMessage({method: 'update-icon'}, () => chrome.runtime.lastError);
  });
});

document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.local.get(DEFAULTS).then(ps => {
    const {clean} = prefs.sanitize(ps);
    for (const key of Object.keys(DEFAULTS)) {
      document.getElementById(key).value = key in clean ? clean[key] : DEFAULTS[key];
    }
  });
});

// export (only whitelisted keys)
document.getElementById('export').addEventListener('click', () => {
  chrome.storage.local.get(null, ps => {
    const {clean} = prefs.sanitize(ps);
    const text = JSON.stringify(clean, null, '\t');
    const blob = new Blob([text], {type: 'application/json'});
    const objectURL = URL.createObjectURL(blob);
    Object.assign(document.createElement('a'), {
      href: objectURL,
      type: 'application/json',
      download: 'traffic-switcher-preferences.json'
    }).dispatchEvent(new MouseEvent('click'));
    setTimeout(() => URL.revokeObjectURL(objectURL));
  });
});

// import
const MAX_IMPORT = 1024 * 1024;

const importPrefs = async text => {
  let json;
  try {
    json = JSON.parse(text);
  }
  catch (e) {
    throw Error('Not a valid JSON file');
  }
  const {clean, rejected} = prefs.sanitize(json);
  if (Object.keys(clean).length === 0) {
    throw Error('Nothing to import: no supported settings found');
  }

  const current = await chrome.storage.local.get(['script', 'last-pac', 'pacs']);
  const changes = [];
  if ('script' in clean && clean.script !== current.script) {
    changes.push('- the inline PAC script (it decides where ALL your traffic goes)');
  }
  if ('last-pac' in clean && clean['last-pac'] !== current['last-pac']) {
    changes.push('- PAC URL: ' + clean['last-pac']);
  }
  if ('pacs' in clean) {
    const added = clean.pacs.filter(u => !(current.pacs || []).includes(u));
    if (added.length) {
      changes.push('- saved PAC URLs: ' + added.join(', '));
    }
  }
  let message = 'Import settings from this file?';
  if (changes.length) {
    message += '\n\nThe file will change:\n' + changes.join('\n') +
      '\n\nOnly continue if you created this file yourself or fully trust its source.';
  }
  if (rejected.length) {
    message += '\n\nIgnored (unsupported or invalid): ' + rejected.join(', ');
  }
  if (!window.confirm(message)) {
    return false;
  }
  await chrome.storage.local.set(clean);
  return true;
};

document.getElementById('import').addEventListener('click', () => {
  const fileInput = document.createElement('input');
  fileInput.style.display = 'none';
  fileInput.type = 'file';
  fileInput.accept = '.json,application/json';

  document.body.appendChild(fileInput);
  fileInput.onchange = () => {
    const file = fileInput.files[0];
    fileInput.remove();
    if (!file) {
      return;
    }
    if (file.size > MAX_IMPORT) {
      notify('File is too large', 3000);
      return;
    }
    file.text().then(importPrefs).then(done => {
      if (done) {
        notify('Imported. Re-select the PAC Script tab to apply.', 4000);
      }
    }).catch(e => notify(e.message || String(e), 4000));
  };
  fileInput.click();
});

// reset
document.getElementById('reset').addEventListener('click', e => {
  if (e.detail === 1) {
    notify('Double-click to reset!', 750);
  }
  else {
    chrome.storage.local.clear(() => {
      chrome.proxy.settings.clear({}, () => {
        chrome.runtime.reload();
        window.close();
      });
    });
  }
});
