import { DEFAULTS, suggestions } from './shared.js';

const maxTabs = document.getElementById('maxTabs');
const singleWindow = document.getElementById('singleWindow');
const radios = document.querySelectorAll('input[name=whenFull]');
const list = document.getElementById('suggestions');

chrome.storage.sync.get(DEFAULTS).then((s) => {
  maxTabs.value = String(s.maxTabs);
  singleWindow.checked = s.singleWindow;
  for (const r of radios) r.checked = r.value === s.whenFull;
});

maxTabs.addEventListener('change', () => chrome.storage.sync.set({ maxTabs: Number(maxTabs.value) }));
singleWindow.addEventListener('change', () => chrome.storage.sync.set({ singleWindow: singleWindow.checked }));
for (const r of radios) r.addEventListener('change', () => chrome.storage.sync.set({ whenFull: r.value }));
document.getElementById('options').addEventListener('click', () => chrome.runtime.openOptionsPage());

async function addTo(key, host) {
  const s = await chrome.storage.sync.get(DEFAULTS);
  await chrome.storage.sync.set({ [key]: [...s[key], host] });
  await renderSuggestions();
}

function button(text, onClick) {
  const b = document.createElement('button');
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

async function renderSuggestions() {
  const items = await suggestions();
  list.hidden = items.length === 0;
  list.replaceChildren(
    ...items.map(({ host, count }) => {
      const row = document.createElement('div');
      row.className = 'suggestion';
      row.dataset.host = host;
      const text = document.createElement('span');
      text.textContent = `${count} tabs on ${host}`;
      row.append(text, button('Group', () => addTo('groupSites', host)), button('Ignore', () => addTo('ignoredSites', host)));
      return row;
    }),
  );
}

renderSuggestions();
