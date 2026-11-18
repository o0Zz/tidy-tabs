# Tidy Tabs

A small Chrome extension (Manifest V3) that keeps tabs under control.

## Features

Settings are in the toolbar popup:

- **Tab search**: the popup opens with the cursor in a search box. Type to list the tabs whose title, address or group name contain every word you typed; the list narrows as you type. Click a result, or pick it with the arrow keys and press Enter, to switch to that tab (and its window). Escape clears the search.
- **Tab limit** (on/off switch, default on, 20 tabs) and what happens when it is reached:
  - *Close least recently used*, *Close least accessed* or *Close oldest*: an existing tab is closed to make room. The active tab, the tab you just left for the new one, pinned tabs and tabs playing sound are never closed. **Chrome does not warn about unsaved input**: pin a tab that holds a draft.
  - *Block new tabs from opening* (default): the new tab is closed and existing tabs are never touched.
- **Single window** (on/off switch, default on): new browser windows are merged into the main window as tabs. Popups (e.g. Microsoft / Azure login) are left alone, and you can still drag a tab out on purpose.
- **Group suggestions**: when a site (e.g. `dev.azure.com`) has 4 or more ungrouped tabs, the toolbar icon shows a badge and the popup suggests a group.
  - *Group*: the site's ungrouped tabs go into a tab group named after it, and tabs that arrive on that site join the group automatically.
  - *Ignore*: the site is never suggested again.
- **Groups** (settings page): add a group by hand, e.g. *ADO* = `dev.azure.com, visualstudio.com`. A site covers its subdomains (`visualstudio.com` covers `oceasoft.visualstudio.com`). Renaming the group in Chrome renames it in the settings. Tabs you put in another group, or take out of it, stay where you put them.

**Group settings** (settings page): the suggestion threshold, the groups and the ignored sites (a site covers its subdomains), with *Add* and *Remove* buttons.

## Install (developer mode)

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `src` folder, or the unzipped `tidy-tabs-vX.Y.Z.zip` of a [release](https://github.com/o0Zz/tidy-tabs/releases).

## Release

Push a tag: `git tag v1.2.0 && git push origin v1.2.0`. The GitHub workflow sets the manifest version from the tag (`src/manifest.json` stays at `0.0.0` in the repo), runs the tests and attaches `tidy-tabs-v1.2.0.zip` to a GitHub release.

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
