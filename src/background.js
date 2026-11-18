import { DEFAULTS, covers, hostOf, loadRules, ruleFor, saveRules, suggestions } from './shared.js';

const NO_GROUP = chrome.tabGroups.TAB_GROUP_ID_NONE;

// Events are handled one at a time: handlers running together would see the same tabs,
// close the same one, or create two groups for a site.
let queue = Promise.resolve();
const serial = (fn) => (...args) => (queue = queue.then(() => fn(...args)).catch(console.error));

// Session memory: activation counts per tab ("least accessed" mode), the last two tabs
// activated in each window, the site each tab is on, the rule name of each group created for a rule,
// and the sites whose tabs were already grouped.
const SESSION = { uses: {}, recent: {}, hosts: {}, siteGroups: {}, groupedSites: [] };
const allSites = (rules) => rules.flatMap((r) => r.sites);
const session = () => chrome.storage.session.get(SESSION);

// Tabs already active when the browser starts get no activation event.
const start = serial(async () => {
  const recent = {};
  for (const t of await chrome.tabs.query({ active: true })) recent[t.windowId] = [t.id];
  await chrome.storage.session.set({ recent, groupedSites: allSites(await loadRules()) });
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

// A rule's group in a window: the one created for it, else one titled after it.
async function ruleGroup(name, windowId, siteGroups) {
  const groups = await chrome.tabGroups.query({ windowId });
  return groups.find((g) => siteGroups[g.id] === name) ?? groups.find((g) => g.title === name && !(g.id in siteGroups));
}

async function groupTabs(name, windowId, tabIds) {
  const { siteGroups } = await session();
  const group = await ruleGroup(name, windowId, siteGroups);
  if (group) return chrome.tabs.group({ groupId: group.id, tabIds });
  const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
  await chrome.tabGroups.update(groupId, { title: name });
  siteGroups[groupId] = name;
  await chrome.storage.session.set({ siteGroups });
}

// Puts the ungrouped, unpinned tabs on these sites into the rule's group, one group per window.
// Tabs the user put in another group are left there.
async function groupSites(rule, sites) {
  const tabs = (await chrome.tabs.query({ windowType: 'normal', pinned: false, groupId: NO_GROUP })).filter((t) => {
    const host = hostOf(t);
    return host && sites.some((s) => covers(s, host));
  });
  for (const windowId of new Set(tabs.map((t) => t.windowId))) {
    await groupTabs(rule.name, windowId, tabs.filter((t) => t.windowId === windowId).map((t) => t.id));
  }
}

// Only a change of rule moves a tab: browsing within its sites leaves it where the user put it.
async function siteChanged(tab) {
  const host = hostOf(tab);
  const { hosts, siteGroups } = await session();
  const before = hosts[tab.id];
  if (host === before) return;
  hosts[tab.id] = host;
  await chrome.storage.session.set({ hosts });

  const rules = await loadRules();
  const was = ruleFor(before, rules);
  const now = ruleFor(host, rules);
  if (was === now) return;
  let { groupId } = tab;
  if (was && groupId !== NO_GROUP && (await ruleGroup(was.name, tab.windowId, siteGroups))?.id === groupId) {
    await chrome.tabs.ungroup(tab.id); // it left its rule's group
    groupId = NO_GROUP;
  }
  if (now && groupId === NO_GROUP && !tab.pinned) await groupTabs(now.name, tab.windowId, [tab.id]);
}

// Renaming a rule's group in Chrome renames the rule, and its groups in the other windows.
chrome.tabGroups.onUpdated.addListener(
  serial(async (group) => {
    const { siteGroups } = await session();
    const old = siteGroups[group.id];
    if (!old || !group.title || group.title === old) return;
    const rules = await loadRules();
    const rule = rules.find((r) => r.name === old);
    if (!rule || rules.some((r) => r.name === group.title)) return;
    rule.name = group.title;
    for (const [id, name] of Object.entries(siteGroups)) {
      if (name !== old) continue;
      siteGroups[id] = group.title;
      if (Number(id) !== group.id) await chrome.tabGroups.update(Number(id), { title: group.title });
    }
    await chrome.storage.session.set({ siteGroups });
    await saveRules(rules);
  }),
);

chrome.tabGroups.onRemoved.addListener(
  serial(async (group) => {
    const { siteGroups } = await session();
    delete siteGroups[group.id];
    await chrome.storage.session.set({ siteGroups });
  }),
);

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
    if (changes.groupRules || changes.groupSites) {
      // Group the tabs of sites just added to a rule (a renamed rule has no new sites).
      const rules = await loadRules();
      const { groupedSites } = await session();
      for (const rule of rules) {
        const added = rule.sites.filter((s) => !groupedSites.includes(s));
        if (added.length) await groupSites(rule, added);
      }
      await chrome.storage.session.set({ groupedSites: allSites(rules) });
    }
    await updateBadge();
  }),
);
