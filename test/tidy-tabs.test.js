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

const windows = () =>
  run(async () => (await chrome.windows.getAll({ populate: true })).map((w) => ({ id: w.id, type: w.type, tabs: w.tabs.map((t) => t.id) })));

async function until(check, timeout = 5000) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 100));
  }
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

test('a popup window is left alone', async () => {
  await run(() => chrome.windows.create({ url: 'about:blank', type: 'popup' }));
  await new Promise((r) => setTimeout(r, 1000));

  const ws = await windows();
  assert.deepEqual(ws.map((w) => w.type).sort(), ['normal', 'popup']);
  assert.equal(ws.find((w) => w.type === 'popup').tabs.length, 1);
});

test('new tabs above 20 are blocked and existing tabs are kept', async () => {
  for (let i = 0; i < 19; i++) await run(() => chrome.tabs.create({ url: 'about:blank' }));
  const existing = await until(async () => {
    const tabs = (await windows()).flatMap((w) => w.tabs);
    return tabs.length === 20 && tabs;
  });

  for (let i = 0; i < 5; i++) await run(() => chrome.tabs.create({ url: 'about:blank' }));
  await new Promise((r) => setTimeout(r, 1000));

  const tabs = (await windows()).flatMap((w) => w.tabs);
  assert.deepEqual(tabs.sort(), existing.sort());
});
