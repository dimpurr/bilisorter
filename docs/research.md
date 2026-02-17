# BiliSorter Technical Research

> Comprehensive research covering prior art, API surface, competitive landscape, and architectural decisions.
> Last updated: 2026-02-17

---

## 1. RainSorter Architecture Analysis

RainSorter (github.com/dimpurr/rainsorter) is the direct predecessor and inspiration. It organizes Raindrop.io bookmarks using AI suggestions. Here we dissect its architecture to extract reusable patterns.

### 1.1 Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | Vite + React 18 | SPA, fast HMR |
| State | Jotai + `atomWithStorage` | Persistent atoms (localStorage) |
| Backend | Express.js | OAuth proxy only (protects client_secret) |
| API | Raindrop.io REST API | Official, documented |
| Styling | Vanilla CSS | No framework, single `App.css` (~19KB) |

### 1.2 Authentication Flow

```
User → Login Page → Raindrop OAuth authorize URL
     → Redirect to /callback with ?code=
     → CallbackPage sends code to Express proxy
     → Express proxy exchanges code for access_token (using client_secret)
     → Tokens stored in Jotai atomWithStorage (localStorage)
     → Token refresh via /api/oauth/refresh endpoint
     → Token expiry checked with isTokenExpired() utility
```

Key: Backend proxy exists SOLELY to keep `client_secret` off the frontend. All actual API calls are made directly from browser with Bearer token.

### 1.3 Data Flow

```
1. useRaindrops hook
   → fetchRaindrops(token, page, 50)  // GET /rest/v1/raindrops/-1 (unsorted)
   → Loop pages until items < 50
   → optionally fetchRaindropsByTag('_rainsorter')
   → All items stored in raindropsAtom

2. useCollections hook
   → fetchCollections(token)  // GET /rest/v1/collections + /childrens
   → Builds collectionsMapAtom (id→name) + collectionsTreeAtom (hierarchical)

3. useSuggestions hook
   → fetchSuggestions(token, raindropId)  // GET /rest/v1/raindrop/{id}/suggest
   → Raindrop's BUILT-IN AI returns {collections: [{$id, confidence}], tags: []}
   → Batched: 5 concurrent, 500ms delay between batches
   → Results stored in suggestionsAtom {raindropId: {collections, tags}}
   → fetchingSuggestionIdsAtom tracks in-flight requests (dedup)

4. Move operation (RaindropRow component)
   → updateRaindrop(token, id, {collection: {$id}, tags: [..., '_rainsorter']})
   → PUT /rest/v1/raindrop/{id}
   → Tags '_rainsorter' (AI) or '_rainsorter_manual' (manual) appended
```

### 1.4 UI Architecture

```
App.jsx
├── LoginPage         — OAuth login button
├── CallbackPage      — Handles OAuth redirect, exchanges code
└── DashboardPage     — Main workspace
    ├── Header        — Title + logout
    ├── SuggestionsSidebar (left, ~250px)
    │   ├── "All Unsorted" button with count
    │   ├── "No Suggestion" filter
    │   └── TreeNode recursive (folders with suggestion counts)
    └── RaindropsTable (main area)
        ├── Table header (stats, "Hide sorted" checkbox, Refresh, Fetch Suggestions buttons)
        ├── FolderItemsPanel (shown when sidebar folder selected, previews existing items)
        └── <tbody> RaindropRow × N
            ├── Title cell (link, URL, date, excerpt)
            ├── Tags cell (tag badges, max 3 + overflow)
            ├── Suggestions cell
            │   ├── Suggestion badges (clickable → move) with confidence %
            │   └── ✏️ button → CollectionSelectorModal
            └── JSON cell (hover tooltip with raw JSON)
```

### 1.5 Key Design Patterns Worth Replicating

1. **Tag-based revert system**: Append tracking tags to enable bulk undo via search
2. **Batched concurrent fetching**: Limit concurrency + inter-batch delay to avoid rate limits
3. **Derived atoms for tree**: Raw flat list → derived map + derived tree structure
4. **Progressive disclosure**: Stats update live during suggestion fetching
5. **Sidebar filter + main list pattern**: Click sidebar → filters main table
6. **FolderItemsPanel**: Preview what's already in a folder before moving items there
7. **CollectionSelectorModal**: Search + hierarchical tree for manual selection
8. **No pagination in UI**: Fetch ALL items, display all (works for ~hundreds of items)

---

## 2. Bilibili API Surface

> ⚠️ All endpoints are UNDOCUMENTED and UNOFFICIAL. The primary reference (SocialSisterYi/bilibili-API-collect) was shut down via legal notice from Bilibili on 2026-01-28. Information gathered from forks, community projects, and direct observation.

### 2.1 Authentication

Bilibili uses cookie-based authentication. Key cookies:

| Cookie | Purpose | Lifetime |
|---|---|---|
| `SESSDATA` | Session authentication token | ~30 days |
| `bili_jct` | CSRF token (required for write operations) | ~30 days |
| `DedeUserID` | User ID (numeric) | Persistent |
| `DedeUserID__ckMd5` | User ID checksum | Persistent |

No OAuth flow exists. Authentication requires an active browser session.

**Chrome Extension approach**: Use `chrome.cookies.get({url: 'https://www.bilibili.com', name: 'SESSDATA'})` to retrieve session cookies from the user's existing login. Requires `"cookies"` permission + `"host_permissions": ["*://*.bilibili.com/*"]` in manifest.json.

### 2.2 Read Endpoints

#### Get all favorite folders
```
GET https://api.bilibili.com/x/v3/fav/folder/created/list-all
Params: up_mid={uid}
Headers: Cookie: SESSDATA=xxx
Response: {code: 0, data: {list: [{id, fid, mid, title, media_count, ...}]}}
```

#### Get contents of a specific folder
```
GET https://api.bilibili.com/x/v3/fav/resource/list
Params: media_id={folder_id}, pn={page}, ps={page_size}, order=mtime, platform=web
Headers: Cookie: SESSDATA=xxx
Response: {code: 0, data: {medias: [{id, type, title, cover, upper, cnt_info, ...}], has_more}}
```

Each media item contains:
- `id` — resource ID (avid for videos)
- `type` — content type (2=video, 12=audio, 21=collection)
- `title` — video title
- `cover` — thumbnail URL
- `intro` — description/intro
- `upper` — {mid, name, face} uploader info
- `cnt_info` — {collect, play, danmaku} stats
- `tag` — associated tags (may not always be present)
- `bvid` — BV number
- `attr` — bitfield (0=normal, check for invalid/private)
- `fav_time` — timestamp when favorited

#### Get video details (supplementary)
```
GET https://api.bilibili.com/x/web-interface/view
Params: bvid={bvid}
Response: {code: 0, data: {title, desc, tname, tid, tag, ...}}
```
- `tname` — 分区名 (category name, e.g. "科技", "音乐")
- `tid` — 分区 ID
- `tag` — detailed tag list (better than fav list tag field)
- `desc` — full description

### 2.3 Write Endpoints

#### Move videos between folders (BATCH)
```
POST https://api.bilibili.com/x/v3/fav/resource/move
Content-Type: application/x-www-form-urlencoded
Body:
  src_media_id={source_folder_id}
  tar_media_id={target_folder_id}
  mid={user_id}
  resources={avid1}:2,{avid2}:2,...   // {content_id}:{content_type} comma-separated
  platform=web
  csrf={bili_jct}
Headers: Cookie: SESSDATA=xxx
Response: {code: 0}
```

Content type values: `2`=video, `12`=audio, `21`=video_collection

#### Copy videos (keeps in source too)
```
POST https://api.bilibili.com/x/v3/fav/resource/copy
Body: same as move
```

#### Add/Remove from favorites
```
POST https://api.bilibili.com/x/v3/fav/resource/deal
Body:
  rid={avid}
  type=2
  add_media_ids={folder_id1},{folder_id2}    // folders to add to
  del_media_ids={folder_id1}                 // folders to remove from
  csrf={bili_jct}
```

#### Create new folder
```
POST https://api.bilibili.com/x/v3/fav/folder/add
Body:
  title={name}
  intro={description}
  privacy=0                                  // 0=public, 1=private
  csrf={bili_jct}
```

### 2.4 Error Codes

| Code | Meaning |
|---|---|
| 0 | Success |
| -101 | Not logged in (SESSDATA expired/invalid) |
| -111 | CSRF token error (bili_jct mismatch) |
| -400 | Bad request (missing/invalid params) |
| -403 | Access denied |
| -404 | Not found |
| 11010 | Max favorites folders reached (B站 limit) |
| 11012 | Target folder full (max 999 items per folder) |
| 72010002 | Resource already in target folder |

### 2.5 Rate Limiting

No official documentation. Empirically:
- Read endpoints: relatively permissive, ~100 req/min safe
- Write endpoints: more strict, recommend ≤20 req/min
- Rapid bursts may trigger captcha or temp ban
- Recommendation: 3 concurrent read, 2 concurrent write, 300ms inter-batch delay

### 2.6 Default Favorites Folder

Every Bilibili user has a "默认收藏夹" (default favorites) which cannot be deleted. This is the equivalent of Raindrop.io's "Unsorted" collection. Its `media_id` can be found from the `list-all` endpoint (it's typically the first item, or the one where `attr` indicates default).

---

## 3. Competitive Landscape

### 3.1 RadiumAg/bilibili-favorites (Chrome Extension)

**Implementation**: Chrome MV3, React, Vite, CRXJS plugin
**Features**:
- AI keyword extraction (OpenAI/讯飞大模型) from video titles
- TF-IDF local keyword extraction as fallback
- Keyword-to-folder matching rules
- Batch move via B站 API
- Data cached in IndexedDB (24h TTL)
- Popup + Options page UI

**Architecture**:
```
src/
├── background/         — service worker
├── contentScript/      — injects into Bilibili pages
├── popup/              — quick status popup
├── options/            — full settings + sorting UI
├── components/         — analysis/, favorite-tag/, keyword/, quota/
├── hooks/              — custom React hooks
├── workers/            — Web Workers for data analysis
├── utils/
│   ├── api.ts          — Bilibili API wrapper
│   ├── indexed-db.ts   — IndexedDB manager
│   └── keyword-extractor.ts  — TF-IDF implementation
└── store/              — global state
```

**Limitations**:
- Keyword-based matching, not semantic understanding — misses context
- No confidence scores — binary match/no-match
- No sidebar collection tree with counts
- No preview of existing folder contents
- No revert/undo mechanism
- UI is functional but not polished

**What we learn**:
- ✅ MV3 + CRXJS + React is proven viable
- ✅ Using `chrome.cookies` for auth works well
- ✅ IndexedDB caching is essential for performance
- ❌ Keyword matching is inferior to semantic AI classification
- ❌ Options page UI is cramped — Side Panel would be better

### 3.2 Bilibili收藏夹自动分类 (Tampermonkey Script)

**Implementation**: Userscript on Greasyfork
**Features**:
- Categorize by Bilibili 分区 (video category/partition)
- Batch move/copy via B站 API
- Custom grouping rules
- Preview before execution

**Limitations**:
- Rule-based only (by B站分区), no AI
- Limited UI (injected into B站 page)
- No semantic understanding

**What we learn**:
- ✅ 分区 (tname/tid) is a strong sorting signal — should be primary feature in AI prompt
- ✅ Preview before batch execution is important UX

### 3.3 bilibo (Go, Docker)

**Implementation**: Go backend + web frontend, Docker deployment
**Purpose**: Sync + download B站 favorites locally (archival tool, not sorting)
**Sync logic**: Handles video invalidation, un-favorite, folder rename, deletion

**What we learn**:
- ✅ B站 API endpoints are stable and usable from any language
- ✅ Need to handle invalid/deleted videos gracefully (attr bitfield check)
- ❌ bilibo's goal is backup/download, not organization — different use case

### 3.4 Bilibili Favlist Export (Tampermonkey)

**Purpose**: Export favorites to CSV/HTML for import into Raindrop/Firefox bookmarks.

**What we learn**:
- ✅ Export as a potential future feature
- ✅ Cross-platform bridge (B站 → Raindrop) could be interesting long-term

---

## 4. Legal & Risk Assessment

### 4.1 bilibili-API-collect Takedown (2026-01-28)

The most comprehensive B站 API documentation project received a legal warning from Bilibili's lawyers, citing:
> "通过技术手段对哔哩哔哩平台非公开的API接口及其调用逻辑、参数结构、访问控制及安全认证机制进行系统性收集、整理，并以技术文档、代码示例等形式向不特定公众传播"

The project was permanently shut down.

### 4.2 Our Risk Mitigation

1. **We do NOT publish API documentation** — endpoints are used internally in code only
2. **Personal use tool** — organizes user's own favorites, no data extraction
3. **No server component** — cookies never leave the user's browser
4. **Same actions as manual** — moves videos between folders, which users can do via B站's own UI
5. **Open source, non-commercial** — no monetization
6. **Chrome Extension** — Google's extension platform has established legal precedent

Remaining risk: Bilibili could theoretically object to ANY use of undocumented APIs. This risk is inherent and unavoidable for any tool that extends B站 functionality.

---

## 5. BiliSorter Technical Design

### 5.1 Architecture: Chrome Extension (Manifest V3) with Side Panel

```
┌─────────────────────────────────────────────────┐
│ Chrome Extension (Manifest V3)                  │
│                                                 │
│ ┌─────────────┐  ┌────────────┐  ┌───────────┐ │
│ │ Background  │  │ Side Panel │  │  Popup    │ │
│ │ Service     │  │ (React)    │  │ (minimal) │ │
│ │ Worker      │  │            │  │           │ │
│ │             │  │ Dashboard  │  │ Status +  │ │
│ │ • Cookie    │  │ • Sidebar  │  │ Open Side │ │
│ │   access    │  │ • VideoList│  │ Panel btn │ │
│ │ • API proxy │  │ • AI Mgmt │  │           │ │
│ │ • LLM calls │  │            │  │           │ │
│ └──────┬──────┘  └─────┬──────┘  └───────────┘ │
│        │               │                        │
│        └──── chrome.runtime.sendMessage ────┘   │
│                                                 │
│ ┌─────────────────────────────────────────────┐ │
│ │ Storage Layer                               │ │
│ │ • chrome.storage.local (settings, tokens)   │ │
│ │ • IndexedDB (video cache, operation log)    │ │
│ └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────┐  ┌────────────────────┐
│ api.bilibili.com    │  │ LLM API            │
│ (with user cookies) │  │ (user's API key)   │
└─────────────────────┘  └────────────────────┘
```

### 5.2 Auth Flow (vs RainSorter)

| | RainSorter | BiliSorter |
|---|---|---|
| Auth method | OAuth2 (standard) | Cookie extraction (chrome.cookies) |
| Backend needed? | Yes (Express proxy for client_secret) | No |
| Token refresh | Auto via refresh_token | Manual re-login on B站 if expired |
| Security model | Bearer token in headers | Cookie in request headers via background SW |

BiliSorter is SIMPLER: no backend server, no OAuth complexity. The Chrome extension `cookies` permission + `host_permissions` for `*.bilibili.com` gives us direct access.

### 5.3 Data Model Mapping

| RainSorter Concept | BiliSorter Equivalent |
|---|---|
| Raindrop (bookmark) | Video/Media (收藏的视频) |
| Collection/Folder | 收藏夹 (Favorites folder) |
| Unsorted (-1) | 默认收藏夹 (Default favorites) |
| Raindrop.io suggest API | Our own LLM call |
| `_rainsorter` tag | Operation log entry in IndexedDB |
| title, link, excerpt, tags | title, bvid, intro, tags, tname(分区), upper(UP主) |

### 5.4 AI Suggestion Strategy

RainSorter relies on Raindrop's built-in suggest endpoint. We don't have that — we need to build it.

**Prompt design** (per video or per batch):
```
Given the user's existing favorite folders:
1. "编程技术" (45 videos)
2. "音乐收藏" (23 videos)
3. "游戏攻略" (67 videos)
...

Classify this video into the most appropriate folder(s):
- Title: {title}
- Category (分区): {tname}
- Tags: {tags}
- UP主: {upper.name}
- Description: {intro, first 100 chars}

Return JSON: [{folder_id: "...", folder_name: "...", confidence: 0.0-1.0}]
If none fit well, return empty array.
```

**Optimization**:
- Batch multiple videos per LLM call (5-10) to reduce API calls and cost
- Cache results in IndexedDB keyed by video bvid
- Include folder names + sample titles as context for better accuracy
- Use 分区 (tname) as a strong signal — often directly maps to user folders

### 5.5 Component Mapping (RainSorter → BiliSorter)

| RainSorter Component | BiliSorter Equivalent | Changes |
|---|---|---|
| `LoginPage` | Not needed (auto cookie) | Show "Please login to B站" if no cookie |
| `CallbackPage` | Not needed | — |
| `DashboardPage` | `SidePanelApp` | Adapted for 400px side panel width |
| `SuggestionsSidebar` | `CollectionSidebar` | Same pattern, B站 folder data |
| `RaindropsTable` | `VideoList` | Cards instead of table rows (better for narrow panel) |
| `RaindropRow` | `VideoCard` | Thumbnail, title, UP主, 分区, AI badges |
| `CollectionSelectorModal` | `CollectionPicker` | Same tree + search pattern |
| `FolderItemsPanel` | `FolderPreview` | Preview videos already in target folder |
| `Header` | `PanelHeader` | Compact header with status |
| `useRaindrops` | `useVideos` | Fetches from B站 API |
| `useCollections` | `useFolders` | Fetches B站 favorites list |
| `useSuggestions` | `useSuggestions` | LLM-based instead of Raindrop suggest |
| `useAuth` | `useAuth` | Cookie-based, simpler |
| `raindropApi.js` | `bilibiliApi.ts` | B站 endpoint wrappers |
| `collectionsApi.js` | Merged into bilibiliApi | — |
| `authService.js` | `cookieService.ts` | chrome.cookies API |
| `proxyApi.js` | Not needed | No backend proxy |

### 5.6 State Atoms Mapping

| RainSorter Atom | BiliSorter Atom | Notes |
|---|---|---|
| `authAtoms` (accessToken, refreshToken) | `authAtoms` (sessdata, bili_jct, uid) | Cookie-based |
| `raindropsAtom` | `videosAtom` | Array of video media objects |
| `totalCountAtom` | `totalCountAtom` | Same |
| `collectionsAtom` | `foldersAtom` | B站 favorites folder list |
| `collectionsMapAtom` (derived) | `foldersMapAtom` (derived) | id→name |
| `collectionsTreeAtom` (derived) | `foldersTreeAtom` (derived) | B站 folders are flat (no nesting) |
| `suggestionsAtom` | `suggestionsAtom` | Same pattern: {videoId: {folders, confidence}} |
| `selectedSuggestionFolderAtom` | `selectedFolderAtom` | UI filter state |
| `hideSortedAtom` | `hideSortedAtom` | Same |
| `includeSorterTagAtom` | N/A | We use operation log instead |

### 5.7 Manifest V3 Permissions

```json
{
  "manifest_version": 3,
  "permissions": [
    "cookies",
    "storage",
    "sidePanel",
    "activeTab"
  ],
  "host_permissions": [
    "*://*.bilibili.com/*",
    "https://api.bilibili.com/*"
  ],
  "side_panel": {
    "default_path": "src/sidepanel/index.html"
  },
  "background": {
    "service_worker": "src/background/index.ts"
  },
  "action": {
    "default_popup": "src/popup/index.html"
  }
}
```

### 5.8 Operation Log (replacing RainSorter's tag system)

RainSorter appends `_rainsorter` tags to moved bookmarks. We can't tag B站 videos, so we use a local operation log in IndexedDB:

```typescript
interface OperationLog {
  id: string;           // auto-generated
  timestamp: number;
  videoId: number;      // avid
  bvid: string;
  videoTitle: string;
  fromFolder: number;   // source media_id
  toFolder: number;     // target media_id
  method: 'ai' | 'manual';
  aiConfidence?: number;
  undone: boolean;
}
```

This enables:
- Full history review
- Undo individual moves or batch undo
- Statistics (how many AI vs manual, accuracy over time)
- Export operation history

---

## 6. Implementation Phases

### Phase 1: Core MVP
- Chrome MV3 extension scaffold (CRXJS + Vite + React)
- Cookie extraction from Background Service Worker
- B站 API service (get folders, get videos, move videos)
- Side Panel with VideoList + CollectionSidebar
- Manual move (no AI yet) — drag/pick collection
- Operation log in IndexedDB

### Phase 2: AI Integration
- LLM service abstraction (OpenAI, Deepseek, Ollama)
- Settings page for API key configuration
- AI suggestion engine (prompt design, batching, caching)
- Suggestion badges on VideoCards with confidence scores
- One-click AI sorting flow

### Phase 3: Polish
- FolderPreview panel (see what's already in folder)
- Batch operations (select multiple → move all)
- Undo/revert from operation log
- Video thumbnail display
- Loading states, error handling, rate limit recovery
- Dark theme matching B站 aesthetic
- Keyboard shortcuts

### Phase 4: Advanced
- Invalid video detection + cleanup suggestions
- Duplicate detection across folders
- Analytics dashboard (collection health, coverage)
- Export/import folder configurations
- "Smart folders" — auto-suggest new folder creation when AI finds no match
