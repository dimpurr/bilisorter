# BiliSorter v0.1 — Implementation Plan

> 12 steps. Each `- [ ]` is one agent loop iteration. Complete ONE per loop, mark `[x]`, commit.

---

## Context

You are implementing BiliSorter v0.1, an AI-powered Chrome extension (Manifest V3) that helps users organize their Bilibili favorites into folders using Claude AI suggestions. This is a greenfield implementation in a pnpm monorepo. The extension lives in `apps/bilisorter-ext/`. There is **no backend** — all logic runs in the browser (background service worker + popup).

---

## Reference Files

Read the relevant files before EACH step. Do NOT implement from memory.

**Specs (source of truth for behavior)**:
- `docs/VISION.md` — Mission, principles, non-goals, product shape
- `docs/HLD.md` — Architecture, all flows, data model, UI layout, API surface, error handling, empty states
- `docs/initial-discussion-log.md` — Tech/feature debate record (historical context only)
- `docs/research-log-n-suggestion.md` — B站 API surface, competitive analysis (reference for API details)

**Sister project (follow its patterns)**:
- `apps/reedle-extension/` (if accessible at `../../parallels/3rd/papper-3rd/apps/reedle-extension/`) — WXT extension structure, `entrypoints/background.ts`, `entrypoints/popup/`, `wxt.config.ts`, `package.json`. BiliSorter explicitly mirrors reedle-extension's architecture.

**Key architecture decisions** (from HLD):
- WXT framework, React 18, vanilla CSS, TypeScript
- useState only (no state lib), chrome.storage.local for persistence
- Background SW: cookie extraction, B站 API calls, Claude API calls
- Popup: sole UI surface, 400px fixed width, dark theme (#17181A)
- Messaging: Port for long-running ops, sendMessage for one-shot
- No content script, no side panel, no options page

---

## Build & Run

```bash
# Install dependencies (from monorepo root)
pnpm install

# Dev mode with HMR (WXT dev server)
cd apps/bilisorter-ext && pnpm dev

# Production build
cd apps/bilisorter-ext && pnpm build

# Load in Chrome: chrome://extensions → Load unpacked → select apps/bilisorter-ext/.output/chrome-mv3-dev/
```

---

## Rules

1. **Re-read before each step**: Before implementing any step, re-read the HLD section listed in that step. Do NOT implement from memory.
2. **Sister project patterns**: Before writing new code, check reedle-extension for conventions (file structure, WXT config, manifest shape). Follow similar patterns where applicable.
3. **Atomic commits**: After completing each step, `git add` changed files and commit with `feat(bilisorter): <description>`. One commit per step.
4. **Mark progress**: After completing each step, edit this file to change `- [ ]` to `- [x]` for that step.
5. **Recovery protocol**: If you lose context or get confused, re-read THIS file first, find the first unchecked `- [ ]` step, and continue from there.
6. **No over-engineering**: Implement what the HLD says for v0.1, nothing more. Ignore v1 and Future items.
7. **No code in HLD**: The HLD deliberately omits prompt text, exact CSS, and implementation details. These are your engineering decisions — but stay within HLD constraints.
8. **Security**: Do not hardcode API keys. Store Claude API key in chrome.storage.local. B站 cookies are read-only via chrome.cookies API. All fetch calls use HTTPS.
9. **Verify each step**: After each step, run `pnpm build` in `apps/bilisorter-ext/` (once scaffold exists). Fix any TypeScript or build errors before moving on.

---

## Phase 1: Foundation (Steps 1–3)

- [ ] **Step 1: WXT Extension Scaffold**
  - **Spec**: `docs/HLD.md` §Tech Stack (lines 55–65), §System Architecture (lines 17–52)
  - **Sister**: reedle-extension's `wxt.config.ts`, `package.json`, `tsconfig.json`, `entrypoints/` structure
  - **Create**:
    - `apps/bilisorter-ext/package.json` — dependencies: wxt, react, react-dom, @types/react, @types/react-dom, @anthropic-ai/sdk (or raw fetch — see note), typescript
    - `apps/bilisorter-ext/wxt.config.ts` — WXT config with React support, manifest V3 permissions
    - `apps/bilisorter-ext/tsconfig.json`
    - `apps/bilisorter-ext/entrypoints/background.ts` — empty service worker scaffold with `export default defineBackground(() => {})`
    - `apps/bilisorter-ext/entrypoints/popup/index.html` — popup HTML entry
    - `apps/bilisorter-ext/entrypoints/popup/main.tsx` — React 18 createRoot
    - `apps/bilisorter-ext/entrypoints/popup/App.tsx` — empty shell with "BiliSorter" text
    - `apps/bilisorter-ext/entrypoints/popup/App.css` — dark theme base (`#17181A` background, white text)
    - `apps/bilisorter-ext/lib/types.ts` — TypeScript types: Folder, Video, Suggestion, LogEntry, Settings, MessageTypes (for Port/sendMessage)
    - `apps/bilisorter-ext/lib/constants.ts` — storage keys (`bilisorter_settings`, `bilisorter_folders`, etc.), API base URLs
    - `apps/bilisorter-ext/public/icon/` — placeholder extension icons (16, 32, 48, 128px)
  - **Manifest permissions** (via wxt.config.ts):
    - `permissions: ["cookies", "storage"]`
    - `host_permissions: ["*://*.bilibili.com/*", "https://api.bilibili.com/*"]`
  - **Verify**: `pnpm install && pnpm build` succeeds. Extension loads in Chrome and shows popup with dark background.
  - **Note**: Consider using raw `fetch()` for Claude API instead of `@anthropic-ai/sdk` — the SDK is large and may have Node dependencies incompatible with service workers. Raw fetch is lighter and guaranteed MV3-compatible.

- [ ] **Step 2: Background Service Worker — Auth + Cookie Extraction**
  - **Spec**: `docs/HLD.md` §Authentication (lines 73–95), §Manifest Permissions (lines 99–113), §Messaging Pattern (lines 119–125), §Flow 1 (lines 127–141)
  - **Create**:
    - `apps/bilisorter-ext/lib/bilibiliApi.ts` — functions: `extractCookies()` (reads SESSDATA, bili_jct, DedeUserID via chrome.cookies.get), `checkAuth(cookies)` (calls `/x/web-interface/nav`, returns {loggedIn, uid, username} or {loggedIn: false}), `buildCookieHeader(cookies)` (formats Cookie header string)
  - **Update**:
    - `apps/bilisorter-ext/entrypoints/background.ts` — register `chrome.runtime.onMessage` listener for `CHECK_AUTH` message type. Extracts cookies, calls checkAuth, responds with auth status. Handle DedeUserID fallback (read uid from nav API `data.mid` if cookie missing).
  - **What to implement**:
    - Cookie extraction: `chrome.cookies.get({url: 'https://www.bilibili.com', name: 'SESSDATA'})` for each required cookie
    - Auth check: `GET /x/web-interface/nav` with manual Cookie header → check `data.isLogin`
    - Message handler: `{type: 'CHECK_AUTH'}` → `{loggedIn: boolean, uid?: string, username?: string}`
  - **Verify**: Build succeeds. Manually test: open popup → send CHECK_AUTH from devtools console → verify response.

- [ ] **Step 3: Popup Shell — Layout, Header, Button Bar**
  - **Spec**: `docs/HLD.md` §UI Layout (lines 402–448), §Flow 1 (lines 127–141), §Empty States (lines 370–383), §Design Constraints (lines 434–448)
  - **Create**:
    - `apps/bilisorter-ext/entrypoints/popup/components/Header.tsx` — username display, source folder dropdown (disabled until folders loaded), ⚙️ settings toggle icon
    - `apps/bilisorter-ext/entrypoints/popup/components/ButtonBar.tsx` — [📥 索引] [✨ 建议] [📤 导出] [📋 日志] buttons with disabled states
    - `apps/bilisorter-ext/entrypoints/popup/components/StatusBar.tsx` — progress text ("正在索引... 45/234"), video count ("{N} 个视频"), "Last indexed: {timestamp}" label
    - `apps/bilisorter-ext/entrypoints/popup/components/EmptyState.tsx` — conditional rendering for all 8 empty states from HLD
  - **Update**:
    - `App.tsx` — main layout: sticky header + button bar at top, scrollable content area, toast area at bottom. Wire CHECK_AUTH on mount → show login prompt or main UI.
    - `App.css` — full dark theme styles. 400px fixed width. Sticky header. Overflow-y scroll for content area.
  - **What to implement**:
    - On mount: read cache from chrome.storage.local → display if exists. Send CHECK_AUTH → update login state.
    - Empty state rendering based on: loggedIn, hasCache, hasApiKey, hasVideos, hasFolders (from HLD §Empty States).
    - All buttons initially disabled except 📥 (if logged in) and ⚙️ (always).
  - **Verify**: Build succeeds. Popup shows dark theme, proper layout, "请先登录 bilibili.com" if not logged in.

---

## Phase 2: Core Data Flows (Steps 4–6)

- [ ] **Step 4: Index Flow — Fetch Folders + Videos**
  - **Spec**: `docs/HLD.md` §Flow 2 (lines 143–196), §Messaging Pattern (Port-based), §默认收藏夹 identification, §Folder sampling rationale, §Video data shape
  - **Update**:
    - `apps/bilisorter-ext/lib/bilibiliApi.ts` — add functions: `fetchFolders(uid, cookies)` (calls `/x/v3/fav/folder/created/list-all`), `fetchFolderSample(folderId, mediaCount, cookies)` (fetches random page, returns 10 sample titles), `fetchVideos(folderId, cookies, onProgress)` (paginated fetch, ps=20, yields progress)
    - `apps/bilisorter-ext/entrypoints/background.ts` — register Port listener for `INDEX` message type. Full flow: read settings → fetch all folders → sample each folder → determine source folder (from settings or first/default) → paginate source folder videos → send FOLDERS_READY, FETCH_PROGRESS, INDEX_COMPLETE messages on Port.
  - **Update**:
    - `App.tsx` — wire 📥 button to open Port and send INDEX. Handle progress messages: update progress bar. On INDEX_COMPLETE: save to chrome.storage.local with timestamp, display video list.
  - **Create**:
    - `apps/bilisorter-ext/entrypoints/popup/components/VideoList.tsx` — scrollable list of video cards. Each card: 60×45 thumbnail, title (clickable → B站 page), UP主, play count, fav_time. Invalid videos (attr≠0) grayed out with [已失效] badge.
    - `apps/bilisorter-ext/entrypoints/popup/components/VideoCard.tsx` — individual video card component.
  - **What to implement**:
    - Port-based communication: popup opens Port → background processes → sends progress → closes Port
    - Popup close → background aborts via onDisconnect (no partial cache)
    - Random sampling: `Math.ceil(Math.random() * Math.ceil(media_count/20))`, skip if media_count=0
    - Source folder selection: read `bilisorter_settings.sourceFolderId` from storage; fallback to first folder in API response (默认收藏夹)
    - Folder dropdown change → re-triggers video fetch automatically (reuse cached folders)
    - Cache: `bilisorter_folders` (with sampleTitles), `bilisorter_videos` (with timestamp)
    - Duplicate folder name handling: append " (N)" if duplicates exist
  - **Verify**: Build succeeds. Click 📥 → folders + videos load with progress → list displays correctly. Close/reopen popup → cached data shows instantly.

- [ ] **Step 5: Settings Panel**
  - **Spec**: `docs/HLD.md` §Flow 7 Settings (lines 319–335)
  - **Create**:
    - `apps/bilisorter-ext/entrypoints/popup/components/SettingsPanel.tsx` — collapsible panel toggled by ⚙️ icon. Fields: Claude API Key (password input), Model dropdown (claude-3-5-haiku-latest / claude-sonnet-4-latest, default: haiku), Source folder dropdown (populated from cached folders). All saved to chrome.storage.local key `bilisorter_settings`.
  - **Update**:
    - `App.tsx` — wire settings toggle, read/write settings from storage. Show pulsing dot on ⚙️ if API key not set.
  - **What to implement**:
    - Read settings on popup open
    - Save on every field change (debounced or on blur)
    - No validation beyond "API key is non-empty" — invalid keys surface as Claude 401 errors
    - Source folder dropdown updates on re-index
  - **Verify**: Build succeeds. Settings panel opens/closes. Values persist across popup close/reopen.

- [ ] **Step 6: AI Suggestion Generation**
  - **Spec**: `docs/HLD.md` §Flow 3 (lines 197–260), §Prompt Structure, §LLM Response JSON, §Claude API Error Handling, §Source folder exclusion, §Always min(5, available_folders)
  - **Create**:
    - `apps/bilisorter-ext/lib/claudeApi.ts` — functions: `generateSuggestions(videos, folders, sourceFolderId, apiKey, model)` (batches videos 5-10, constructs prompt per HLD §Prompt Structure inputs, calls Claude API via raw fetch, parses + validates JSON response, handles retries). Returns `{[bvid]: Suggestion[]}`.
  - **Update**:
    - `apps/bilisorter-ext/entrypoints/background.ts` — register Port listener for `GET_SUGGESTIONS`. Full flow: read API key from storage → filter invalid videos and source folder → batch → call claudeApi per batch with 300ms delay → send SUGGESTION_PROGRESS per batch → send SUGGESTIONS_COMPLETE.
    - `App.tsx` — wire ✨ button to open Port and send GET_SUGGESTIONS. Handle progress. On complete: save suggestions to `bilisorter_suggestions` in chrome.storage.local. Re-clicking ✨ regenerates all.
  - **What to implement**:
    - Prompt inputs (per batch): system message (role + JSON output format), folder context (excluding source: {id, name, item_count, sample_titles[10]}), video metadata ({bvid, title, tags, upper_name, intro_truncated})
    - Expected output: JSON `{classifications: [{bvid, suggestions: [{folder_id, folder_name, confidence}]}]}`
    - Response validation: parse JSON → validate structure → on fail: retry once → on second fail: skip batch, toast error
    - Error handling table: 401 → "API Key 无效" + open settings; 429 → pause 30s + retry; 500/503 → toast; network → toast; malformed → retry once
    - min(5, available_folders) suggestions per video, confidence 0.0-1.0
    - Source folder excluded from suggestions
    - Popup close → abort via onDisconnect
  - **Verify**: Build succeeds. Click ✨ → progress updates → badges appear under videos. Test with invalid API key → proper error toast.

---

## Phase 3: Interaction Flows (Steps 7–9)

- [ ] **Step 7: AI Suggestion Badges UI**
  - **Spec**: `docs/HLD.md` §Design Constraints (badge colors, progress bars), §UI Layout mockup (lines 416–431)
  - **Update**:
    - `apps/bilisorter-ext/entrypoints/popup/components/VideoCard.tsx` — render suggestion badges below each video. Each badge: pill-shaped, folder name text, small colored progress bar (≥80% green, 50-79% yellow/amber, <50% grey). Clickable — triggers move flow (Step 8). Up to min(5, available_folders) badges per video, ranked by confidence. Badges visually de-emphasize low confidence but remain clickable.
    - `App.css` — badge styles: pill shape, progress bar inside, color coding, hover state, click feedback.
  - **Verify**: Build succeeds. Badges display with correct colors and widths matching confidence. Visually matches HLD mockup.

- [ ] **Step 8: Move Flow — Optimistic Removal + 5s Undo Toast**
  - **Spec**: `docs/HLD.md` §Flow 4 (lines 261–291), §Optimistic visual removal, §Cache update timing, §Toast stacking, §resourceType
  - **Create**:
    - `apps/bilisorter-ext/entrypoints/popup/components/ToastStack.tsx` — toast container at bottom of popup. Renders stacked toasts, each with: video title (truncated), target folder name, 5s visual countdown, "撤销" button. Max 5 visible (oldest auto-dismissed). Each toast independent timer.
  - **Update**:
    - `apps/bilisorter-ext/lib/bilibiliApi.ts` — add function: `moveVideo(srcFolderId, dstFolderId, resourceId, cookies)` (POST `/x/v3/fav/resource/move`, resources format `{id}:2`, includes bili_jct CSRF)
    - `apps/bilisorter-ext/entrypoints/background.ts` — register sendMessage listener for `MOVE_VIDEO`. Extracts cookies, calls moveVideo API, returns success/failure.
    - `App.tsx` — full move flow: click badge → remove video from local state (optimistic) → show toast with 5s timer → if undo: re-insert at original position → if 5s passes: sendMessage MOVE_VIDEO → on success: update chrome.storage.local (remove from bilisorter_videos + bilisorter_suggestions, append to bilisorter_operation_log) → on failure: re-insert video + error toast.
    - `VideoCard.tsx` — badge onClick triggers move flow. Fade-out animation on the card.
  - **What to implement**:
    - Optimistic removal: video removed from React state immediately (before any API call)
    - Cache update ONLY after 5s + API success
    - Popup close during 5s → timer cancelled, no API call, video remains in cache (reappears on next open)
    - Toast: "已移动《{title}》→ [{folder}] — 撤销 5s"
    - Operation log entry: `{timestamp, videoTitle, bvid, fromFolderName (lookup from folder cache), toFolderName (from badge)}`
    - B站 error handling: -101 (not logged in), -111 (CSRF retry), 11012 (folder full), 72010002 (already in target → skip silently)
  - **Verify**: Build succeeds. Click badge → video fades out → toast appears → undo works → 5s passes → API call succeeds. Test rapid-fire: click 3 badges → 3 stacked toasts → undo any one.

- [ ] **Step 9: Export JSON + Operation Log**
  - **Spec**: `docs/HLD.md` §Flow 5 Export (lines 293–302), §Flow 6 Operation Log (lines 304–318)
  - **Create**:
    - `apps/bilisorter-ext/entrypoints/popup/components/OperationLogModal.tsx` — modal overlay. Reads `bilisorter_operation_log` from chrome.storage.local. Displays list: "{timestamp} — 《{videoTitle}》→ [{folderName}]", sorted newest first. Read-only, no actions. Shows "暂无操作记录" if empty.
  - **Update**:
    - `App.tsx` — wire 📤 button: construct JSON from current video list + suggestions (empty [] if not generated), trigger browser download as `bilisorter-export-{date}.json`. Wire 📋 button: open/close operation log modal.
  - **What to implement**:
    - Export shape: `{exportDate, sourceFolderId, sourceFolderName, videos: [{title, bvid, cover, upper, tags, fav_time, suggestions: [{folderName, confidence}]}]}`
    - Export with no suggestions → suggestions is empty array per video
    - Log is permanent, append-only, stored in chrome.storage.local
    - 📤 disabled when no indexed data exists
    - 📋 always enabled (shows empty state if no entries)
  - **Verify**: Build succeeds. Export downloads valid JSON file. Log modal opens, shows entries after moves.

---

## Phase 4: Polish (Steps 10–12)

- [ ] **Step 10: Empty States + Error Handling**
  - **Spec**: `docs/HLD.md` §Empty States (lines 370–383), §Button states, §Error Handling table (lines 352–362), §Claude API Error Handling (lines 251–260)
  - **Update**:
    - `App.tsx` / `EmptyState.tsx` — implement ALL 8 empty states from HLD:
      1. Not logged in → "请先登录 bilibili.com" with link, no buttons except ⚙️
      2. Logged in, no cache, no API key → 📥 enabled, ✨ disabled + hint, ⚙️ pulsing dot
      3. Logged in, no cache, API key set → 📥 enabled, others inactive
      4. Source folder empty → "该收藏夹为空"
      5. All videos [已失效] → list grayed, ✨ disabled + "没有有效视频可分析"
      6. Only 1 folder → "没有目标收藏夹，请先在 B站 创建收藏夹"
      7. AI all failed → toast error, videos without badges
      8. AI partially failed → successful badges shown, toast "已跳过 N 个"
    - Button state management: 📤 disabled without data, 📋 always enabled, ⚙️ always accessible
  - **What to implement**:
    - B站 API error handling: code -101 (re-login), -111 (CSRF retry with fresh bili_jct), -400/-403 (toast), 11012 (folder full), 72010002 (already in target → skip)
    - Claude API error handling: 401/429/500/503/network/malformed (per HLD table)
    - Network timeout handling for both APIs
  - **Verify**: Build succeeds. Test each empty state manually by manipulating storage. Test error scenarios.

- [ ] **Step 11: Visual Polish**
  - **Spec**: `docs/HLD.md` §Design Constraints (lines 434–448), §UI Layout mockup
  - **Update all CSS and components**:
    - Dark theme: `#17181A` background, proper text colors, contrast
    - Thumbnails: 60×45px, proper aspect ratio, loading placeholder
    - Badge pills: progress bar fills, color coding (green/yellow/grey), hover effects
    - Toast animations: slide-in from bottom, countdown animation, fade-out on dismiss
    - Video card: fade-out animation on optimistic removal, slide-in animation on undo re-insert
    - Sticky header + button bar (no scroll with content)
    - Scroll shadow or divider between sticky area and scrollable list
    - Settings panel: smooth expand/collapse animation
    - Progress: clear progress text during index + AI suggestion phases
    - Responsive within 400px width — no horizontal overflow
    - Modal overlay for operation log — proper z-index, backdrop blur
  - **Verify**: Build succeeds. Visual matches HLD mockup. All animations smooth. No layout overflow.

- [ ] **Step 12: Integration Verification**
  - **Spec**: All — cross-reference checklist
  - **What to verify**:
    - `pnpm build` succeeds with zero TypeScript errors
    - Extension loads in Chrome (chrome://extensions → Load unpacked)
    - Fresh install flow: popup opens → "请先登录" → log in on B站 → reopen → 📥 works
    - Full happy path: 📥 索引 → folders + videos load → ✨ 建议 → badges appear → click badge → toast → 5s → video moved → 📋 log shows entry → 📤 export downloads JSON
    - Cache-first: close popup → reopen → cached data shows immediately with "Last indexed" timestamp
    - Settings: API key persists, model selection persists, source folder persists
    - Edge cases: empty folder, no API key, invalid API key, all videos invalid, only 1 folder
    - Toast stacking: rapid-click 3 badges → 3 toasts → undo middle one
    - Popup close during index → reopen → no partial data, clean state
    - Popup close during 5s undo → reopen → video still in list (safe default)
    - No hardcoded API keys or secrets
    - All external links (video title click) open in new tab
  - **Fix**: any issues found during verification
  - **Final commit**: `feat(bilisorter): v0.1 integration verification`

---

## File Structure (final expected state)

```
apps/bilisorter-ext/
├── entrypoints/
│   ├── background.ts          # Service Worker: cookie, B站 API, Claude API, Port + sendMessage handlers
│   └── popup/
│       ├── index.html
│       ├── main.tsx
│       ├── App.tsx             # Main component: state management, flow orchestration
│       ├── App.css             # Full dark theme styles
│       └── components/
│           ├── Header.tsx          # Username, folder dropdown, ⚙️ toggle
│           ├── ButtonBar.tsx       # 📥 ✨ 📤 📋 buttons with disabled states
│           ├── StatusBar.tsx       # Progress text, video count, last indexed
│           ├── VideoList.tsx       # Scrollable video card list
│           ├── VideoCard.tsx       # Individual video card + AI suggestion badges
│           ├── SettingsPanel.tsx   # Collapsible API key, model, source folder
│           ├── ToastStack.tsx      # Stacked 5s undo toasts
│           ├── OperationLogModal.tsx # Read-only move history modal
│           └── EmptyState.tsx      # All 8 empty state renderings
├── lib/
│   ├── bilibiliApi.ts      # B站 API: auth, folders, videos, move
│   ├── claudeApi.ts         # Claude API: batch suggestions, error handling
│   ├── constants.ts         # Storage keys, API URLs, defaults
│   └── types.ts             # TypeScript types for all data shapes
├── public/
│   └── icon/                # Extension icons (16, 32, 48, 128px)
├── wxt.config.ts
├── package.json
└── tsconfig.json
```

---

## Notes for Agent

- **Total files to create**: ~20 (including config files)
- **No tests in v0.1** — verify via build + manual testing only
- **No deployment** — human loads the unpacked extension manually
- **Prompt engineering** is an implementation detail — HLD specifies inputs/outputs but not the exact prompt text. Design the prompt yourself based on the input/output contract.
- **CSS is vanilla** — no Tailwind, no CSS-in-JS. One App.css file with all styles, or split per component if preferred.
- **Error recovery**: If a step fails to build, fix the errors before moving to the next step. Do NOT proceed with broken builds.

---

*Derived from HLD.md and VISION.md | 2026-02*
