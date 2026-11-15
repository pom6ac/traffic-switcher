/* globals app, prefs */
'use strict';

// colors
app.storage({
  'color-direct': '#000000',
  'color-pac_script_url': '#fb9426'
}).then(ps => {
  const set = (selector, color) => {
    if (prefs.isColor(color)) {
      document.querySelector(selector).style['border-top-color'] = color;
    }
  };
  set('#tabs li.no-proxy', ps['color-direct']);
  set('#tabs li.pac-proxy', ps['color-pac_script_url']);
});

const click = ({target, isTrusted}) => {
  // select radio buttons on focus
  const id = target.getAttribute('for');
  if (id) {
    const elem = document.getElementById(id);
    elem.checked = true;
    if (elem.dataset.mode) {
      app.emit('change-proxy', elem.dataset.mode);
    }
  }
  // change proxy type
  const mode = target.dataset.mode;
  if (mode && isTrusted) {
    app.emit('change-proxy', mode);
  }
};
document.addEventListener('click', click);

app.on('proxy-changed', mode => {
  const tab = document.querySelector(`#tabs [data-mode="${mode === 'pac_script' ? 'pac_script' : 'direct'}"]`);
  const supported = mode === 'direct' || mode === 'pac_script';
  const open = tab.dataset.open;

  const body = document.getElementById(open);
  [...document.querySelectorAll('.body')].filter(b => b !== body)
    .forEach(b => b.classList.add('hide'));
  body.classList.remove('hide');
  if (supported) {
    tab.previousElementSibling.checked = true;
  }
  else {
    // a mode set by someone else (system, another extension, ...): select no tab
    document.querySelectorAll('#tabs input').forEach(i => i.checked = false);
  }
});

app.on('notify', msg => {
  const n = document.getElementById('notify');
  msg = msg.error || msg.message || msg;
  const div = document.createElement('div');
  div.textContent = (new Date()).toTimeString().split(' ')[0] + ': ' + msg;
  n.textContent = '';
  n.appendChild(div);
  div.scrollIntoView();
  window.setTimeout(() => div.remove(), 5000);
});

document.getElementById('options').onclick = e => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
};
document.addEventListener('keydown', e => {
  const meta = e.ctrlKey || e.metaKey;
  if (meta && (e.code === 'Digit1' || e.code === 'Digit2')) {
    e.preventDefault();
    click({
      target: document.querySelector(`#tabs label:nth-child(${e.code.slice(-1)}) li`),
      isTrusted: true
    });
  }
});
