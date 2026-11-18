import { test, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import puppeteer from 'puppeteer';

const extensionPath = path.resolve(import.meta.dirname, '..');
let browser;
let worker;

// A local site reachable under two host names: localhost and 127.0.0.1.
const server = http.createServer((req, res) => res.end('<title>page</title>'));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
after(() => server.close());
const site = (host) => `http://${host}:${server.address().port}/`;

beforeEach(async () => {
  browser = await puppeteer.launch({
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  const target = await browser.waitForTarget((t) => t.type() === 'service_worker');
  worker = await target.worker();
  await until(() => worker.evaluate(() => Boolean(globalThis.chrome?.windows)));
});

afterEach(() => browser.close());

// Runs fn inside the extension's service worker, with the real chrome.* APIs.
const run = (fn, ...args) => worker.evaluate(fn, ...args);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const settings = (s) => run((s) => chrome.storage.sync.set(s), s);
const newTab = () => run(async () => (await chrome.tabs.create({ url: 'about:blank', active: false })).id);
const activate = async (id) => {
  await run((id) => chrome.tabs.update(id, { active: true }), id);
  await sleep(50); // distinct lastAccessed and activation counts
};

const windows = () =>
  run(async () => (await chrome.windows.getAll({ populate: true })).map((w) => ({ id: w.id, type: w.type, tabs: w.tabs.map((t) => t.id) })));
const tabIds = async () => (await windows()).flatMap((w) => w.tabs).sort((a, b) => a - b);
const firstTab = async () => (await windows())[0].tabs[0];

async function until(check, timeout = 5000) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error('condition not met in time');
    await sleep(100);
  }
}

// Fills up to a limit of 3 tabs (A, B, C), runs the setup, opens a 4th tab and returns the tab that was closed.
async function closedWhenFull(whenFull, setup) {
  await settings({ maxTabs: 3, whenFull });
  const a = await firstTab();
  const b = await newTab();
  const c = await newTab();
  await setup?.({ a, b, c });
  const d = await newTab();
  await sleep(500);
  const remaining = await tabIds();
  assert.equal(remaining.length, 3);
  return { closed: [a, b, c, d].find((id) => !remaining.includes(id)), a, b, c, d };
}

test('a new normal window is merged into the main window', async () => {
  const [main] = await windows();
  await run(() => chrome.windows.create({ url: 'about:blank' }));

  const after = await until(async () => {
    const ws = await windows();
    return ws.length === 1 && ws[0].tabs.length === 2 && ws;
  });
  assert.equal(after[0].id, main.id);
});

test('with single window off, a new window stays', async () => {
  await settings({ singleWindow: false });
  await run(() => chrome.windows.create({ url: 'about:blank' }));
  await sleep(1000);
  assert.equal((await windows()).length, 2);
});

test('a popup window is left alone', async () => {
  await run(() => chrome.windows.create({ url: 'about:blank', type: 'popup' }));
  await sleep(1000);

  const ws = await windows();
  assert.deepEqual(ws.map((w) => w.type).sort(), ['normal', 'popup']);
  assert.equal(ws.find((w) => w.type === 'popup').tabs.length, 1);
});

test('block: new tabs above the limit are blocked and existing tabs are kept', async () => {
  for (let i = 0; i < 19; i++) await newTab();
  const existing = await until(async () => {
    const ids = await tabIds();
    return ids.length === 20 && ids;
  });

  for (let i = 0; i < 5; i++) await newTab();
  await sleep(1000);
  assert.deepEqual(await tabIds(), existing);
});

test('with the tab limit off, tabs above the limit stay open', async () => {
  await settings({ tabLimit: false, maxTabs: 10 });
  for (let i = 0; i < 14; i++) await newTab();
  await until(async () => (await tabIds()).length === 15);
  await sleep(500);
  assert.equal((await tabIds()).length, 15);
});

test('least recently used: closes the tab used longest ago', async () => {
  // B is used after C was created, so C is the least recently used.
  const { closed, c } = await closedWhenFull('least-recently-used', async ({ a, b }) => {
    await activate(b);
    await activate(a);
  });
  assert.equal(closed, c);
});

test('least accessed: closes the tab activated the fewest times', async () => {
  // B is activated twice, C once (and more recently), so C is the least accessed.
  const { closed, c } = await closedWhenFull('least-accessed', async ({ a, b, c }) => {
    for (const id of [b, a, b, a, c, a]) await activate(id);
  });
  assert.equal(closed, c);
});

test('oldest: closes the oldest tab, never the active or a pinned one', async () => {
  // A is active and B is pinned, so the oldest tab that can be closed is C.
  const { closed, c } = await closedWhenFull('oldest', ({ b }) => run((b) => chrome.tabs.update(b, { pinned: true }), b));
  assert.equal(closed, c);
});

test('a new foreground tab never closes the tab it was opened over', async () => {
  // A is active (e.g. holds a draft) and the oldest; opening D in front makes A inactive.
  await settings({ maxTabs: 3, whenFull: 'oldest' });
  const a = await firstTab();
  const b = await newTab();
  await newTab();
  await run(() => chrome.tabs.create({ url: 'about:blank', active: true }));
  await sleep(500);
  const remaining = await tabIds();
  assert.equal(remaining.length, 3);
  assert.ok(remaining.includes(a));
  assert.ok(!remaining.includes(b));
});

test('tabs opened together still respect the limit', async () => {
  await settings({ maxTabs: 3, whenFull: 'least-recently-used' });
  await newTab();
  await newTab();
  await run(() => Promise.all(Array.from({ length: 6 }, () => chrome.tabs.create({ url: 'about:blank', active: false }))));
  await until(async () => (await tabIds()).length === 3);
  await sleep(500);
  assert.equal((await tabIds()).length, 3);
});

test('a sign-in popup opens and shows even at the tab limit', async () => {
  await settings({ maxTabs: 3 });
  const page = (await browser.pages())[0];
  await page.goto(site('localhost'));
  await newTab();
  await newTab();
  await page.evaluate((url) => window.open(url, 'login', 'width=500,height=600'), `${site('127.0.0.1')}login`);
  await sleep(1000);

  const ws = await run(async () => (await chrome.windows.getAll({ populate: true })).map((w) => ({ type: w.type, state: w.state, focused: w.focused, tabs: w.tabs.length })));
  assert.deepEqual(ws.find((w) => w.type === 'popup'), { type: 'popup', state: 'normal', focused: true, tabs: 1 });
  assert.equal(ws.find((w) => w.type === 'normal').tabs, 3);
  const popup = await (await browser.waitForTarget((t) => t.url().endsWith('/login'))).page();
  assert.equal(await popup.evaluate(() => document.visibilityState), 'visible');
});

test('the popup saves the settings', async () => {
  const id = new URL(worker.url()).host;
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${id}/popup.html`);

  await page.waitForFunction(() => document.querySelector('input[value=block]').checked && document.getElementById('tabLimit').checked);
  assert.equal(await page.$eval('#closeWarning', (el) => el.hidden), true);

  await page.select('#maxTabs', '40');
  await page.click('input[value=oldest]');
  await page.waitForFunction(() => !document.getElementById('closeWarning').hidden);
  await page.click('#singleWindow');
  await page.click('#tabLimit');
  await page.waitForFunction(() => document.getElementById('tabLimitSettings').disabled);

  assert.deepEqual(await run(() => chrome.storage.sync.get(null)), { maxTabs: 40, whenFull: 'oldest', singleWindow: false, tabLimit: false });
});

// --- Group suggestions ---

const openSite = (host, n) => Promise.all(Array.from({ length: n }, () => run((url) => chrome.tabs.create({ url, active: false }), site(host))));
const badge = () => run(() => chrome.action.getBadgeText({}));
const extensionPage = async (file) => {
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/${file}`);
  return page;
};
const groups = () =>
  run(async () => {
    const tabs = await chrome.tabs.query({});
    const gs = await chrome.tabGroups.query({});
    return gs.map((g) => ({ title: g.title, tabs: tabs.filter((t) => t.groupId === g.id).length }));
  });

test('a group is suggested once a site reaches 4 tabs', async () => {
  await openSite('127.0.0.1', 3);
  await sleep(1000);
  assert.equal(await badge(), '');

  await openSite('127.0.0.1', 1);
  await openSite('localhost', 3);
  await until(async () => (await badge()) === '1');
});

test('the threshold is set on the settings page', async () => {
  const page = await extensionPage('options.html');
  await page.waitForFunction(() => document.getElementById('groupThreshold').value === '4');
  await page.$eval('#groupThreshold', (el) => {
    el.value = '2';
    el.dispatchEvent(new Event('change'));
  });
  await until(async () => (await run(() => chrome.storage.sync.get('groupThreshold'))).groupThreshold === 2);

  await openSite('localhost', 2);
  await until(async () => (await badge()) === '1');
});

test('accepting a suggestion groups the tabs and new tabs of the site join the group', async () => {
  await openSite('localhost', 4);
  await until(async () => (await badge()) === '1');

  const popup = await extensionPage('popup.html');
  await popup.waitForSelector('.suggestion[data-host=localhost] button');
  const [group] = await popup.$$('.suggestion[data-host=localhost] button');
  await group.click();
  await until(async () => (await groups())[0]?.tabs === 4);

  await openSite('localhost', 1);
  await until(async () => (await groups())[0]?.tabs === 5);
  assert.deepEqual(await groups(), [{ title: 'localhost', tabs: 5 }]);
  assert.equal(await badge(), '');
});

test('ignoring a suggestion hides it for good without grouping', async () => {
  await openSite('localhost', 4);
  await until(async () => (await badge()) === '1');

  const popup = await extensionPage('popup.html');
  await popup.waitForSelector('.suggestion[data-host=localhost] button');
  const [, ignore] = await popup.$$('.suggestion[data-host=localhost] button');
  await ignore.click();
  await until(async () => (await badge()) === '');

  await openSite('localhost', 2);
  await sleep(1000);
  assert.equal(await badge(), '');
  assert.deepEqual(await groups(), []);
  assert.deepEqual((await run(() => chrome.storage.sync.get('ignoredSites'))).ignoredSites, ['localhost']);
});

test('pinned tabs do not count towards a suggestion', async () => {
  const pinned = await openSite('localhost', 3);
  await run((ids) => Promise.all(ids.map((id) => chrome.tabs.update(id, { pinned: true }))), pinned.map((t) => t.id));
  await openSite('localhost', 1);
  await sleep(1000);
  assert.equal(await badge(), '');
});

// Groups localhost through the popup's suggestion, with 4 localhost tabs open.
async function acceptLocalhost() {
  await until(async () => (await badge()) === '1');
  const popup = await extensionPage('popup.html');
  await popup.waitForSelector('.suggestion[data-host=localhost] button');
  await (await popup.$('.suggestion[data-host=localhost] button')).click();
  await until(async () => (await groups()).some((g) => g.title === 'localhost' && g.tabs === 4));
}

test('grouping a site leaves tabs the user grouped alone', async () => {
  const [mine] = await openSite('localhost', 1);
  await run(async (id) => chrome.tabGroups.update(await chrome.tabs.group({ tabIds: [id] }), { title: 'Mine' }), mine.id);
  await openSite('localhost', 4);
  await acceptLocalhost();
  await sleep(500);
  assert.deepEqual((await groups()).sort((a, b) => a.title.localeCompare(b.title)), [
    { title: 'localhost', tabs: 4 },
    { title: 'Mine', tabs: 1 },
  ]);
});

test('an ungrouped tab stays out while browsing its site, and a tab leaves the group when it leaves the site', async () => {
  const tabs = await openSite('localhost', 4);
  await acceptLocalhost();
  const [out, leaver] = tabs.map((t) => t.id);
  const go = (id, url) => run((id, url) => chrome.tabs.update(id, { url }), id, url);
  const groupOf = (id) => run(async (id) => (await chrome.tabs.get(id)).groupId, id);

  await run((id) => chrome.tabs.ungroup(id), out);
  await go(out, `${site('localhost')}other-page`);
  await go(leaver, site('127.0.0.1'));
  await sleep(1000);
  assert.equal(await groupOf(out), -1);
  assert.equal(await groupOf(leaver), -1);
  assert.deepEqual(await groups(), [{ title: 'localhost', tabs: 2 }]);
});

const rules = async () => (await run(() => chrome.storage.sync.get(['groupRules', 'groupSites'])));

test('a group added on the settings page takes its sites and their subdomains', async () => {
  const [stays] = await openSite('localhost', 1);
  await openSite('127.0.0.1', 1);
  await run((url) => chrome.tabs.create({ url, active: false }), site('sub.localhost'));
  await openSite('example.com', 1); // not covered: a site does not cover its parent domain

  const page = await extensionPage('options.html');
  await page.waitForSelector('#groupRules li.empty');
  await page.type('#ruleName', 'ADO');
  await page.type('#ruleSites', `localhost, ${site('127.0.0.1')}some/path`);
  await page.click('#addRule button');
  await page.waitForSelector('#groupRules li[data-name=ADO]');
  assert.deepEqual((await rules()).groupRules, [{ name: 'ADO', sites: ['localhost', '127.0.0.1'] }]);
  await until(async () => (await groups())[0]?.tabs === 3);

  await openSite('127.0.0.1', 1);
  await run((id, url) => chrome.tabs.update(id, { url }), stays.id, site('127.0.0.1')); // moves within the group's sites
  await until(async () => (await groups())[0]?.tabs === 4);
  await sleep(500);
  assert.deepEqual(await groups(), [{ title: 'ADO', tabs: 4 }]);
});

test('renaming a group in Chrome renames it in the settings, also after a restart', async () => {
  await settings({ groupRules: [{ name: 'ADO', sites: ['localhost'] }] });
  await openSite('localhost', 1);
  await until(async () => (await groups())[0]?.title === 'ADO');

  await run(async () => chrome.tabGroups.update((await chrome.tabGroups.query({}))[0].id, { title: 'Azure' }));
  await until(async () => (await rules()).groupRules[0].name === 'Azure');

  await run(() => chrome.storage.session.remove('siteGroups')); // a restart forgets which group was created for which rule
  await openSite('localhost', 1);
  await until(async () => (await groups())[0]?.tabs === 2);
  assert.deepEqual(await groups(), [{ title: 'Azure', tabs: 2 }]);
});

test('grouped sites of version 1.0.0 become groups, removed on the settings page', async () => {
  await settings({ groupSites: ['localhost', 'example.com'] });
  await openSite('localhost', 1);
  await until(async () => (await groups())[0]?.title === 'localhost');

  const page = await extensionPage('options.html');
  await page.waitForSelector('#groupRules li[data-name=localhost] button');
  await page.click('#groupRules li[data-name=localhost] button');
  await until(async () => (await rules()).groupSites === undefined);
  assert.deepEqual(await rules(), { groupRules: [{ name: 'example.com', sites: ['example.com'] }] });
});
