export const DEFAULTS = {
  tabLimit: true,
  maxTabs: 20,
  whenFull: 'block',
  singleWindow: true,
  groupThreshold: 4,
  groupRules: [], // { name, sites }: tabs on the sites join the group called name
  ignoredSites: [],
};

export function hostOf(tab) {
  try {
    const url = new URL(tab.url || tab.pendingUrl);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.hostname : null;
  } catch {
    return null;
  }
}

// A site covers itself and its subdomains.
export const covers = (site, host) => host === site || host.endsWith(`.${site}`);
export const ruleFor = (host, rules) => (host ? rules.find((r) => r.sites.some((s) => covers(s, host))) : undefined);

// Version 1.0.0 kept a plain list of sites (`groupSites`): each is read as a rule named after it,
// until the rules are next saved.
export async function loadRules() {
  const { groupRules, groupSites } = await chrome.storage.sync.get({ groupRules: [], groupSites: [] });
  return [...groupRules, ...groupSites.filter((s) => !ruleFor(s, groupRules)).map((s) => ({ name: s, sites: [s] }))];
}

export async function saveRules(groupRules) {
  await chrome.storage.sync.set({ groupRules });
  await chrome.storage.sync.remove('groupSites');
}

// Sites with at least `groupThreshold` ungrouped, unpinned tabs that no rule or ignored site covers.
export async function suggestions() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  const rules = await loadRules();
  const tabs = await chrome.tabs.query({ windowType: 'normal', pinned: false, groupId: chrome.tabGroups.TAB_GROUP_ID_NONE });
  const counts = {};
  for (const host of tabs.map(hostOf)) if (host) counts[host] = (counts[host] ?? 0) + 1;
  return Object.entries(counts)
    .filter(([host, count]) => count >= s.groupThreshold && !ruleFor(host, rules) && !s.ignoredSites.some((i) => covers(i, host)))
    .map(([host, count]) => ({ host, count }));
}
