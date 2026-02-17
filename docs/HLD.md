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
│         │     sendMessage / Port             │
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

Unlike reedle-extension (which uses content.ts for session sync with its web app), BiliSorter has **no content script**. All B站 interactions happen via API calls from the background service worker using extracted cookies. This is a deliberate choice — see `initial-discussion-log.md` §选型3 for the debate.

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

**Cookie attachment to API requests**: Background service worker manually sets the `Cookie` header on all `fetch()` calls to B站 API: `fetch(url, {headers: {'Cookie': \`SESSDATA=${sessdata}; bili_jct=${bili_jct}\`}})`. This works in MV3 because `host_permissions` for `*://*.bilibili.com/*` grants the extension permission to set the `Cookie` header. Cookies are NOT auto-attached — they must be read via `chrome.cookies.get` first and then manually injected.

**`DedeUserID` resilience**: If the `DedeUserID` cookie is missing but SESSDATA and bili_jct are present, the user ID is extracted from the `/x/web-interface/nav` response (`data.mid`) as fallback. Auth only fails if SESSDATA is missing or expired.

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

**Note on Claude API**: Calls to `api.anthropic.com` do NOT require `host_permissions`. Background service worker `fetch()` bypasses CORS, so no additional permissions are needed for the LLM API.

---

## Key Flows

### Messaging Pattern

**One-shot operations** (CHECK_AUTH, MOVE_VIDEO): Use `chrome.runtime.sendMessage` + `sendResponse` (standard request-response).

**Long-running operations** (FETCH_FOLDERS+VIDEOS, GET_SUGGESTIONS): Popup opens a `chrome.runtime.Port` connection to the background SW. Background sends progress updates via `port.postMessage()`. Port closes when the operation completes. This pattern is correct for MV3 because: (1) background can push multiple progress messages, (2) background detects popup closure via `port.onDisconnect`, and (3) no broadcast pollution.

**Popup close during operations**: If the popup closes while a Port-based operation is in progress, the background service worker detects the disconnection via `port.onDisconnect` and **aborts** the operation immediately. Partial results are NOT cached. The user must re-trigger the operation on next popup open. For 5s undo timers: since the timer runs in popup local state, closing the popup cancels all pending timers — no API calls are made, and videos remain in the cache (safe default). Future versions may allow background to continue operations independently.

### 1. Popup Open → Auth Check + Cache Restore

```
Popup mounts
→ Read chrome.storage.local for cached data (folders, videos, suggestions)
  → If cache exists: display immediately with "Last indexed: {timestamp}" label
  → If no cache: show empty state with "📥 索引收藏夹" button
→ sendMessage({type: 'CHECK_AUTH'})
→ Background: chrome.cookies.get SESSDATA, bili_jct, DedeUserID
  → If SESSDATA missing: respond {loggedIn: false}
  → If present: GET /x/web-interface/nav with SESSDATA
    → data.isLogin === true: respond {loggedIn: true, uid: data.mid, username: data.uname}
    → data.isLogin === false: respond {loggedIn: false} (cookie expired)
→ Popup: loggedIn ? show main UI (with cached data if available) : show "请先登录 bilibili.com"
```

**Cache-first strategy**: On popup open, cached data is displayed immediately (no loading spinner). A "Last indexed: {timestamp}" label is shown. There is **no separate 🔄 Refresh button** — the "📥 索引" button serves as both initial index and refresh. Re-clicking it re-fetches everything and overwrites the cache. This follows the "用完即走" principle — popup opens instantly with last state.

### 2. Index Favorites (Fetch Folders + Videos)

```
User clicks "📥 索引收藏夹"
→ Popup opens a Port to Background
→ Port: {type: 'INDEX'}
→ Background: read bilisorter_settings.sourceFolderId from chrome.storage.local
→ Background: GET /x/v3/fav/folder/created/list-all?up_mid={uid}
→ Background: for each folder, GET /x/v3/fav/resource/list (ps=20, pn=random_page)
  → If media_count is 0: skip sampling (sampleTitles = [])
  → Otherwise: pick a random page number (1 to ceil(media_count/20))
  → Extract titles of up to 10 videos as random sample
  → Store as folder.sampleTitles: string[]
→ Port: {type: 'FOLDERS_READY', folders}
→ Popup: update folder dropdown
→ Background: determine source folder:
  → If settings.sourceFolderId exists and is in the folder list → use it
  → Otherwise → use the first folder in the API response (默认收藏夹)
→ Background: paginate GET /x/v3/fav/resource/list for source folder (ps=20, loop until !has_more)
  → Port: {type: 'FETCH_PROGRESS', loaded, total} per page
→ Port: {type: 'INDEX_COMPLETE', videos, sourceFolderId}
→ Popup: display "{N} 个视频" count + video list + cache to chrome.storage.local (with timestamp)
→ Port closes
```

**One-click auto-fetch**: Clicking "📥 索引" triggers BOTH folder fetching (with samples) AND video fetching from the determined source folder. It is a single user action. The background reads the previously saved source folder from settings; if none is saved, it defaults to 默认收藏夹 (first folder in the API response). If the user changes the source folder dropdown AFTER indexing, a new video fetch is triggered automatically (same Port-based flow, folders are reused from cache).

**默认收藏夹 identification**: B站's `list-all` API always returns 默认收藏夹 as the first folder in the response. The extension uses this convention (first folder = default) rather than matching by title string.

**Folder sampling rationale**: When fetching the folder list, we also fetch **one random page** (10 items) from each folder. Random sampling (not just first page) provides a more representative cross-section of folder contents. This gives the LLM concrete examples of what each folder contains, dramatically improving classification accuracy. Modern LLM context windows (Haiku: 200K tokens) can easily accommodate this — even 20 folders × 10 titles ≈ ~2K tokens of extra context. The extra API calls are acceptable because folder count is typically 5-30. Random page is selected by: `Math.ceil(Math.random() * Math.ceil(media_count / 20))`, capped at 1 if folder has <20 items. If `media_count` is 0, skip sampling entirely (`sampleTitles = []`).

**Video list item data shape** (from API response):

| Field | Purpose |
|-------|----------|
| `title` | Video title (displayed; clickable → opens `https://www.bilibili.com/video/{bvid}` in new tab) |
| `cover` | Thumbnail URL (displayed as 60×45px inline image) |
| `upper.name` | UP主 (displayed) |
| `bvid` | BV number (used for link generation, AI prompt key, and API operations; not shown as raw text) |
| `cnt_info.play` | Play count (displayed) |
| `fav_time` | When favorited (displayed) |
| `intro` | Video description (AI prompt input only, not displayed in UI) |
| `tags` | Topic keywords (AI prompt input only; may be empty for some videos) |
| `attr` | Validity flag: `attr !== 0` → [已失效] (controls gray-out, not displayed as text) |

**Invalid video handling**: Videos with `attr !== 0` (deleted/taken down) are displayed with `[已失效]` badge, grayed out. They are excluded from AI suggestion and cannot be moved.

### 3. Generate AI Suggestions

```
User clicks "✨ 生成建议"
→ Popup opens a Port to Background
→ Port: {type: 'GET_SUGGESTIONS', videos, folders}
→ Background service worker (NOT popup) handles all Claude API calls:
  → Filter out invalid videos (attr !== 0) and the source folder from folder list
  → Batch valid videos into groups of 5-10
  → For each batch:
    → Construct prompt: folder context + video metadata (see Prompt Structure below)
    → POST to Claude API (Haiku by default) — API key read from chrome.storage.local
    → Parse + validate JSON response
    → Port: {type: 'SUGGESTION_PROGRESS', completed, total}
  → Inter-batch delay: 300ms
→ Port: {type: 'SUGGESTIONS_COMPLETE', suggestions}
→ Popup: display AI badges under each video card
  → Each badge: "[收藏夹名称]" with confidence progress bar — clickable to move
→ Port closes
```

**All AI calls happen in Background SW**: The API key is stored and read only in the background service worker. Popup sends video/folder data via Port, background makes the Claude API call, and pushes results back. This centralizes secret handling.

**Re-generation**: If ✨ 建议 is clicked when suggestions already exist, all suggestions are regenerated from scratch, overwriting previous ones. No confirmation dialog — regeneration is non-destructive.

#### Prompt Structure

The actual prompt text is an **implementation detail** that will be iterated during development. The HLD specifies only the inputs and expected outputs.

**Prompt inputs** (per batch):
- System message: role definition ("you are a video classifier"), output format instruction (JSON)
- Folder context: for each folder (excluding source folder): `{id, name, item_count, sample_titles[10]}`
- Video metadata: for each video in batch (5-10): `{bvid, title, tags, upper_name, intro_truncated_100chars}`

**Expected LLM output** (JSON, per batch):
```json
{
  "classifications": [
    {
      "bvid": "BV1xx...",
      "suggestions": [
        {"folder_id": 123, "folder_name": "编程技术", "confidence": 0.87},
        {"folder_id": 456, "folder_name": "科技数码", "confidence": 0.62},
        ...
      ]
    }
  ]
}
```

**Response validation**: If the LLM returns invalid JSON, retry the batch once. If the retry also fails, mark the batch as failed and show a toast error. Successfully parsed suggestions are stored; failed batches do not block other batches.

**Always min(5, available_folders) suggestions**: The LLM is instructed to return **up to 5** folder suggestions per video, ranked by confidence (0.0-1.0). If the user has fewer than 5 target folders, return all available folders. Even low-confidence suggestions are returned — the UI uses visual weight to distinguish. This prevents the "no suggestion" dead-end and always gives users actionable options.

**Source folder exclusion**: The source folder (e.g. 默认收藏夹) is excluded from the suggestion list. Suggesting "keep in the same folder" is pointless.

**Key signal fields** for classification:
- `title` — content description (strongest; modern LLMs infer category reliably from title alone)
- `tags` — topic keywords (from fav/resource/list, may be sparse)
- `upper.name` — UP主 (creators often specialize in specific topics)
- `intro` — video description (truncated to 100 chars)

**Note on `tname` (分区名)**: The B站 `fav/resource/list` API does NOT return `tname`. Fetching it requires an extra API call per video (`/x/web-interface/view`), which would cost 100+ calls for 100 videos. v0.1 omits tname — the combination of title, tags, upper, and folder sample titles provides sufficient classification signal. If classification quality is insufficient post-launch, lazy tname fetching can be added in a later version.

**Cost estimate**: ~100 videos = ~10 batch calls = ~50K tokens input + ~5K output ≈ $0.01 with Haiku.

#### Claude API Error Handling

| Error | Meaning | UI Response |
|-------|---------|-------------|
| 401 | Invalid API key | Toast "⚠️ Claude API Key 无效，请在 ⚙️ 设置中检查" + open settings |
| 429 | Rate limit | Pause current batch, retry after 30s, toast "请求频率超限，30s 后重试..." |
| 500/503 | Service down | Toast "⚠️ Claude 服务不可用，请稍后重试" |
| Network error | Timeout / no connection | Toast "网络错误，请检查网络连接" |
| Malformed response | LLM returned invalid JSON | Retry batch once; if still fails, skip batch + toast "部分视频分析失败" |

### 4. Move Video (One-Click + 5s Undo)

```
User clicks an AI suggestion badge on a video
→ Popup: video immediately fades out and is removed from the visible list (optimistic removal)
→ Popup: shows stacked toast "已移动《{video_title_truncated}》→ [{folder}] — 撤销 5s"
→ Popup: starts independent 5s countdown timer (visual countdown on toast)
  → If user clicks "撤销" within 5s:
    → Cancel timer, remove toast, NO API call made
    → Video re-inserts at its original position in the list (slide-in animation)
  → If 5s passes (no undo):
    → sendMessage({type: 'MOVE_VIDEO', srcFolderId, dstFolderId, resourceId, resourceType})
    → Background: POST /x/v3/fav/resource/move (with bili_jct CSRF)
    → On success: update chrome.storage.local cache (remove video + its suggestions) + append to operation log
    → On failure: video re-inserts into list + error toast "移动失败，请重试"
```

**`resourceType`**: Always `2` for video favorites. The B站 move API requires the `resources` parameter in the format `{resourceId}:{type}`, e.g., `12345:2`.

**Optimistic visual removal**: When the user clicks a badge, the video is removed from the visible list immediately — before any API call. This creates a satisfying "flow state" where the list visually shrinks as the user works through it. The toast is a safety net. If the undo is clicked or the API fails, the video smoothly re-appears at its original position.

**Cache update timing**: `chrome.storage.local` (bilisorter_videos, bilisorter_suggestions) is updated ONLY after the 5s window passes AND the API call succeeds. During the 5s window, the cache still contains the video — only the local React state has changed. This means if the popup closes during the 5s window, the video will reappear on next open (safe default).

**Toast stacking**: Multiple toasts can be active simultaneously. Each toast is independent with its own 5s timer. Toasts stack vertically from the bottom of the popup, each showing the video title (truncated) + target folder name. No overlap — each toast is a separate row. The user can click "撤销" on any individual toast independently. Maximum visible toasts: 5 (oldest auto-dismissed if exceeded). This allows rapid-fire sorting — click 3 badges in 2 seconds, see 3 stacked toasts, undo any one of them.

**No permanent undo**: After the 5s window, the move is final. The operation log records it, but there is no "undo" button in the log. Users can manually move videos back via B站's own UI if needed.

### 5. Export JSON

```
User clicks "📤 导出 JSON"
→ Popup: construct JSON from current video list + suggestions
→ Trigger browser download of bilisorter-export-{date}.json
```

Export shape: `{ exportDate, sourceFolderId, sourceFolderName, videos: [{title, bvid, cover, upper, tags, fav_time, suggestions: [{folderName, confidence}]}] }`

If the user exports before generating suggestions, the `suggestions` array for each video is empty (`[]`). Export always reflects current state — whatever is currently indexed and suggested.

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

`fromFolderName` is looked up from the cached folder list by folder ID at the time of the move. `toFolderName` is taken from the clicked suggestion badge's folder name. Both are **snapshotted** (stored as strings, not resolved dynamically). If a folder is renamed after a move, the log still shows the original name.

**Storage**: `chrome.storage.local` key `bilisorter_operation_log`, JSON array, append-only. No size limit management in v0 (chrome.storage.local has 10MB limit; each entry is ~200 bytes, so ~50K operations before limit).

### 7. Settings

```
Popup: collapsible ⚙️ Settings section (inline, toggled by gear icon in header):
→ Claude API Key: password input, saved to chrome.storage.local
→ Model: select dropdown (claude-3-5-haiku-latest / claude-sonnet-4-latest)
  → Default: haiku
→ Source folder: dropdown of all user's folders
  → Default: 默认收藏夹
```

**Settings are inline in the popup** — no separate options page. A ⚙️ icon in the header toggles a collapsible settings panel. This keeps the extension to a single entrypoint (popup only). Settings are read by background service worker on each AI request. No validation beyond "key is non-empty". Invalid keys will surface as Claude API errors in the suggestion flow.

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

## Empty States

| Condition | What popup shows |
|-----------|------------------|
| Not logged in (SESSDATA missing/expired) | Full-area message: "请先登录 bilibili.com" with link. No action buttons visible except ⚙️. |
| Logged in, no cache, no API key | Main UI with "📥 索引" enabled. "✨ 建议" disabled with hint "请先在 ⚙️ 设置中配置 Claude API Key". ⚙️ icon has a pulsing dot indicator. |
| Logged in, no cache, API key set | Main UI with "📥 索引" enabled. All other buttons inactive until index completes. |
| Source folder is empty (0 videos) | After index: "该收藏夹为空" message in list area. "✨ 建议" disabled. |
| All videos are [已失效] | After index: list shows all grayed-out invalid videos. "✨ 建议" disabled with "没有有效视频可分析". |
| Only 1 folder total (source = only folder) | After index: "没有目标收藏夹，请先在 B站 创建收藏夹" message. "✨ 建议" disabled. |
| AI suggestions all failed | Toast: "⚠️ AI 分析失败：{error}". Videos remain in list without badges. User can retry. |
| AI partially failed (some batches ok) | Successful suggestions displayed. Failed batches: toast "部分视频分析失败，已跳过 N 个". Videos without suggestions show no badges. |

**Button states across all conditions**: 📤 导出 is disabled when no indexed data exists. 📋 日志 is always enabled (shows "暂无操作记录" if log is empty). ⚙️ is always accessible in all states.

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
│  │    UP主 · 12.3万播放 · 2024-01-15        │  │
│  │    [████ 编程技术] [███ 科技数码] [█ 音乐]│  │
│  ├─────────────────────────────────────────┤  │
│  │ 🖼 另一个视频标题...                      │  │
│  │    UP主 · 5.1万播放 · 2024-03-22          │  │
│  │    [█████ 音乐收藏] [██ 娱乐] ...        │  │
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
- AI badges: pill-shaped, each with a small colored confidence progress bar:
  - ≥80% — green bar
  - 50-79% — yellow/amber bar
  - <50% — grey bar (de-emphasized but still visible and clickable)
  - Up to min(5, available_folders) badges per video, visually ranked by confidence
- Toasts: stacked vertically from bottom of popup, max 5 visible, auto-dismiss after 5s each
- Scroll: header (username + source dropdown) and button bar are **sticky** at the top. Video list area scrolls independently (`overflow-y: auto`). No virtual scroll in v0.1
- Video count: "{N} 个视频" label shown above the list area after indexing completes
- Video title: clickable → opens B站 video page (`bilibili.com/video/{bvid}`) in new tab
- Duplicate folder names: if multiple folders share the same name, display item count to disambiguate — e.g., "音乐 (42)" vs "音乐 (7)". Applies to source folder dropdown and AI suggestion badges

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

*Derived from initial-discussion-log.md and research-log-n-suggestion.md | 2026-02*
