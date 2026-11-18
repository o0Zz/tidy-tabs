# Tidy Tabs

A small Chrome extension (Manifest V3) that keeps tabs under control.

## Features

Settings are in the toolbar popup:

- **Tab limit** (default 20) and what happens when it is reached:
  - *Close least recently used*, *Close least accessed* or *Close oldest*: an existing tab is closed to make room. The active tab, pinned tabs and tabs playing sound are never closed. **Chrome does not warn about unsaved input**: pin a tab that holds a draft.
  - *Block new tabs from opening* (default): the new tab is closed and existing tabs are never touched.
- **Single window** (default on): new browser windows are merged into the main window as tabs. Popups (e.g. Microsoft / Azure login) are left alone, and you can still drag a tab out on purpose.
- **Group suggestions**: when a site (e.g. `dev.azure.com`) has 4 or more ungrouped tabs, the toolbar icon shows a badge and the popup suggests a group.
  - *Group*: the site's tabs go into a tab group named after it, and new tabs on that site join the group automatically.
  - *Ignore*: the site is never suggested again.

**More options** (settings page): the suggestion threshold, and the lists of grouped and ignored sites, each with a *Remove* button.

## Install (developer mode)

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this folder.

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
