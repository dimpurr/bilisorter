# BiliSorter - High Level Design

> Chrome extension that uses AI to classify and move Bilibili favorites into organized folders.

---

## Version History

| Version | Summary |
|---------|---------|
| **v0.1** | Initial MVP: single monolithic INDEX operation coupling folder sampling and full video fetch |
| **v0.2** (current) | Three-pool architecture: separated folder indexing, paginated source video queue (60/page), incremental AI suggestions. Fixed Claude pipeline (1s batch delay, error reporting, incremental mode). New two-zone layout. Multi-provider (Claude + Gemini). Folder manager (drag-sort, inline rename, sort buttons). Side Panel UI. AI Advisor Chat. declarativeNetRequest for header rewriting. |
| **v1** (planned) | Batch apply all, create folder from popup, duplicate detection |
| **Future** | Streaming AI chat, execute-from-chat, AI tool-use, content script integration |

---

## System Architecture

```
┌────────────────────────────────────────────┐
│  Chrome Extension (Manifest V3, WXT)       │
│                                            │
│  ┌──────────────┐  ┌────────────────────┐  │
│  │ Background   │  │ Popup / SidePanel  │  │
│  │ Service      │  │ (React, shared)    │  │
│  │ Worker       │  │                    │  │
│  │              │  │ • Source selector  │  │
│  │ • Cookie     │  │ • Video list       │  │
│  │   extraction │  │ • AI badges       │  │
│  │ • B站 API    │  │ • Undo toast      │  │
│  │   calls      │  │ • Settings        │  │
│  │ • Header     │  │ • Log viewer      │  │
│  │   rewriting  │  │ • Folder manager  │  │
│  │              │  │ • AI Chat advisor │  │
│  │              │  │ • JSON export     │  │
│  └──────┬───────┘  └────────┬───────────┘  │
│         │     sendMessage / Port             │
│         └──────────────┬───────────────────┘
│                        │                    │
│  ┌─────────────────────┴──────────────────┐│
│  │ chrome.storage.local                   ││
│  │ • Pool 1: Folder index + samples       ││
│  │ • Pool 2: Source video queue (60/page) ││
│  │ • Pool 3: AI suggestions cache         ││
│  │ • Chat history (persistent)            ││
│  │ • Operation log (permanent)            ││
│  │ • Settings (API key, model, source)    ││
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
| AI | Claude API (Haiku default, Sonnet optional) + Gemini API (Flash default) |
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

**Anti-hotlinking headers**: All B站 API requests MUST include `Referer: https://www.bilibili.com` and `Origin: https://www.bilibili.com` headers. Without these, certain endpoints (especially `/x/v3/fav/resource/list`) return HTML error pages instead of JSON. A `buildFetchHeaders(cookies)` helper centralizes Cookie + Referer + Origin + User-Agent for all API calls.

**Rate limiting mitigation**: Folder sampling uses a 300ms inter-request delay to avoid triggering B站's anti-abuse measures. All API response parsing goes through `safeParseBiliJson()` which validates HTTP status and content-type before JSON parsing, providing clear diagnostic errors.

**`DedeUserID` resilience**: If the `DedeUserID` cookie is missing but SESSDATA and bili_jct are present, the user ID is extracted from the `/x/web-interface/nav` response (`data.mid`) as fallback. Auth only fails if SESSDATA is missing or expired.

**Comparison with RainSorter/reedle-extension**: No backend proxy, no token refresh, no session sync. Simpler because B站 cookies are long-lived (~30 days) and managed by the browser, not by us.

---

## Manifest Permissions

| Permission | Why |
|------------|-----|
| `cookies` | Read SESSDATA, bili_jct, DedeUserID |
| `storage` | Persist cache, settings, operation log, chat history |
| `declarativeNetRequest` | Rewrite Origin/Referer headers for B站 API calls |
| `sidePanel` | Side Panel UI (Chrome 114+) |

| Host Permission | Why |
|-----------------|-----|
| `*://*.bilibili.com/*` | Cookie access scope |
| `https://api.bilibili.com/*` | API fetch from background SW |

No `activeTab`, `scripting`, or `webNavigation` needed.

**Note on Claude API**: Calls to `api.anthropic.com` do NOT require `host_permissions`. Background service worker `fetch()` bypasses CORS, so no additional permissions are needed for the LLM API.

---

## Key Flows

### Messaging Pattern

**One-shot operations** (CHECK_AUTH, MOVE_VIDEO): Use `chrome.runtime.sendMessage` + `sendResponse` (standard request-response).

**Long-running operations** (FETCH_FOLDERS+VIDEOS, GET_SUGGESTIONS): Popup opens a `chrome.runtime.Port` connection to the background SW. Background sends progress updates via `port.postMessage()`. Port closes when the operation completes. This pattern is correct for MV3 because: (1) background can push multiple progress messages, (2) background detects popup closure via `port.onDisconnect`, and (3) no broadcast pollution.

**Popup close during operations**: If the popup closes while a Port-based operation is in progress, the background service worker **continues** the operation to completion. All `port.postMessage()` calls are wrapped in a `safePostMessage()` helper that catches disconnected-port errors silently. Results are always saved to `chrome.storage.local` regardless of popup state. When the popup reopens, it: (1) sends `GET_INDEX_STATUS` / `GET_SUGGEST_STATUS` one-shot messages to check if an operation is still running, and if so, shows progress UI; (2) listens to `chrome.storage.onChanged` to detect when the background finishes and updates state automatically; (3) loads any cached data from storage immediately (cache-first). For 5s undo timers: since the timer runs in popup local state, closing the popup cancels all pending timers — no API calls are made, and videos remain in the cache (safe default).

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

**Cache-first strategy**: On popup open, cached data is displayed immediately (no loading spinner). Both folder index and source videos are loaded from their separate caches. This follows the "用完即走" principle — popup opens instantly with last state.

### Three-Pool Architecture (v0.2)

BiliSorter maintains three independent data pools with clear separation:

| Pool | Storage Key | Trigger | Frequency | Rate Limit Risk |
|------|-------------|---------|-----------|------------------|
| **1. Folder Index** | `bilisorter_folders` + `bilisorter_folderSamples` + `bilisorter_folderIndexTime` | "📂 索引收藏夹" button | One-time, rarely re-done | High (~55 API calls) — has checkpoint |
| **2. Source Videos** | `bilisorter_source_videos` + `bilisorter_source_meta` | Auto on folder select / "🔄 刷新" / "加载更多" | Per-session, manual refresh | Low (3 pages = 3 API calls) |
| **3. AI Suggestions** | `bilisorter_suggestions` | "✨ 建议" button | On demand, incremental | N/A (Claude API) |

### 2A. Index Folders (Structural Metadata)

```
User clicks "📂 索引收藏夹"
→ Popup opens a Port to Background
→ Port: {type: 'INDEX_FOLDERS'}
→ Background: GET /x/v3/fav/folder/created/list-all?up_mid={uid}
→ Background: for each folder, GET /x/v3/fav/resource/list (ps=20, pn=random_page)
  → If media_count is 0: skip sampling (sampleTitles = [])
  → Otherwise: pick a random page number (1 to ceil(media_count/20))
  → Extract titles of up to 10 videos as random sample
  → Store as folder.sampleTitles: string[]
  → Checkpoint saved after each folder (crash-safe, 412-resumable)
→ Port: {type: 'SAMPLING_PROGRESS', sampled, total, currentFolder}
→ Port: {type: 'INDEX_FOLDERS_COMPLETE', folders, timestamp}
→ Popup: save to storage, update folder dropdown, show summary "✓ 55 个收藏夹已索引"
→ Port closes
```

This is a **structural operation** — it captures the folder hierarchy and representative samples for AI classification context. It does NOT fetch source videos. Checkpoint-resumable on 412.

### 2B. Fetch Source Videos (Content Queue)

```
Auto-triggered when source folder is selected (or "🔄 刷新源" clicked)
→ sendMessage({type: 'FETCH_SOURCE', folderId})
→ Background: GET /x/v3/fav/resource/list for source folder (ps=20, pn=1..3 → 60 videos)
→ Response: {success, videos, sourceMeta: {folderId, total, nextPage, hasMore}}
→ Popup: display video list with "显示 60 / 2034 个视频"
```

This is a **content operation** — it populates the user's working queue. Only 3 pages (60 videos), completes in ~2 seconds, no checkpoint needed, almost no 412 risk.

- **Load more**: `sendMessage({type: 'LOAD_MORE'})` → fetches next 3 pages, appends to existing source videos
- **Refresh**: `sendMessage({type: 'REFRESH_SOURCE'})` → clears source videos, re-fetches first 60
- **Folder change**: auto-triggers FETCH_SOURCE with new folderId

These two operations (2A + 2B) replace the old monolithic "INDEX" flow.

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
User clicks "✨ 建议"
→ Popup opens a Port to Background
→ Port: {type: 'GET_SUGGESTIONS'}
→ Background: reads source videos + folders from storage
  → Filter out invalid videos (attr !== 0)
  → Filter out videos that already have suggestions (incremental mode)
  → Exclude source folder from target folder list
  → Batch remaining videos into groups of 10
  → For each batch:
    → Construct prompt: folder context + video metadata
    → POST to Claude API (Haiku by default)
    → Parse + validate JSON response
    → Port: {type: 'SUGGESTION_PROGRESS', completed, total}
  → Inter-batch delay: 1000ms (increased from 300ms for reliability)
  → On batch failure: retry once with 2s backoff, then report error (NOT silent)
→ Port: {type: 'SUGGESTIONS_COMPLETE', suggestions, failedCount}
→ Popup: display AI badges under each video card
→ Port closes
```

**Scope**: AI suggestions are generated ONLY for currently loaded source videos (typically 60), not all videos in the folder. This means ~6 Claude API calls instead of ~99.

**Incremental mode**: If user loads more videos after generating suggestions, clicking ✨ again only processes videos without existing suggestions. Previously suggested videos are preserved.

**All AI calls happen in Background SW**: The API key is stored and read only in the background service worker. Background reads source videos and folders from storage directly — popup does NOT send video data over the Port.

**Error reporting**: Failed batches are counted and reported in the completion message. No silent failure swallowing.

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

**Mitigation**: Sequential page fetching (no concurrency) for reads. 500ms delay between folder sampling requests. Source video fetching: only 3 pages per load (60 videos), almost zero 412 risk. Folder sampling has checkpoint for 412 resume. 1000ms delay between Claude batch calls.

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

All data stored in `chrome.storage.local` under namespaced keys. **Three independent pools**:

| Key | Pool | Type | Lifetime | Purpose |
|-----|------|------|----------|---------||
| `bilisorter_settings` | — | `{apiKey, model, sourceFolderId}` | Permanent | User configuration |
| `bilisorter_folders` | 1 | `Folder[]` | Cached, invalidated on re-index | Folder list (includes `sampleTitles`) |
| `bilisorter_folderSamples` | 1 | `Record<string, string[]>` | Cached | Per-folder sample titles (written incrementally during sampling) |
| `bilisorter_folderIndexTime` | 1 | `number` | Cached | Timestamp of last folder index |
| `bilisorter_folderCheckpoint` | 1 | `FolderIndexCheckpoint` | Transient | Checkpoint for resumable folder sampling (cleared on completion) |
| `bilisorter_source_videos` | 2 | `Video[]` | Session-cached | Currently loaded source videos (60-N) |
| `bilisorter_source_meta` | 2 | `SourceMeta` | Session-cached | Source pagination state: {folderId, total, nextPage, hasMore, lastFetchTime} |
| `bilisorter_suggestions` | 3 | `{[bvid]: Suggestion[]}` | Cached, cleared on source refresh | AI suggestions keyed by video bvid |
| `bilisorter_operation_log` | — | `LogEntry[]` | Permanent, append-only | Move operation history |
| `bilisorter_chat_history` | — | `ChatMessage[]` | Permanent, manual clear | AI advisor chat history |

No IndexedDB. `chrome.storage.local` is sufficient for the data volumes involved (~200KB for 60 videos with suggestions).

---

## Empty States

| Condition | What popup shows |
|-----------|------------------|
| Not logged in (SESSDATA missing/expired) | Full-area message: "请先登录 bilibili.com" with link. No action buttons visible except ⚙️. |
| Logged in, folders not indexed | Main UI with "📂 索引收藏夹" button prominent. Source area shows hint "请先索引收藏夹". |
| Folders indexed, source not loaded | Folder summary shown ("✓ 55 个收藏夹"). Source area shows "待加载 — 选择源收藏夹后自动加载". |
| Source folder is empty (0 videos) | "该收藏夹为空" message in source area. |
| All videos are [已失效] | Source area shows grayed-out list. "✨ 建议" disabled + "没有有效视频可分析". |
| Only 1 folder total | "没有目标收藏夹，请先在 B站 创建收藏夹" message. |
| No API key when clicking ✨ | Toast: "请先在 ⚙️ 设置中配置 Claude API Key". ⚙️ pulsing dot. |
| AI suggestions all failed | Toast: "⚠️ AI 分析失败：{error}". Videos remain without badges. |
| AI partially failed | Successful suggestions displayed. Toast: "部分视频分析失败，已跳过 N 个". |

**Button states**: 📤 导出 disabled when no source videos loaded. 📋 日志 always enabled. ⚙️ always accessible.

---

## UI Layout (Popup) — Two-Zone Architecture

```
┌──────────────────────────────────────── 400px ──┐
│  BiliSorter    👤{user}    [📋 日志] [⚙️]       │  ← Global header
│─── ZONE 1: Folder Index (collapsible) ─────────│
│  📂 55 个收藏夹已索引 ✓         [重新索引]       │  ← Success: one-line summary
│  上次索引: 10分钟前                               │
│═════════════════════════════════════════════════│
│─── ZONE 2: Source Operations ──────────────────│
│  📁 源: [默认收藏夹 ▾]             [🔄 刷新]     │  ← Source selector + refresh
│  显示 60 / 2034 个视频                            │  ← Loaded / Total
│  [✨ 建议]  [📤 导出]                             │  ← Source-scoped actions
│────────────────────────────────────────────────│
│  ┌──────────────────────────────────────────┐  │
│  │ 🖼 视频标题文字较长会截断显示...           │  │
│  │    UP主 · 12.3万播放                       │  │
│  │    [████ 编程技术] [███ 科技数码]           │  │
│  ├──────────────────────────────────────────┤  │
│  │ ...                                       │  │
│  └──────────────────────────────────────────┘  │
│         [加载更多 (已加载 60/2034)]              │
│────────────────────────────────────────────────│
│  ✅ 已移动《视频标题》→ [编程技术] — 撤销 5s    │
└────────────────────────────────────────────────┘
```

**Two-zone architecture**:
- **Zone 1 (Folder Index)**: Global structural operation. Shows folder sampling progress during indexing, collapses to a one-line summary ("✓ 55 个收藏夹已索引") after completion. "[重新索引]" to redo. Checkpoint-aware (resume from 412).
- **Zone 2 (Source)**: Content working area. Source folder selector, refresh button, video count ("60/2034"), ✨/📤 action buttons, video list, load more. All scoped to the currently selected source folder.

**Key UX improvements over v0.1**:
- Only two numbers visible: folder count (55) and video count (60/2034) — never confused
- Source videos show only the first 60, not all 987/2K
- AI suggestions process 60 videos (6 batches) not 987 (99 batches)
- 📋 日志 and ⚙️ promoted to global header (always accessible, not buried in button bar)

**Design constraints** (unchanged):
- Popup width: 400px (fixed), max height: 600px
- Dark theme (`#17181A` background)
- Video thumbnails: 60×45px inline
- AI badges: pill-shaped with colored confidence bar (≥80% green, 50-79% amber, <50% grey)
- Toasts: stacked from bottom, max 5, auto-dismiss after 5s
- Duplicate folder names: disambiguate with item count

---

## AI Advisor Chat (💬)

An in-app multi-turn chat interface where the user can converse with AI about their collection structure and get actionable organization advice.

### Architecture: Direct API (Plan B)

Chat calls the AI provider directly from the popup/sidepanel component — no background worker involved. This means the chat works even if the background service worker is inactive. Uses the same provider/key/model configured in Settings.

- **Claude**: Direct fetch with `anthropic-dangerous-direct-browser-access` header (same as existing classification)
- **Gemini**: Direct fetch with `x-goog-api-key` (same pattern)

### Context (System Prompt)

Built fresh on each API call from current folder data (Pool 1):
- Full folder list with: name, ID, media_count, position order, sample titles
- Aggregate stats: total folders, total videos, avg/min/max folder size
- System role: "Bilibili 收藏夹顾问" — advises on merge, split, rename, reorder
- No token cap — modern context windows (200K+) easily accommodate all folder data

### Chat Persistence

Chat history is stored in `chrome.storage.local` (`bilisorter_chat_history`) as a `ChatMessage[]` array. Persists across popup opens/closes, across browser restarts. Only cleared when user clicks the 🗑 clear button in the chat header.

### UI Layout

```
┌─────── Chat Modal ────────┐
│ 💬 收藏夹顾问    [🗑][✕]   │  ← Header + clear + close
│───────────────────────────│
│  🤖 收藏夹 AI 顾问         │  ← Welcome (empty state)
│  我可以分析你的55个收藏夹   │
│                           │
│  [📊 调整建议] [❤️ 偏好]   │  ← Quick action grid
│  [🔀 合并建议] [📐 命名]   │     (shown only when no msgs)
│───────────────────────────│
│  输入你的问题...      [▶]  │  ← Input bar
└───────────────────────────┘
```

After conversation starts:
```
┌─────── Chat Modal ────────┐
│ 💬 收藏夹顾问    [🗑][✕]   │
│───────────────────────────│
│          分析我的收藏偏好   │  ← User bubble (right, blue)
│                           │
│ 根据你的收藏夹结构分析...   │  ← Assistant bubble (left, gray)
│ 1. 你主要关注...           │
│ 2. 建议合并...             │
│                           │
│ ●●● (thinking...)         │  ← Typing indicator
│───────────────────────────│
│  输入你的问题...      [▶]  │
└───────────────────────────┘
```

### Quick Action Presets

| Button | Prompt |
|--------|--------|
| 📊 收藏夹调整建议 | 分析收藏夹结构，指出过大/过小/重叠，给出具体调整方案 |
| ❤️ 分析收藏偏好 | 根据名称和样本分析内容兴趣偏好和收藏习惯 |
| 🔀 合并建议 | 找出高度相似的收藏夹，给出具体合并方案和新名称 |
| 📐 命名优化 | 审视所有命名，建议更清晰一致的命名方案 |

Quick actions only shown when chat is empty. After sending, they disappear and normal chat continues.

### Multi-turn Conversation

Full message history sent with each API call. System prompt (with folder context) rebuilt fresh each call to reflect any folder changes made between messages. No streaming in v0 — response appears when complete, typing indicator shown during wait.

---

## v1 Changes (planned)

### Batch Apply

"Apply All" button: moves all videos with suggestion confidence >80% in one operation. Shows confirmation dialog with count before executing. Moves are sequential with 300ms delay. Individual undo toasts are replaced by a single "已批量移动 N 个视频 — 全部撤销" toast with 10s window.

### Create Folder

"+ 新建收藏夹" option in suggestion badges. Opens inline input for folder name. Calls B站 `POST /x/v3/fav/folder/add`, then immediately moves the video to the new folder.

### Duplicate Detection

After indexing, scan all folders for videos that appear in multiple folders. Display a "重复视频" section with count. Allow user to choose which folder to keep the video in.

---

## Future Ideas (no commitments)

- **Streaming AI chat**: Replace request-response chat with streaming responses (SSE/ReadableStream) for real-time feel
- **Execute suggestion from chat**: AI proposes rename/merge → one-click apply buttons rendered inline in chat
- **Tool-use / function-calling**: AI can directly call rename/merge/sort APIs via tool use protocol
- **Multi-provider expansion**: Deepseek, OpenAI-compatible, Ollama (local) providers
- **Content Script augmentation**: Inject subtle indicators on B站's own favorites page
- **Smart folder creation**: When AI finds no matching folder for a cluster of videos, suggest creating a new folder
- **Cross-folder analytics**: Deep statistical analysis of collection patterns over time
- **Raindrop.io bridge**: Export B站 favorites as bookmarks importable to Raindrop.io
- **Chat context summarization**: Auto-summarize long chat history for very long conversations

---

*Derived from initial-discussion-log.md and research-log-n-suggestion.md | 2026-02*
