# Tidy Tabs

Chrome extension, Manifest V3, plain JavaScript. No build step, no dependencies, no bundler.

## Rules

- Only Chrome extension APIs (`chrome.tabs`, `chrome.windows`, `chrome.tabGroups`, `chrome.storage`). No network calls, no analytics, no remote code.
- Request the minimum permissions. No host permissions unless a feature requires them.
- Closing an existing tab can lose unsaved input (e.g. Azure DevOps comments) without warning. "Block" stays the default mode, and the close modes never pick the active, a pinned or an audible tab.
- Window merging only applies to windows of type `normal`. Popups (OAuth / Microsoft login, Teams) must stay untouched.
- Keep it small: one service worker and the toolbar popup for settings (`chrome.storage.sync`).

## Testing

Every feature ships with tests that drive a real Chrome with the extension loaded (e.g. Puppeteer / Playwright) and assert actual behavior: tab count, window count, groups.

Manual check: `chrome://extensions` → Load unpacked → this folder.
