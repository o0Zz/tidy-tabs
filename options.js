import { DEFAULTS } from './shared.js';

const threshold = document.getElementById('groupThreshold');

threshold.addEventListener('change', () => {
  const n = Number(threshold.value);
  if (n >= 2) chrome.storage.sync.set({ groupThreshold: n });
});

function renderList(key, hosts) {
  const ul = document.getElementById(key);
  if (hosts.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'None';
    ul.replaceChildren(li);
    return;
  }
  ul.replaceChildren(
    ...hosts.map((host) => {
      const li = document.createElement('li');
      li.dataset.host = host;
      const remove = document.createElement('button');
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => chrome.storage.sync.set({ [key]: hosts.filter((h) => h !== host) }));
      li.append(host, remove);
      return li;
    }),
  );
}

async function render() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  threshold.value = String(s.groupThreshold);
  renderList('groupSites', s.groupSites);
  renderList('ignoredSites', s.ignoredSites);
}

chrome.storage.onChanged.addListener(render);
render();
