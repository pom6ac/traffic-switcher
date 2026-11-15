/* global prefs */
'use strict';

self.importScripts('/data/shared/prefs.js');

const _ = chrome.i18n.getMessage;

const DEFAULT_COLORS = {
  'color-direct': '#000000',
  'color-pac_script_url': '#fb9426',
  'color-pac_script_data': '#fb9426',
  'color-other': '#777777'
};

/* icon color */
{
  let busy = false;
  self.icon = async (config, reason) => {
    if (busy) {
      return;
    }
    console.info('icon', reason);
    busy = true;

    try {
      const stored = await chrome.storage.local.get(Object.keys(DEFAULT_COLORS));
      const colors = {...DEFAULT_COLORS};
      for (const [k, v] of Object.entries(stored)) {
        if (prefs.isColor(v)) {
          colors[k] = v;
        }
      }

      let mode = config.value.mode;
      if (mode === 'pac_script') {
        mode = config.value.pacScript && config.value.pacScript.url ? 'pac_script_url' : 'pac_script_data';
      }

      const canvas = new OffscreenCanvas(48, 48);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#777';
      ctx.fill(
        new Path2D(
          'M28.256,39.289v-1.26h-8.512v1.26c0,1.393-1.129,2.521-2.522,2.521h-2.079v2.523h17.713v-2.523h-2.078 ' +
          'C29.385,41.811,28.256,40.682,28.256,39.289z'
        )
      );
      ctx.fill(
        new Path2D(
          'M45.396,3.667h-0.273H2.859H2.605H0.021V6.25v0.648v26.895v0.391v2.584h2.583h0.589h40.982h1.22h2.583 ' +
          'v-2.584v-0.883V6.846V6.25V3.667H45.396z M24,35.23c-0.696,0-1.261-0.564-1.261-1.262c0-0.695, ' +
          '0.565-1.26,1.261-1.26 c0.697,0,1.261,0.564,1.261,1.26C25.261,34.666,24.697,35.23,24,35.23z ' +
          'M45.435,6.846v0.919v23.644H2.565V7.765V6.898V6.009h0.293    h1.359h39.485h1.419h0.312V6.846z'
        )
      );
      ctx.fillStyle = colors['color-' + mode] || colors['color-other'];
      ctx.fillRect(5.04, 8.652, 37.83, 20.176);

      chrome.action.setBadgeText({text: ''});
      chrome.action.setIcon({
        imageData: ctx.getImageData(0, 0, 48, 48)
      });

      let title = 'Traffic Switcher\n\n';
      if (mode === 'direct') {
        title += _('modeDirect');
      }
      else if (mode === 'pac_script_url') {
        title += _('modePACU') + config.value.pacScript.url;
      }
      else if (mode === 'pac_script_data') {
        title += _('modePACD');
      }
      else {
        title += _('modeOther') + ' (' + mode + ')';
      }
      chrome.action.setTitle({title}, () => chrome.runtime.lastError);
    }
    catch (e) {
      console.error(e);
    }
    busy = false;
  };
}

chrome.proxy.settings.onChange.addListener(config => {
  self.icon(config, 'proxy-changed');
});

/* Bring storage and the active proxy into the reduced, safe feature set:
 * - drop keys of removed features (manual profiles, managed import, counters, ...);
 * - drop stored values that do not pass validation;
 * - if this extension still controls a manual proxy (e.g. a random "free proxy"
 *   from the removed search feature) or a non-HTTPS PAC URL, fall back to direct.
 */
const harden = async () => {
  const stored = await chrome.storage.local.get(null);
  // keep only HTTPS entries of the saved PAC URL list instead of dropping it entirely
  if (Array.isArray(stored.pacs) && !stored.pacs.every(prefs.isHttpsUrl)) {
    stored.pacs = stored.pacs.filter(prefs.isHttpsUrl).slice(-50);
    await chrome.storage.local.set({pacs: stored.pacs});
  }
  const obsolete = prefs.obsoleteKeys(stored);
  const {rejected} = prefs.sanitize(Object.fromEntries(
    Object.entries(stored).filter(([k]) => !obsolete.includes(k))
  ));
  const remove = [...obsolete, ...rejected];
  if (remove.length) {
    console.info('removing unsupported preferences', remove);
    await chrome.storage.local.remove(remove);
  }

  const config = await chrome.proxy.settings.get({});
  if (config.levelOfControl === 'controlled_by_this_extension') {
    const {mode, pacScript} = config.value;
    const unsafe = mode === 'fixed_servers' ||
      (mode === 'pac_script' && pacScript && pacScript.url && !prefs.isHttpsUrl(pacScript.url));
    if (unsafe) {
      console.warn('resetting unsupported proxy configuration', mode);
      await chrome.proxy.settings.set({value: {mode: 'direct'}});
    }
  }
};

// init
const startup = async () => {
  if (startup.once) {
    return;
  }
  startup.once = true;
  try {
    await harden();
  }
  catch (e) {
    console.error(e);
  }
  const {'startup-proxy': startupProxy} = await chrome.storage.local.get({
    'startup-proxy': 'no'
  });
  if (startupProxy === 'direct') {
    await chrome.proxy.settings.set({
      value: {mode: 'direct'}
    });
  }
  chrome.proxy.settings.get({}, config => {
    self.icon(config, 'startup');
  });
};
chrome.runtime.onInstalled.addListener(startup);
chrome.runtime.onStartup.addListener(startup);

chrome.runtime.onMessage.addListener((request, sender) => {
  // accept messages from our own pages only
  if (sender.id !== chrome.runtime.id || !sender.url || !sender.url.startsWith(chrome.runtime.getURL(''))) {
    return;
  }
  if (request && request.method === 'update-icon') {
    chrome.proxy.settings.get({}, config => self.icon(config, 'popup-open'));
  }
});

// pref changes
chrome.storage.onChanged.addListener((ps, area) => {
  if (area !== 'local') {
    return;
  }
  if (Object.keys(ps).some(k => k.startsWith('color-'))) {
    chrome.proxy.settings.get({}, config => self.icon(config, 'pref-changes'));
  }
});
