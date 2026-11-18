# Tidy Tabs

A small Chrome extension (Manifest V3) that keeps tabs under control.

## Features

- **One window**: new browser windows are merged into the main window as tabs. Popups (e.g. Microsoft / Azure login) are left alone.
- **Tab limit**: once the maximum number of tabs is reached, new tabs are blocked. Existing tabs are never closed, so no unsaved work is lost.

Planned:

- **Auto-grouping**: put tabs into tab groups by domain rules (e.g. `dev.azure.com` → "Azure", blue).

## Install (developer mode)

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this folder.

The tab limit is `MAX_TABS` at the top of `background.js` (default 20). Reload the extension after changing it.

## Tests

```
npm install
npm test
```

The tests launch Chrome for Testing with the extension loaded and check real tab and window counts.

## Recommended Chrome settings

Tidy Tabs limits tabs and windows, not memory. For RAM, also:

- `chrome://settings/performance` → **Memory Saver** on, **Maximum**.
- Add `dev.azure.com` and `visualstudio.com` (and any site where you write long text) to **Always keep these sites active**.
