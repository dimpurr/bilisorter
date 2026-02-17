# 📂 BiliSorter

> AI-powered Chrome extension to organize your Bilibili (哔哩哔哩) favorites — sort hundreds of unsorted videos in minutes, not hours.

## What is BiliSorter?

BiliSorter is an open-source Chrome extension that helps you sort through your messy Bilibili favorites. It uses AI (Claude) to analyze video metadata and suggest which collection each video belongs to, then lets you move them with a single click + 5-second undo.

**Perfect for when you have hundreds of unsorted videos in your default favorites and need help organizing them!**

Inspired by [RainSorter](https://github.com/dimpurr/rainsorter), which does the same for Raindrop.io bookmarks.

## ✨ Features

- 📚 **Bulk Organization**: Index your default favorites (or any folder) and sort them all in one session
- 🤖 **AI-Powered**: Get 5 ranked folder suggestions per video based on title, tags, UP主, and description
- 🖼 **Visual Cards**: Video thumbnails, UP主, play count — see what you're sorting at a glance
- 🖱️ **One-Click Move**: Click a suggestion badge → video moves to that folder instantly
- ⏪ **5s Undo Toast**: Every move shows a stackable toast with 5-second undo window — click fast, undo any
- 📤 **JSON Export**: Export your indexed video list (with AI suggestions) as JSON
- 📋 **Operation Log**: Permanent read-only log of all moves — "《Video》→ [Folder]" with timestamps
- 🔒 **Privacy First**: No backend. Cookie never leaves the browser. Only external call is your own Claude API key.

## How It Works

1. **You're already logged in to Bilibili** → BiliSorter reads your session cookie automatically
2. **Click "📥 索引"** → Fetches all your folders (with 10 sample video titles each) + all videos from your selected source folder
3. **Click "✨ 建议"** → Sends video metadata to Claude in batches of 5-10, returns 5 ranked folder suggestions per video
4. **Click a suggestion badge** → 5s undo toast appears → after 5s, video moves via B站 API
5. **Review** → Open operation log to see history, or export JSON

## Architecture

```
bilisorter/
├── apps/
│   └── bilisorter-ext/           # WXT Chrome Extension (Manifest V3)
│       ├── entrypoints/
│       │   ├── background.ts     # Service Worker: cookie, B站 API, Claude API
│       │   └── popup/            # Popup UI (React + vanilla CSS)
│       │       ├── App.tsx
│       │       ├── App.css
│       │       ├── index.html
│       │       └── main.tsx
│       ├── lib/
│       │   ├── bilibiliApi.ts    # B站 API wrappers
│       │   ├── claudeApi.ts      # Claude API wrapper
│       │   ├── constants.ts
│       │   └── types.ts
│       ├── public/icon/
│       ├── wxt.config.ts
│       └── package.json
└── docs/
    ├── VISION.md                 # Why — mission, principles, product shape
    ├── HLD.md                    # What — architecture, flows, UI, data model
    ├── discussion.md             # Tech/feature debate record
    └── research-log-n-suggestion.md  # API reference, competitive analysis (backlog)
```

### Tech Stack

| Layer | Technology |
|-------|------------|
| Extension framework | WXT |
| UI | React 18 + vanilla CSS |
| State | React useState (no state library) |
| Persistence | chrome.storage.local |
| AI | Claude API (Haiku default, Sonnet optional) |
| Build | Vite (via WXT) |
| Language | TypeScript |

### Key Design Decisions

- **WXT framework**: Same stack as reedle-extension — proven, HMR, cross-browser
- **Popup-only UI**: No content script, no side panel. Popup is the single interaction surface
- **Cookie-based auth**: `chrome.cookies` reads existing B站 session — zero-friction, no OAuth
- **No backend**: All API calls (B站 + Claude) happen in the background service worker
- **useState, not Jotai**: Popup state is simple enough that React useState + chrome.storage.local suffices
- **5 suggestions always**: LLM returns exactly 5 ranked folder suggestions per video — never a dead-end

## FAQ

**Q: Will this delete my videos or favorites?**
A: No. It only moves videos between existing folders. Nothing is deleted.

**Q: Is my data safe?**
A: Yes. BiliSorter runs entirely in your browser. Your B站 cookie and Claude API key never leave your machine.

**Q: Why a Chrome extension?**
A: B站 has no public OAuth. A Chrome extension can securely read your existing session cookie without manual extraction.

**Q: Which AI model?**
A: Claude Haiku (default) or Sonnet. Configure your Claude API key in the extension's settings. Multi-provider support (Deepseek, OpenAI, Ollama) is planned for v1.

**Q: Does Bilibili allow this?**
A: BiliSorter performs the same actions you'd do manually (moving videos between favorites folders). It uses undocumented APIs — use at your own discretion.

## Related Projects

- [RainSorter](https://github.com/dimpurr/rainsorter) — AI-powered Raindrop.io bookmark organizer (inspiration)
- [bilibili-favorites](https://github.com/RadiumAg/bilibili-favorites) — Chrome extension for B站收藏夹管理
- [bilibo](https://github.com/BoredTape/bilibo) — B站收藏夹同步下载工具

## License

MIT — Free to use, modify, and distribute.

---

Made with ☕ for the Bilibili community
