# Tidy Tabs

Chrome extension, Manifest V3, plain JavaScript. No build step, no dependencies, no bundler.

## Rules

- Only Chrome extension APIs (`chrome.tabs`, `chrome.windows`, `chrome.tabGroups`, `chrome.storage`). No network calls, no analytics, no remote code.
- Request the minimum permissions. No host permissions unless a feature requires them.
- Never close or discard a tab the user already has open: the tab limit blocks *new* tabs only, to avoid losing unsaved input (e.g. Azure DevOps comments).
- Window merging only applies to windows of type `normal`. Popups (OAuth / Microsoft login, Teams) must stay untouched.
- Keep it small: one service worker, an options page only when a setting needs one.

## Testing

Every feature ships with tests that drive a real Chrome with the extension loaded (e.g. Puppeteer / Playwright) and assert actual behavior: tab count, window count, groups.

Manual check: `chrome://extensions` → Load unpacked → this folder.
