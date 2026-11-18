const DEFAULTS = { maxTabs: 20, whenFull: 'block', singleWindow: true };

const maxTabs = document.getElementById('maxTabs');
const singleWindow = document.getElementById('singleWindow');
const radios = document.querySelectorAll('input[name=whenFull]');

chrome.storage.sync.get(DEFAULTS).then((s) => {
  maxTabs.value = String(s.maxTabs);
  singleWindow.checked = s.singleWindow;
  for (const r of radios) r.checked = r.value === s.whenFull;
});

maxTabs.addEventListener('change', () => chrome.storage.sync.set({ maxTabs: Number(maxTabs.value) }));
singleWindow.addEventListener('change', () => chrome.storage.sync.set({ singleWindow: singleWindow.checked }));
for (const r of radios) r.addEventListener('change', () => chrome.storage.sync.set({ whenFull: r.value }));
