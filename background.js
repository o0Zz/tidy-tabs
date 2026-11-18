const DEFAULTS = { maxTabs: 20, whenFull: 'block', singleWindow: true };

// How many times each tab was activated, for the "least accessed" mode.
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const { uses = {} } = await chrome.storage.session.get('uses');
  uses[tabId] = (uses[tabId] ?? 0) + 1;
  await chrome.storage.session.set({ uses });
});

async function tabToClose(mode, candidates) {
  if (mode === 'block' || candidates.length === 0) return null;
  const { uses = {} } = await chrome.storage.session.get('uses');
  const score = {
    'least-recently-used': (t) => t.lastAccessed,
    'least-accessed': (t) => (uses[t.id] ?? 0) * 1e15 + t.lastAccessed,
    oldest: (t) => t.id,
  }[mode];
  return candidates.reduce((a, b) => (score(b) < score(a) ? b : a));
}

chrome.tabs.onCreated.addListener(async (tab) => {
  const settings = await chrome.storage.sync.get(DEFAULTS);
  const windows = await chrome.windows.getAll({ windowTypes: ['normal'], populate: true });
  const win = windows.find((w) => w.id === tab.windowId);
  if (!win) return; // popup, app or devtools window: leave it alone

  const tabs = windows.flatMap((w) => w.tabs);
  if (tabs.length > settings.maxTabs) {
    // Never close the tab being looked at, a pinned tab or one playing sound.
    const candidates = tabs.filter((t) => t.id !== tab.id && !t.active && !t.pinned && !t.audible);
    const victim = await tabToClose(settings.whenFull, candidates);
    if (!victim) {
      await chrome.tabs.remove(tab.id);
      return;
    }
    await chrome.tabs.remove(victim.id);
  }

  if (!settings.singleWindow) return;

  // The main window is the oldest normal window of the same profile mode.
  const main = windows.filter((w) => w.incognito === win.incognito).sort((a, b) => a.id - b.id)[0];
  if (main.id === win.id) return;

  await chrome.tabs.move(tab.id, { windowId: main.id, index: -1 });
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(main.id, { focused: true });
});
