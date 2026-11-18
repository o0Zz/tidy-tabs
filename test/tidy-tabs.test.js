import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import puppeteer from 'puppeteer';

const extensionPath = path.resolve(import.meta.dirname, '..');
let browser;
let worker;

beforeEach(async () => {
  browser = await puppeteer.launch({
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  const target = await browser.waitForTarget((t) => t.type() === 'service_worker');
  worker = await target.worker();
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

test('the popup saves the settings', async () => {
  const id = new URL(worker.url()).host;
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${id}/popup.html`);

  await page.waitForFunction(() => document.querySelector('input[value=block]').checked);
  await page.select('#maxTabs', '40');
  await page.click('input[value=oldest]');
  await page.click('#singleWindow');
  await sleep(300);

  assert.deepEqual(await run(() => chrome.storage.sync.get(null)), { maxTabs: 40, whenFull: 'oldest', singleWindow: false });
});
