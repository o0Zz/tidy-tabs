const MAX_TABS = 20;

chrome.tabs.onCreated.addListener(async (tab) => {
  const windows = await chrome.windows.getAll({ windowTypes: ['normal'], populate: true });
  const win = windows.find((w) => w.id === tab.windowId);
  if (!win) return; // popup, app or devtools window: leave it alone

  const tabCount = windows.reduce((n, w) => n + w.tabs.length, 0);
  if (tabCount > MAX_TABS) {
    await chrome.tabs.remove(tab.id);
    return;
  }

  // The main window is the oldest normal window of the same profile mode.
  const main = windows.filter((w) => w.incognito === win.incognito).sort((a, b) => a.id - b.id)[0];
  if (main.id === win.id) return;

  await chrome.tabs.move(tab.id, { windowId: main.id, index: -1 });
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(main.id, { focused: true });
});
