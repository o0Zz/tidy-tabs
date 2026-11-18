import { DEFAULTS, hostOf, suggestions } from './shared.js';

const NO_GROUP = chrome.tabGroups.TAB_GROUP_ID_NONE;

// Events are handled one at a time: handlers running together would see the same tabs,
// close the same one, or create two groups for a site.
let queue = Promise.resolve();
const serial = (fn) => (...args) => (queue = queue.then(() => fn(...args)).catch(console.error));

// Session memory: activation counts per tab ("least accessed" mode), the last two tabs
// activated in each window, the site each tab is on, and the group created for each site.
const SESSION = { uses: {}, recent: {}, hosts: {}, siteGroups: {} };
const session = () => chrome.storage.session.get(SESSION);

// Tabs already active when the browser starts get no activation event.
const start = serial(async () => {
  const recent = {};
  for (const t of await chrome.tabs.query({ active: true })) recent[t.windowId] = [t.id];
  await chrome.storage.session.set({ recent });
  await updateBadge();
});
chrome.runtime.onStartup.addListener(start);
chrome.runtime.onInstalled.addListener(start);

chrome.tabs.onActivated.addListener(
  serial(async ({ tabId, windowId }) => {
    const { uses, recent } = await session();
    uses[tabId] = (uses[tabId] ?? 0) + 1;
    if (recent[windowId]?.[0] !== tabId) recent[windowId] = [tabId, recent[windowId]?.[0]];
    await chrome.storage.session.set({ uses, recent });
  }),
);

function tabToClose(mode, candidates, uses) {
  if (mode === 'block' || candidates.length === 0) return null;
  const score = {
    'least-recently-used': (t) => t.lastAccessed,
    'least-accessed': (t) => (uses[t.id] ?? 0) * 1e15 + t.lastAccessed,
    oldest: (t) => t.id,
  }[mode];
  return candidates.reduce((a, b) => (score(b) < score(a) ? b : a));
}

chrome.tabs.onCreated.addListener(
  serial(async (tab) => {
    const settings = await chrome.storage.sync.get(DEFAULTS);
    const windows = await chrome.windows.getAll({ windowTypes: ['normal'], populate: true });
    const tabs = windows.flatMap((w) => w.tabs);
    const me = tabs.find((t) => t.id === tab.id);
    if (!me) return; // already closed, or in a popup, app or devtools window: leave it alone

    // This may run after later tabs were opened: count the tabs open when this one was created,
    // i.e. those with a smaller id (ids only grow).
    if (settings.tabLimit && tabs.filter((t) => t.id <= me.id).length > settings.maxTabs) {
      const { uses, recent } = await session();
      // The tab active before this one (it may hold a draft), whether or not this one has been activated yet.
      const [last, previous] = recent[me.windowId] ?? [];
      const left = last === me.id ? previous : last;
      const keep = new Set([me.id, me.openerTabId, left]);
      // Never close the tab being looked at or just left, a pinned tab or one playing sound.
      const candidates = tabs.filter((t) => !keep.has(t.id) && !t.active && !t.pinned && !t.audible);
      const victim = tabToClose(settings.whenFull, candidates, uses);
      if (!victim) return chrome.tabs.remove(me.id);
      await chrome.tabs.remove(victim.id);
    }

    if (!settings.singleWindow) return;

    // The main window is the oldest normal window of the same profile mode.
    const win = windows.find((w) => w.id === me.windowId);
    const main = windows.filter((w) => w.incognito === win.incognito).sort((a, b) => a.id - b.id)[0];
    if (main.id === win.id) return;

    await chrome.tabs.move(me.id, { windowId: main.id, index: -1 });
    await chrome.tabs.update(me.id, { active: true });
    await chrome.windows.update(main.id, { focused: true });
  }),
);

// The site's group in a window: the one created for it (even if renamed), else one titled after it.
async function siteGroup(host, windowId, siteGroups) {
  const groups = await chrome.tabGroups.query({ windowId });
  return groups.find((g) => siteGroups[g.id] === host) ?? groups.find((g) => g.title === host && !(g.id in siteGroups));
}

async function groupTabs(host, windowId, tabIds) {
  const { siteGroups } = await session();
  const group = await siteGroup(host, windowId, siteGroups);
  if (group) return chrome.tabs.group({ groupId: group.id, tabIds });
  const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
  await chrome.tabGroups.update(groupId, { title: host });
  siteGroups[groupId] = host;
  await chrome.storage.session.set({ siteGroups });
}

// Puts the ungrouped, unpinned tabs of a site into its group, one group per window.
// Tabs the user put in another group are left there.
async function groupSite(host) {
  const tabs = (await chrome.tabs.query({ windowType: 'normal', pinned: false, groupId: NO_GROUP })).filter((t) => hostOf(t) === host);
  for (const windowId of new Set(tabs.map((t) => t.windowId))) {
    await groupTabs(host, windowId, tabs.filter((t) => t.windowId === windowId).map((t) => t.id));
  }
}

// Only a change of site moves a tab: browsing within a site leaves it where the user put it.
async function siteChanged(tab) {
  const host = hostOf(tab);
  const { hosts, siteGroups } = await session();
  const before = hosts[tab.id];
  if (host === before) return;
  hosts[tab.id] = host;
  await chrome.storage.session.set({ hosts });

  let { groupId } = tab;
  if (before && groupId !== NO_GROUP && (await siteGroup(before, tab.windowId, siteGroups))?.id === groupId) {
    await chrome.tabs.ungroup(tab.id); // it left its site's group
    groupId = NO_GROUP;
  }
  const { groupSites } = await chrome.storage.sync.get(DEFAULTS);
  if (host && groupSites.includes(host) && groupId === NO_GROUP && !tab.pinned) await groupTabs(host, tab.windowId, [tab.id]);
}

async function updateBadge() {
  const n = (await suggestions()).length;
  await chrome.action.setBadgeText({ text: n ? String(n) : '' });
}

chrome.tabs.onUpdated.addListener(
  serial(async (tabId, change, tab) => {
    if (!change.url && change.groupId === undefined && change.pinned === undefined) return;
    if (change.url) await siteChanged(tab);
    await updateBadge();
  }),
);

chrome.tabs.onRemoved.addListener(
  serial(async (tabId, { windowId, isWindowClosing }) => {
    const { uses, hosts, recent } = await session();
    delete uses[tabId];
    delete hosts[tabId];
    if (isWindowClosing) delete recent[windowId];
    await chrome.storage.session.set({ uses, hosts, recent });
    await updateBadge();
  }),
);

chrome.storage.onChanged.addListener(
  serial(async (changes, area) => {
    if (area !== 'sync') return;
    if (changes.groupSites) {
      const before = changes.groupSites.oldValue ?? [];
      for (const host of changes.groupSites.newValue ?? []) if (!before.includes(host)) await groupSite(host);
    }
    await updateBadge();
  }),
);
