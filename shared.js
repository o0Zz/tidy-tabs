export const DEFAULTS = {
  maxTabs: 20,
  whenFull: 'block',
  singleWindow: true,
  groupThreshold: 4,
  groupSites: [],
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

// Sites with at least `groupThreshold` ungrouped tabs that are neither a rule nor ignored.
export async function suggestions() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  const tabs = await chrome.tabs.query({ windowType: 'normal', groupId: chrome.tabGroups.TAB_GROUP_ID_NONE });
  const counts = {};
  for (const host of tabs.map(hostOf)) if (host) counts[host] = (counts[host] ?? 0) + 1;
  return Object.entries(counts)
    .filter(([host, count]) => count >= s.groupThreshold && !s.groupSites.includes(host) && !s.ignoredSites.includes(host))
    .map(([host, count]) => ({ host, count }));
}
