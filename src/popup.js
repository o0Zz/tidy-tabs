import { DEFAULTS, loadRules, ruleFor, saveRules, shortcut, suggestions } from './shared.js';

const $ = (id) => document.getElementById(id);
const radios = document.querySelectorAll('input[name=whenFull]');
const save = (values) => chrome.storage.sync.set(values);

$('version').textContent = `v${chrome.runtime.getManifest().version}`;

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

chrome.storage.onChanged.addListener(async (changes, area) => area === 'sync' && showState(await chrome.storage.sync.get(DEFAULTS)));

$('tabLimit').addEventListener('change', (e) => save({ tabLimit: e.target.checked }));
$('maxTabs').addEventListener('change', (e) => save({ maxTabs: Number(e.target.value) }));
$('singleWindow').addEventListener('change', (e) => save({ singleWindow: e.target.checked }));
for (const r of radios) r.addEventListener('change', () => save({ whenFull: r.value }));
$('options').addEventListener('click', () => chrome.runtime.openOptionsPage());

// "Merge N other windows into this one", shown when other normal windows are open.
async function showMerge() {
  const current = await chrome.windows.getCurrent();
  const others = (await chrome.windows.getAll({ windowTypes: ['normal'] })).filter((w) => w.id !== current.id && w.incognito === current.incognito);
  $('merge').hidden = others.length === 0;
  $('merge').textContent = `Merge ${others.length} other window${others.length > 1 ? 's' : ''} into this one`;
}

$('merge').addEventListener('click', async () => {
  $('merge').disabled = true;
  await chrome.runtime.sendMessage({ mergeInto: (await chrome.windows.getCurrent()).id });
  $('merge').disabled = false;
  await showMerge();
});

showMerge();

// Group: a rule named after the site. Ignore: the site is never suggested again.
async function accept(host) {
  const rules = await loadRules();
  if (!ruleFor(host, rules)) await saveRules([...rules, { name: host, sites: [host] }]);
  await renderSuggestions();
}

async function ignore(host) {
  const { ignoredSites } = await chrome.storage.sync.get(DEFAULTS);
  if (!ignoredSites.includes(host)) await save({ ignoredSites: [...ignoredSites, host] });
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
      const choose = (action) => () => {
        row.remove(); // a second click cannot add the site twice
        action(host);
      };
      row.append(text, button('Group', 'btn primary', choose(accept)), button('Ignore', 'btn', choose(ignore)));
      return row;
    }),
  );
}

renderSuggestions();

// --- Tab search: every word typed must appear in the tab's title, address or group name ---

const search = $('search');
const tabsAndGroups = Promise.all([chrome.tabs.query({}), chrome.tabGroups.query({})]);
let found = [];
let selected = 0;

function select(index) {
  selected = index;
  const items = $('results').children;
  for (let i = 0; i < items.length; i++) items[i].classList.toggle('selected', i === selected);
  items[selected]?.scrollIntoView({ block: 'nearest' });
}

async function switchTo(tab) {
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  window.close();
}

function resultItem(tab, groupName) {
  const li = document.createElement('li');
  li.dataset.tab = tab.id;
  const title = document.createElement('div');
  title.className = 'title';
  const text = document.createElement('span'); // ellipsized, so a long title never hides the group name
  text.textContent = tab.title || tab.url;
  title.append(text);
  if (groupName) {
    const group = document.createElement('span');
    group.className = 'group';
    group.textContent = groupName;
    title.append(group);
  }
  const url = document.createElement('div');
  url.className = 'url';
  url.textContent = (tab.url || tab.pendingUrl || '').replace(/^https?:\/\//, '');
  li.title = tab.url || '';
  li.append(title, url);
  li.addEventListener('click', () => switchTo(tab));
  return li;
}

async function renderResults() {
  const words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
  $('settings').hidden = words.length > 0;
  $('results').hidden = words.length === 0;
  const [tabs, groups] = await tabsAndGroups;
  const groupNames = Object.fromEntries(groups.map((g) => [g.id, g.title ?? '']));
  const inTitle = (tab) => words.every((w) => (tab.title ?? '').toLowerCase().includes(w));
  found = tabs
    .filter((tab) => {
      const text = `${tab.title} ${tab.url || tab.pendingUrl} ${groupNames[tab.groupId] ?? ''}`.toLowerCase();
      return words.length > 0 && words.every((w) => text.includes(w));
    })
    .sort((a, b) => inTitle(b) - inTitle(a)); // title matches first, then tab order
  if (found.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'No tab matches.';
    $('results').replaceChildren(empty);
  } else {
    $('results').replaceChildren(...found.map((tab) => resultItem(tab, groupNames[tab.groupId])));
  }
  select(0);
}

search.addEventListener('input', renderResults);
search.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (found.length) select((selected + (e.key === 'ArrowDown' ? 1 : found.length - 1)) % found.length);
  } else if (e.key === 'Enter' && found[selected]) {
    switchTo(found[selected]);
  } else if (e.key === 'Escape' && search.value) {
    e.preventDefault(); // clears the search instead of closing the popup
    search.value = '';
    renderResults();
  }
});
search.focus();
shortcut().then((keys) => keys && (search.placeholder = `Search tabs (${keys})`));
