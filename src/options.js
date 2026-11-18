import { DEFAULTS, loadRules, saveRules } from './shared.js';

const $ = (id) => document.getElementById(id);

$('groupThreshold').addEventListener('change', () => {
  const n = Number($('groupThreshold').value);
  if (n >= 2) chrome.storage.sync.set({ groupThreshold: n });
});

// "https://dev.azure.com/org, visualstudio.com" -> ['dev.azure.com', 'visualstudio.com']
function parseSites(text) {
  return text
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((s) => {
      try {
        return new URL(s.includes('://') ? s : `http://${s}`).hostname;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// Adding to an existing group name adds the sites to it; a site moves out of any other group.
$('addRule').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('ruleName').value.trim();
  const sites = parseSites($('ruleSites').value);
  if (!name || sites.length === 0) return;
  const rules = (await loadRules())
    .map((r) => ({ ...r, sites: r.sites.filter((s) => !sites.includes(s)) }))
    .filter((r) => r.sites.length > 0 || r.name === name);
  const rule = rules.find((r) => r.name === name);
  if (rule) rule.sites.push(...sites);
  else rules.push({ name, sites });
  await saveRules(rules);
  $('addRule').reset();
});

$('addIgnored').addEventListener('submit', async (e) => {
  e.preventDefault();
  const { ignoredSites } = await chrome.storage.sync.get(DEFAULTS);
  const sites = parseSites($('ignoreSites').value).filter((s) => !ignoredSites.includes(s));
  if (sites.length) await chrome.storage.sync.set({ ignoredSites: [...ignoredSites, ...sites] });
  $('addIgnored').reset();
});

function emptyItem() {
  const li = document.createElement('li');
  li.className = 'empty';
  li.textContent = 'None';
  return li;
}

function item(label, detail, onRemove) {
  const li = document.createElement('li');
  const text = document.createElement('span');
  text.append(label);
  if (detail) {
    const sites = document.createElement('span');
    sites.className = 'sites';
    sites.textContent = detail;
    text.append(sites);
  }
  const remove = document.createElement('button');
  remove.textContent = 'Remove';
  remove.className = 'btn';
  remove.addEventListener('click', onRemove);
  li.append(text, remove);
  return li;
}

async function render() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  const rules = await loadRules();
  $('groupThreshold').value = String(s.groupThreshold);

  const ruleItems = rules.map((r) => {
    const li = item(r.name, r.sites.join(', '), () => saveRules(rules.filter((x) => x !== r)));
    li.dataset.name = r.name;
    return li;
  });
  $('groupRules').replaceChildren(...(ruleItems.length ? ruleItems : [emptyItem()]));

  const ignoredItems = s.ignoredSites.map((host) => {
    const li = item(host, '', () => chrome.storage.sync.set({ ignoredSites: s.ignoredSites.filter((h) => h !== host) }));
    li.dataset.host = host;
    return li;
  });
  $('ignoredSites').replaceChildren(...(ignoredItems.length ? ignoredItems : [emptyItem()]));
}

chrome.storage.onChanged.addListener(render);
render();
