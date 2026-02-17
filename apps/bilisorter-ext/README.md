# bilisorter-ext

Chrome Extension (Manifest V3, WXT) — the main BiliSorter application.

See [root README](../../README.md) for full documentation, [docs/VISION.md](../../docs/VISION.md) for mission/principles, and [docs/HLD.md](../../docs/HLD.md) for architecture.

## Tech Stack

- **WXT** — extension framework (same as reedle-extension)
- **React 18** — popup UI
- **vanilla CSS** — dark theme matching B站
- **TypeScript** — throughout
- **chrome.storage.local** — persistence (settings, cache, operation log)
- **Claude API** — AI classification (Haiku default)

## Structure

```
entrypoints/
├── background.ts      # Service Worker: cookie extraction, B站 API, Claude API
└── popup/             # Popup UI (React)
    ├── App.tsx         # Main component
    ├── App.css         # Dark theme styles
    ├── index.html
    └── main.tsx
lib/
├── bilibiliApi.ts     # B站 API endpoint wrappers
├── claudeApi.ts       # Claude API wrapper
├── constants.ts
└── types.ts
```
