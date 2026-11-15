/* globals app, prefs */
'use strict';

const SUPPORTED = ['direct', 'pac_script'];

function update(callback = function() {}) {
  const _ = chrome.i18n.getMessage;
  chrome.proxy.settings.get({}, ({value}) => {
    app.emit('proxy-changed', value.mode);

    callback(value.mode, {value});
    if (value.mode === 'pac_script') {
      app.emit('update-description', _('modePACMSG'));
    }
    else if (value.mode === 'direct') {
      app.emit('update-description', _('modeDirectMSG'));
    }
    else {
      app.emit('update-description', _('modeOtherMSG'));
    }
  });
}

// initialization
update((mode, config) => {
  const pac = document.querySelector('pac-view');
  customElements.whenDefined('pac-view').then(() => {
    if (mode === 'pac_script' && config.value.pacScript) {
      if (config.value.pacScript.url) {
        pac.set('href', config.value.pacScript.url, true);
        return app.storage({
          'script': false
        }).then(ps => {
          if (prefs.isScript(ps.script)) {
            pac.set('script', ps.script, false);
          }
        });
      }
      else if (config.value.pacScript.data) {
        pac.set('script', config.value.pacScript.data, true);
        return app.storage({
          'last-pac': false
        }).then(ps => {
          if (prefs.isHttpsUrl(ps['last-pac'])) {
            pac.set('href', ps['last-pac'], false);
          }
        });
      }
    }
    else {
      return app.storage({
        'script': false,
        'last-pac': false,
        'pac-type': 'url'
      }).then(ps => {
        if (prefs.isHttpsUrl(ps['last-pac'])) {
          pac.set('href', ps['last-pac'], ps['pac-type'] === 'url');
        }
        if (prefs.isScript(ps.script)) {
          pac.set('script', ps.script, ps['pac-type'] === 'data');
        }
      });
    }
  }).then(() => document.body.dataset.ready = true);
});

const proxy = {};
proxy.pac = () => {
  const view = document.querySelector('pac-view');
  const value = {
    mode: 'pac_script',
    pacScript: {
      mandatory: true
    }
  };
  if (view.mode === 'href') {
    const url = view.get('href');
    if (!prefs.isHttpsUrl(url)) {
      throw Error('PAC URL must be a valid https:// address');
    }
    value.pacScript.url = url;
  }
  else {
    const script = view.get('script');
    if (!prefs.isScript(script)) {
      throw Error('PAC script must define FindProxyForURL (max 512 KB)');
    }
    value.pacScript.data = script;
  }
  return {value};
};

app.on('change-proxy', mode => {
  try {
    if (SUPPORTED.includes(mode) === false) {
      throw Error('Unsupported proxy mode: ' + mode);
    }
    const config = mode === 'pac_script' ? proxy.pac() : {value: {mode: 'direct'}};
    chrome.proxy.settings.set(config, () => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        app.emit('notify', lastError.message);
        update();
      }
      else {
        update(m => {
          if (m !== mode) {
            app.emit('notify', 'Cannot set this proxy type! (controlled by another extension or policy?)');
          }
        });
      }
    });
  }
  catch (e) {
    // proxy was NOT changed: show the real mode in the tabs, but keep the PAC panel
    // open so the input can be fixed
    app.emit('notify', e.message || e);
    update(() => {
      if (mode === 'pac_script') {
        app.emit('show-panel', 'pac');
      }
    });
  }
});

chrome.proxy.onProxyError.addListener(e => {
  app.emit('notify', e.error + (e.details ? ': ' + e.details : ''));
});

chrome.runtime.sendMessage({
  method: 'update-icon'
});
