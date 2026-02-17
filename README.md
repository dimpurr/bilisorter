# 📂 BiliSorter

> AI-powered Chrome extension to organize your Bilibili (哔哩哔哩) favorites effortlessly

## What is BiliSorter?

BiliSorter is an open-source Chrome extension that helps you sort through your messy Bilibili favorites. It uses AI (LLM of your choice) to analyze video content and suggest which collection each video belongs to, then lets you move them with a single click.

**Perfect for when you have hundreds of unsorted videos in your default favorites and need help organizing them!**

Inspired by [RainSorter](https://github.com/dimpurr/rainsorter), which does the same for Raindrop.io bookmarks.

## ✨ Features

- 📚 **Bulk Organization**: Sort through all your default favorites in one place
- 🤖 **AI-Powered**: Get smart collection suggestions based on video title, tags, description, and category
- 🔍 **Quick Review**: See existing items in collections while sorting
- 🖱️ **One-Click Sorting**: Click an AI suggestion badge → video moves instantly
- ✏️ **Manual Override**: Browse or search your collection tree to pick manually
- 📊 **Confidence Scores**: See how confident the AI is about each suggestion
- ↩️ **Operation Log**: Track all moves, review history, batch undo
- 🔒 **Privacy First**: All data stays in your browser. No server, no data collection.

## How It Works

1. **You're already logged in to Bilibili** → BiliSorter reads your session cookie automatically
2. **Loads your favorites** → Fetches all collections + default favorites content
3. **AI analyzes videos** → Sends video metadata (title/tags/category/description) to your configured LLM
4. **Shows suggestions** → Each video gets recommended collections with confidence scores
5. **You decide** → Click a suggestion badge or manually pick a collection
6. **Video moves** → BiliSorter calls Bilibili's API to move the video

## Quick Start

### Prerequisites
- Google Chrome or Microsoft Edge
- A Bilibili account (already logged in)
- An LLM API key (OpenAI, Deepseek, or local Ollama)

### Installation

#### From Source (Development)
```bash
# Clone the repo
git clone https://github.com/dimpurr/bilisorter.git
cd bilisorter/apps/bilisorter-ext

# Install dependencies
pnpm install

# Build the extension
pnpm build

# Load in Chrome:
# 1. Go to chrome://extensions/
# 2. Enable "Developer mode"
# 3. Click "Load unpacked"
# 4. Select the dist/ folder
```

### Configuration

1. Click the BiliSorter extension icon
2. Go to Settings
3. Configure your AI provider:
   - **OpenAI**: Enter your API key + model (e.g. `gpt-4o-mini`)
   - **Deepseek**: Enter your API key
   - **Ollama**: Set your local endpoint (e.g. `http://localhost:11434`)

## Usage

### Main Workflow

1. **Open Side Panel** → Click the BiliSorter icon or use keyboard shortcut
2. **Load Favorites** → Your default favorites load automatically
3. **Fetch AI Suggestions** → Click "✨ Fetch Suggestions"
4. **Sort Videos**:
   - 🤖 Click an AI suggestion badge → moves video to that collection
   - ✏️ Click the edit icon → manually browse/search collections
5. **Filter & Review** → Click collections in sidebar to filter, preview existing items

### Understanding the UI

```
┌─────────────┬──────────────────────────────────┐
│  Sidebar    │  Video List                      │
│             │                                  │
│ All (142)   │ ┌──────────────────────────────┐ │
│ ❌ None (8) │ │ Video Title                  │ │
│ ─────────── │ │ UP主 · 分区 · 2024-01-15     │ │
│ 📁 Tech(23) │ │ Tags: [tag1] [tag2]          │ │
│ 📁 Music(15)│ │ AI: [Tech 85%] [Code 62%] ✏️│ │
│ 📁 Game(31) │ └──────────────────────────────┘ │
│   📄 FPS(7) │ ┌──────────────────────────────┐ │
│   📄 RPG(12)│ │ ...                          │ │
│ 📁 Anime(18)│ └──────────────────────────────┘ │
└─────────────┴──────────────────────────────────┘
```

## Architecture

```
bilisorter/
├── apps/
│   └── bilisorter-ext/          # Chrome Extension (Manifest V3)
│       ├── src/
│       │   ├── background/      # Service Worker (cookie access, API calls)
│       │   ├── sidepanel/       # Side Panel UI (React + Jotai)
│       │   │   ├── components/  # VideoRow, Sidebar, CollectionSelector...
│       │   │   ├── hooks/       # useVideos, useSuggestions, useCollections...
│       │   │   ├── services/    # bilibiliApi, llmService
│       │   │   └── store/       # Jotai atoms
│       │   ├── popup/           # Minimal popup (status + open side panel)
│       │   └── options/         # Settings page (LLM config)
│       ├── manifest.json        # MV3 manifest
│       └── vite.config.ts       # CRXJS Vite plugin
├── docs/                        # Documentation
│   └── research.md              # Technical research & API reference
└── README.md
```

### Tech Stack
- **UI Framework**: React 18 + Vite
- **Extension Framework**: CRXJS Vite Plugin (Manifest V3)
- **State Management**: Jotai (with localStorage persistence)
- **Data Cache**: IndexedDB (via idb)
- **Styling**: Vanilla CSS (dark theme matching Bilibili)
- **AI Integration**: OpenAI-compatible API (user-provided key)

### Key Design Decisions

- **Chrome Extension (MV3)**: Enables zero-friction auth via `chrome.cookies` — no need for users to copy-paste tokens
- **Side Panel**: Provides ample UI space (~400px width) without leaving the browser context
- **No Backend Server**: Everything runs in the browser. Cookie never leaves the user's machine.
- **Jotai + localStorage**: Persistent state across extension restarts
- **Batched API Calls**: 3 concurrent + 300ms delay to avoid Bilibili rate limiting
- **Operation Logging**: All move operations logged to IndexedDB for review/undo

## FAQ

**Q: Will this delete my videos or favorites?**
A: No! It only moves videos between existing collection folders. Nothing is deleted.

**Q: Is my data safe?**
A: Yes! BiliSorter runs entirely in your browser. Your Bilibili session cookie and API keys never leave your machine. No server, no analytics, no tracking.

**Q: Why a Chrome extension?**
A: Bilibili has no official public API. A Chrome extension can securely access your existing login session without requiring you to manually extract cookies.

**Q: Which AI models work?**
A: Any OpenAI-compatible API. We recommend Deepseek (cheap & good at Chinese) or GPT-4o-mini. You can also use local models via Ollama.

**Q: Does Bilibili allow this?**
A: BiliSorter is a personal tool that performs the same actions you could do manually (moving videos between favorites). It does not scrape, download, or redistribute any content. However, it uses undocumented APIs, so use at your own discretion.

## Related Projects

- [RainSorter](https://github.com/dimpurr/rainsorter) — AI-powered Raindrop.io bookmark organizer (our inspiration)
- [bilibili-API-collect](https://github.com/SocialSisterYi/bilibili-API-collect) — B站 API 文档 (archived)
- [bilibili-favorites](https://github.com/RadiumAg/bilibili-favorites) — Chrome extension for B站收藏夹管理
- [bilibo](https://github.com/BoredTape/bilibo) — B站收藏夹同步下载工具

## Contributing

Issues and pull requests welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

MIT — Free to use, modify, and distribute.

---

Made with ☕ for the Bilibili community
