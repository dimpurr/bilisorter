# BiliSorter - High Level Design

> Chrome extension that uses AI to classify and move Bilibili favorites into organized folders.

---

## Version History

| Version | Summary |
|---------|---------|
| **v0.1** (current) | MVP: cookie auth, fetch folders & videos, Claude AI suggestions, one-click move with 5s undo toast, JSON export, persistent operation log |
| **v1** (planned) | Multi-provider AI (Deepseek, OpenAI, Ollama), batch apply all, create folder from popup, duplicate detection |
| **Future** | Side Panel UI, content script integration, smart folder suggestions, cross-folder analytics |

---

## System Architecture

```
┌────────────────────────────────────────────┐
│  Chrome Extension (Manifest V3, WXT)       │
│                                            │
│  ┌──────────────┐  ┌────────────────────┐  │
│  │ Background   │  │ Popup (React)      │  │
│  │ Service      │  │                    │  │
│  │ Worker       │  │ • Source selector  │  │
│  │              │  │ • Video list       │  │
│  │ • Cookie     │  │ • AI badges       │  │
│  │   extraction │  │ • Undo toast      │  │
│  │ • B站 API    │  │ • Settings        │  │
│  │   calls      │  │ • Log viewer      │  │
│  │ • Claude API │  │ • JSON export     │  │
│  │   calls      │  │                    │  │
│  └──────┬───────┘  └────────┬───────────┘  │
│         │   chrome.runtime.sendMessage     │
│         └──────────────┬───────────────────┘
│                        │                    │
│  ┌─────────────────────┴──────────────────┐│
│  │ chrome.storage.local                   ││
│  │ • Cached video list                    ││
│  │ • Cached folder list                   ││
│  │ • AI suggestions cache                 ││
│  │ • Operation log (permanent)            ││
│  │ • Settings (API key, model)            ││
│  └────────────────────────────────────────┘│
└────────────────────────────────────────────┘
        │                          │
        ▼                          ▼
┌──────────────────┐  ┌─────────────────────┐
│ api.bilibili.com │  │ api.anthropic.com   │
│ (user's cookies) │  │ (user's API key)    │
└──────────────────┘  └─────────────────────┘
```

### Tech Stack

| Layer | Technology |
|-------|------------|
| Extension framework | WXT (same as reedle-extension) |
| UI | React 18 + vanilla CSS |
| State | React useState (no state library) |
| Persistence | chrome.storage.local |
| AI | Claude API (Haiku default, Sonnet optional) |
| Build | Vite (via WXT) |
| Language | TypeScript |

### No Content Script

Unlike reedle-extension (which uses content.ts for session sync with its web app), BiliSorter has **no content script**. All B站 interactions happen via API calls from the background service worker using extracted cookies. This is a deliberate choice — see `discussion.md` §选型3 for the debate.

---

## Authentication

### Cookie-based auth (no OAuth)

B站 does not offer a public OAuth flow. Authentication relies on the user's existing browser session.

**Required cookies** (domain: `.bilibili.com`):

| Cookie | Purpose |
|--------|---------|
| `SESSDATA` | Session authentication token |
| `bili_jct` | CSRF token (required for write operations) |
| `DedeUserID` | User ID (numeric) |

**Auth verification**: On popup open, background calls `GET /x/web-interface/nav` with extracted cookies. If `data.isLogin` is false, popup displays a "请先登录 bilibili.com" message. No further actions are available until the user logs in on B站.

**Cookie extraction**: `chrome.cookies.get({url: 'https://www.bilibili.com', name: 'SESSDATA'})` — requires `cookies` permission and `host_permissions` for `*://*.bilibili.com/*`.

**Comparison with RainSorter/reedle-extension**: No backend proxy, no token refresh, no session sync. Simpler because B站 cookies are long-lived (~30 days) and managed by the browser, not by us.

---

## Manifest Permissions

| Permission | Why |
|------------|-----|
| `cookies` | Read SESSDATA, bili_jct, DedeUserID |
| `storage` | Persist cache, settings, operation log |

| Host Permission | Why |
|-----------------|-----|
| `*://*.bilibili.com/*` | Cookie access scope |
| `https://api.bilibili.com/*` | API fetch from background SW |

No `sidePanel`, `activeTab`, `scripting`, or `webNavigation` needed.

---

## Key Flows

### 1. Popup Open → Auth Check

```
Popup mounts
→ sendMessage({type: 'CHECK_AUTH'})
→ Background: chrome.cookies.get SESSDATA, bili_jct, DedeUserID
  → If any missing: respond {loggedIn: false}
  → If present: GET /x/web-interface/nav with SESSDATA
    → data.isLogin === true: respond {loggedIn: true, uid, username}
    → data.isLogin === false: respond {loggedIn: false} (cookie expired)
→ Popup: loggedIn ? show main UI : show "请先登录 bilibili.com"
```

### 2. Index Favorites (Fetch Folders + Videos)

```
User clicks "📥 索引收藏夹"
→ sendMessage({type: 'FETCH_FOLDERS'})
→ Background: GET /x/v3/fav/folder/created/list-all?up_mid={uid}
→ Background: for each folder, GET /x/v3/fav/resource/list (ps=10, pn=1)
  → Extract titles of up to 10 videos as sample
  → Store as folder.sampleTitles: string[]
→ Popup: display folder dropdown (default: 默认收藏夹)

→ sendMessage({type: 'FETCH_VIDEOS', folderId})
→ Background: paginate GET /x/v3/fav/resource/list (ps=20, loop until !has_more)
  → Progress: sendMessage back per page ({type: 'FETCH_PROGRESS', loaded, total})
→ Popup: display video list + cache to chrome.storage.local
```

**Folder sampling rationale**: When fetching the folder list, we also fetch the first page (10 items) of each folder. This gives the LLM concrete examples of what each folder contains, dramatically improving classification accuracy. Modern LLM context windows (Haiku: 200K tokens) can easily accommodate this — even 20 folders × 10 titles ≈ ~2K tokens of extra context. The extra API calls are acceptable because folder count is typically 5-30.

**Video list item data shape** (from API response):

| Field | Display |
|-------|---------|
| `title` | Video title |
| `cover` | Thumbnail (small) |
| `upper.name` | UP主 |
| `bvid` | BV number (clickable link) |
| `cnt_info.play` | Play count |
| `fav_time` | When favorited |
| `attr` | Validity check: `attr !== 0` → [已失效] |

**Invalid video handling**: Videos with `attr !== 0` (deleted/taken down) are displayed with `[已失效]` badge, grayed out. They are excluded from AI suggestion and cannot be moved.

### 3. Generate AI Suggestions

```
User clicks "✨ 生成建议"
→ sendMessage({type: 'GET_SUGGESTIONS', videos, folders})
→ Background: batch videos into groups of 5-10
  → For each batch:
    → Construct prompt: folder list + video metadata (title, tname, tags, upper, intro)
    → POST to Claude API (Haiku by default)
    → Parse response: [{videoId, folderId, folderName, confidence}]
    → sendMessage back ({type: 'SUGGESTION_PROGRESS', completed, total})
  → Inter-batch delay: 300ms
→ Popup: display AI badges under each video card
  → Each badge: "[收藏夹名称] 87%" — clickable to move
```

**Prompt strategy**: Each batch includes the full folder list as context — for each folder: id, name, item count, and **10 sampled video titles** (fetched during indexing). This gives the LLM concrete examples of folder contents for much better classification. Plus metadata for 5-10 videos to classify. The LLM returns a JSON array of suggestions with confidence scores (0-1). Videos that don't match any folder get an empty suggestions array.

**Key signal fields** for classification:
- `tname` (分区名) — strongest signal, often maps directly to folder names
- `title` — content description
- `tags` — topic keywords
- `upper.name` — UP主 (creators often specialize)
- `intro` — video description (truncated to 100 chars)

**Cost estimate**: ~100 videos = ~10 batch calls = ~50K tokens input + ~5K output ≈ $0.01 with Haiku.

### 4. Move Video (One-Click + 5s Undo)

```
User clicks an AI suggestion badge on a video
→ Popup: immediately shows toast "已移动《{title}》到 [{folder}] — 撤销"
→ Popup: starts 5s countdown timer
  → If user clicks "撤销" within 5s:
    → Cancel timer, remove toast, no API call made
    → Video stays in current position, badge remains
  → If 5s passes (no undo):
    → sendMessage({type: 'MOVE_VIDEO', srcFolderId, dstFolderId, resourceId, resourceType})
    → Background: POST /x/v3/fav/resource/move (with bili_jct CSRF)
    → On success: append to operation log, remove video from list
    → On failure: toast error message, video remains
```

**No permanent undo**: After the 5s window, the move is final. The operation log records it, but there is no "undo" button in the log. Users can manually move videos back via B站's own UI if needed.

### 5. Export JSON

```
User clicks "📤 导出 JSON"
→ Popup: construct JSON from current video list + suggestions
→ Trigger browser download of bilisorter-export-{date}.json
```

Export shape: `{ exportDate, sourceFolderId, sourceFolderName, videos: [{title, bvid, cover, upper, tname, tags, fav_time, suggestions: [{folderName, confidence}]}] }`

### 6. Operation Log

```
User clicks "📋 操作日志"
→ Popup: open modal overlay
→ Read operation log from chrome.storage.local
→ Display list: "{timestamp} — 《{videoTitle}》→ [{folderName}]"
→ Sorted by newest first
→ Read-only, no actions available
```

**Log entry shape**: `{ timestamp, videoTitle, bvid, fromFolderName, toFolderName }`

**Storage**: `chrome.storage.local` key `bilisorter_operation_log`, JSON array, append-only. No size limit management in v0 (chrome.storage.local has 10MB limit; each entry is ~200 bytes, so ~50K operations before limit).

### 7. Settings

```
Popup settings area (inline, below main UI or in a collapsible section):
→ Claude API Key: password input, saved to chrome.storage.local
→ Model: select dropdown (claude-3-5-haiku-latest / claude-sonnet-4-20250514)
  → Default: haiku
→ Source folder: dropdown of all user's folders
  → Default: 默认收藏夹
```

Settings are read by background service worker on each AI request. No validation beyond "key is non-empty". Invalid keys will surface as Claude API errors in the suggestion flow.

---

## External API Dependencies

| API | Auth | Rate limits | Used for |
|-----|------|-------------|----------|
| B站 fav API | Cookie (SESSDATA) | ~100 read/min, ~20 write/min (empirical) | Folder list, video list, move |
| B站 nav API | Cookie (SESSDATA) | Permissive | Auth verification |
| Claude API | Bearer token (user key) | Per-plan | AI classification |

### B站 API Rate Limiting

No official documentation. Empirical observations:
- Read endpoints: relatively permissive, safe at ~100 req/min
- Write endpoints: stricter, recommend ≤20 req/min
- Rapid bursts may trigger captcha or temporary ban

**Mitigation**: Sequential page fetching (no concurrency) for reads. 300ms delay between move API calls. Batch AI suggestions to minimize round-trips.

### Error Handling

| B站 Code | Meaning | UI Response |
|----------|---------|-------------|
| 0 | Success | — |
| -101 | Not logged in | "请先登录 bilibili.com" |
| -111 | CSRF error | Retry with fresh bili_jct |
| -400 | Bad request | Toast error |
| -403 | Access denied | Toast error |
| 11012 | Folder full (999 max) | Toast "目标收藏夹已满" |
| 72010002 | Already in target | Skip silently, mark as "已在该收藏夹" |

---

## Persistence Schema

All data stored in `chrome.storage.local` under namespaced keys.

| Key | Type | Lifetime | Purpose |
|-----|------|----------|---------|
| `bilisorter_settings` | `{apiKey, model, sourceFolderId}` | Permanent | User configuration |
| `bilisorter_folders` | `Folder[]` | Cached, invalidated on re-index | Folder list from B站 (includes `sampleTitles: string[]` per folder) |
| `bilisorter_videos` | `Video[]` | Cached, invalidated on re-index | Video list from selected folder |
| `bilisorter_suggestions` | `{[bvid]: Suggestion[]}` | Cached, cleared on re-index | AI suggestions keyed by video bvid |
| `bilisorter_operation_log` | `LogEntry[]` | Permanent, append-only | Move operation history |

No IndexedDB. `chrome.storage.local` is sufficient for the data volumes involved (~1MB for 500 videos with suggestions).

---

## UI Layout (Popup)

```
┌─────────────────────────────────────── 400px ──┐
│  BiliSorter                    ⚙️ Settings     │
│───────────────────────────────────────────────│
│  [未登录状态] 请先登录 bilibili.com             │
│  ─── OR ───                                    │
│  👤 {username}  📁 源: [默认收藏夹 ▾]           │
│  [📥 索引] [✨ 建议] [📤 导出] [📋 日志]        │
│───────────────────────────────────────────────│
│  正在索引... 45/234                             │
│───────────────────────────────────────────────│
│  ┌─────────────────────────────────────────┐  │
│  │ 🖼 视频标题文字较长会截断显示...          │  │
│  │    UP主 · 科技区 · 12.3万播放             │  │
│  │    [📁 编程技术 87%] [📁 科技数码 62%]   │  │
│  ├─────────────────────────────────────────┤  │
│  │ 🖼 另一个视频标题...                      │  │
│  │    UP主 · 音乐区 · 5.1万播放              │  │
│  │    [📁 音乐收藏 95%]                      │  │
│  ├─────────────────────────────────────────┤  │
│  │ ⚠️ [已失效] 已被删除的视频                │  │
│  │    (灰显，无建议)                          │  │
│  └─────────────────────────────────────────┘  │
│  ... (scrollable)                              │
│───────────────────────────────────────────────│
│  ✅ 已移动《视频标题》到 [编程技术] — 撤销  5s │
└───────────────────────────────────────────────┘
```

**Design constraints**:
- Popup width: 400px (fixed)
- Popup max height: 600px (Chrome limit)
- Dark theme (match B站 dark mode: `#17181A` background)
- Video thumbnails: 60×45px inline
- AI badges: pill-shaped, colored by confidence (green >80%, yellow 50-80%)
- Toast: fixed to bottom of popup, auto-dismiss after 5s

---

## v1 Changes (planned)

### Multi-provider AI

Add provider selection in settings: Claude (default), Deepseek, OpenAI-compatible, Ollama (local).

Each provider uses the same prompt template, different API endpoint/format. Abstracted behind a `callLLM(prompt, model): Promise<SuggestionResult>` interface in `llmService.ts`.

### Batch Apply

"Apply All" button: moves all videos with suggestion confidence >80% in one operation. Shows confirmation dialog with count before executing. Moves are sequential with 300ms delay. Individual undo toasts are replaced by a single "已批量移动 N 个视频 — 全部撤销" toast with 10s window.

### Create Folder

"+ 新建收藏夹" option in suggestion badges. Opens inline input for folder name. Calls B站 `POST /x/v3/fav/folder/add`, then immediately moves the video to the new folder.

### Duplicate Detection

After indexing, scan all folders for videos that appear in multiple folders. Display a "重复视频" section with count. Allow user to choose which folder to keep the video in.

---

## Future Ideas (no commitments)

- **Side Panel migration**: If popup proves too cramped, move main UI to Side Panel (Chrome 114+). WXT supports this with minimal manifest changes.
- **Content Script augmentation**: Inject subtle indicators on B站's own favorites page (e.g., small icon showing "BiliSorter has suggestions for this video").
- **Smart folder creation**: When AI finds no matching folder for a cluster of videos, suggest creating a new folder with a name.
- **Cross-folder analytics**: "You have 3 folders about tech topics — consider merging?"
- **Raindrop.io bridge**: Export B站 favorites as bookmarks importable to Raindrop.io (closes the loop with RainSorter).

---

*Derived from discussion.md and research.md | 2026-02*
