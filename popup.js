import { DEFAULTS, suggestions } from './shared.js';

const $ = (id) => document.getElementById(id);
const radios = document.querySelectorAll('input[name=whenFull]');
const save = (values) => chrome.storage.sync.set(values);

function showState(s) {
  $('tabLimitSettings').disabled = !s.tabLimit;
  $('closeWarning').hidden = s.whenFull === 'block';
}

chrome.storage.sync.get(DEFAULTS).then((s) => {
  $('tabLimit').checked = s.tabLimit;
  $('maxTabs').value = String(s.maxTabs);
  $('singleWindow').checked = s.singleWindow;
  for (const r of radios) r.checked = r.value === s.whenFull;
  showState(s);
});

chrome.storage.onChanged.addListener(async () => showState(await chrome.storage.sync.get(DEFAULTS)));

$('tabLimit').addEventListener('change', (e) => save({ tabLimit: e.target.checked }));
$('maxTabs').addEventListener('change', (e) => save({ maxTabs: Number(e.target.value) }));
$('singleWindow').addEventListener('change', (e) => save({ singleWindow: e.target.checked }));
for (const r of radios) r.addEventListener('change', () => save({ whenFull: r.value }));
$('options').addEventListener('click', () => chrome.runtime.openOptionsPage());

async function addTo(key, host) {
  const s = await chrome.storage.sync.get(DEFAULTS);
  if (!s[key].includes(host)) await save({ [key]: [...s[key], host] });
  await renderSuggestions();
}

function button(text, className, onClick) {
  const b = document.createElement('button');
  b.textContent = text;
  b.className = className;
  b.addEventListener('click', onClick);
  return b;
}

async function renderSuggestions() {
  const items = await suggestions();
  $('suggestions').hidden = items.length === 0;
  $('suggestionList').replaceChildren(
    ...items.map(({ host, count }) => {
      const row = document.createElement('div');
      row.className = 'suggestion';
      row.dataset.host = host;
      const text = document.createElement('span');
      text.textContent = `${count} tabs on ${host}`;
      const choose = (key) => () => {
        row.remove(); // a second click cannot add the site twice
        addTo(key, host);
      };
      row.append(text, button('Group', 'btn primary', choose('groupSites')), button('Ignore', 'btn', choose('ignoredSites')));
      return row;
    }),
  );
}

renderSuggestions();
