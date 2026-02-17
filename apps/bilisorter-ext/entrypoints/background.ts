import { defineBackground } from 'wxt/sandbox';
import {
  extractCookies,
  checkAuth,
  fetchFolders,
  fetchFolderSample,
  fetchVideos,
  moveVideo,
  sortFolders,
  renameFolder,
  RateLimitError,
} from '../lib/bilibiliApi';
import { generateSuggestions } from '../lib/aiApi';
import type {
  AuthResponse,
  Folder,
  Video,
  Suggestion,
  SourceMeta,
  FolderIndexCheckpoint,
  PortMessage,
} from '../lib/types';
import { STORAGE_KEYS, SAMPLING, SOURCE } from '../lib/constants';

export default defineBackground(() => {
  console.log('[BiliSorter] Background service worker started (v0.2 three-pool)');

  // Track active ports for cleanup
  const activePorts = new Map<string, chrome.runtime.Port>();

  // Track in-progress operations
  let indexStatus: {
    inProgress: boolean;
    progress?: string;
    error?: string;
  } = { inProgress: false };

  let suggestStatus: {
    inProgress: boolean;
    progress?: string;
    error?: string;
  } = { inProgress: false };

  /**
   * Safely post a message to a port, catching errors if port is disconnected.
   */
  function safePostMessage(port: chrome.runtime.Port, message: PortMessage): boolean {
    try {
      port.postMessage(message);
      return true;
    } catch (e) {
      console.log('[BiliSorter] Port disconnected, continuing operation in background');
      return false;
    }
  }

  // ─── One-shot message handlers ───

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'CHECK_AUTH') {
      handleCheckAuth().then(sendResponse).catch((error) => {
        console.error('[BiliSorter] CHECK_AUTH error:', error);
        sendResponse({ loggedIn: false });
      });
      return true;
    }

    if (message.type === 'GET_INDEX_STATUS') {
      sendResponse({ ...indexStatus });
      return true;
    }

    if (message.type === 'GET_SUGGEST_STATUS') {
      sendResponse({ ...suggestStatus });
      return true;
    }

    if (message.type === 'GET_COOKIES') {
      extractCookies().then(sendResponse).catch(() => sendResponse(null));
      return true;
    }

    if (message.type === 'MOVE_VIDEO') {
      const { srcFolderId, dstFolderId, resourceId } = message;
      extractCookies()
        .then((cookies) => {
          if (!cookies) throw new Error('未登录');
          return moveVideo(srcFolderId, dstFolderId, resourceId, cookies);
        })
        .then(sendResponse)
        .catch((error) => sendResponse({ success: false, error: error.message }));
      return true;
    }

    if (message.type === 'FETCH_SOURCE') {
      handleFetchSource(message.folderId).then(sendResponse).catch((error) => {
        console.error('[BiliSorter] FETCH_SOURCE error:', error);
        sendResponse({ success: false, error: error.message });
      });
      return true;
    }

    if (message.type === 'REFRESH_SOURCE') {
      handleRefreshSource(message.folderId).then(sendResponse).catch((error) => {
        console.error('[BiliSorter] REFRESH_SOURCE error:', error);
        sendResponse({ success: false, error: error.message });
      });
      return true;
    }

    if (message.type === 'LOAD_MORE') {
      handleLoadMore().then(sendResponse).catch((error) => {
        console.error('[BiliSorter] LOAD_MORE error:', error);
        sendResponse({ success: false, error: error.message });
      });
      return true;
    }

    if (message.type === 'FORCE_REINDEX') {
      handleForceReindex().then(sendResponse).catch((error) => {
        console.error('[BiliSorter] FORCE_REINDEX error:', error);
        sendResponse({ success: false, error: error.message });
      });
      return true;
    }

    if (message.type === 'SORT_FOLDERS') {
      const { folderIds } = message;
      extractCookies()
        .then((cookies) => {
          if (!cookies) throw new Error('未登录');
          return sortFolders(folderIds, cookies);
        })
        .then(async (result) => {
          if (result.success) {
            // Reorder folders in storage to match new order
            const stored = await chrome.storage.local.get(STORAGE_KEYS.FOLDERS);
            const currentFolders: Folder[] = stored[STORAGE_KEYS.FOLDERS] || [];
            const folderMap = new Map(currentFolders.map(f => [f.id, f]));
            const reordered = folderIds
              .map(id => folderMap.get(id))
              .filter((f): f is Folder => f !== undefined);
            await chrome.storage.local.set({ [STORAGE_KEYS.FOLDERS]: reordered });
          }
          sendResponse(result);
        })
        .catch((error) => sendResponse({ success: false, error: error.message }));
      return true;
    }

    if (message.type === 'RENAME_FOLDER') {
      const { folderId, title } = message;
      extractCookies()
        .then((cookies) => {
          if (!cookies) throw new Error('未登录');
          return renameFolder(folderId, title, cookies);
        })
        .then(async (result) => {
          if (result.success) {
            // Update folder name in storage
            const stored = await chrome.storage.local.get(STORAGE_KEYS.FOLDERS);
            const currentFolders: Folder[] = stored[STORAGE_KEYS.FOLDERS] || [];
            const updated = currentFolders.map(f =>
              f.id === folderId ? { ...f, name: title } : f
            );
            await chrome.storage.local.set({ [STORAGE_KEYS.FOLDERS]: updated });
          }
          sendResponse(result);
        })
        .catch((error) => sendResponse({ success: false, error: error.message }));
      return true;
    }

    return false;
  });

  // ─── Port-based message handlers ───

  chrome.runtime.onConnect.addListener((port) => {
    console.log('[BiliSorter] Port connected:', port.name);
    activePorts.set(port.name, port);

    port.onMessage.addListener((message: PortMessage) => {
      if (message.type === 'INDEX_FOLDERS') {
        handleIndexFolders(port);
      } else if (message.type === 'GET_SUGGESTIONS') {
        handleGetSuggestions(port);
      }
    });

    port.onDisconnect.addListener(() => {
      console.log('[BiliSorter] Port disconnected:', port.name);
      activePorts.delete(port.name);
    });
  });

  // ─── Auth ───

  async function handleCheckAuth(): Promise<AuthResponse> {
    const cookies = await extractCookies();
    if (!cookies) {
      return { loggedIn: false };
    }
    const authResult = await checkAuth(cookies);
    return authResult;
  }

  // ─── Pool 1: Folder Index (checkpoint-aware) ───

  async function loadCheckpoint(): Promise<FolderIndexCheckpoint | null> {
    const result = await chrome.storage.local.get(STORAGE_KEYS.FOLDER_CHECKPOINT);
    return result[STORAGE_KEYS.FOLDER_CHECKPOINT] || null;
  }

  async function saveCheckpoint(checkpoint: FolderIndexCheckpoint): Promise<void> {
    await chrome.storage.local.set({ [STORAGE_KEYS.FOLDER_CHECKPOINT]: checkpoint });
  }

  async function loadFolderSamples(): Promise<Record<string, string[]>> {
    const result = await chrome.storage.local.get(STORAGE_KEYS.FOLDER_SAMPLES);
    return result[STORAGE_KEYS.FOLDER_SAMPLES] || {};
  }

  async function saveFolderSamples(samples: Record<string, string[]>): Promise<void> {
    await chrome.storage.local.set({ [STORAGE_KEYS.FOLDER_SAMPLES]: samples });
  }

  async function handleIndexFolders(port: chrome.runtime.Port): Promise<void> {
    console.log('[BiliSorter] Starting folder index (Pool 1)');

    if (indexStatus.inProgress) {
      safePostMessage(port, { type: 'ERROR', error: '索引操作已在进行中' });
      return;
    }

    indexStatus = { inProgress: true, progress: '正在连接...' };

    try {
      const cookies = await extractCookies();
      if (!cookies) {
        indexStatus = { inProgress: false, error: '未登录' };
        safePostMessage(port, { type: 'ERROR', error: '未登录' });
        return;
      }

      const authResult = await checkAuth(cookies);
      if (!authResult.loggedIn || !authResult.uid) {
        indexStatus = { inProgress: false, error: '登录已过期' };
        safePostMessage(port, { type: 'ERROR', error: '登录已过期' });
        return;
      }

      const uid = authResult.uid;

      // Always fetch fresh folder list (1 API call)
      indexStatus.progress = '正在获取收藏夹列表...';
      const folders = await fetchFolders(uid, cookies);
      console.log('[BiliSorter] Fetched', folders.length, 'folders');

      // Load or create checkpoint
      let checkpoint = await loadCheckpoint();
      if (!checkpoint || checkpoint.uid !== uid) {
        checkpoint = {
          uid,
          foldersSampled: [],
          totalFolders: folders.length,
          timestamp: Date.now(),
        };
        await saveCheckpoint(checkpoint);
      }

      // Load cached folder samples and apply to folders
      const folderSamples = await loadFolderSamples();
      const sampledSet = new Set(checkpoint.foldersSampled);

      for (const folder of folders) {
        const cached = folderSamples[String(folder.id)];
        if (cached) {
          folder.sampleTitles = cached;
        }
      }

      // Send initial folders (with cached samples)
      safePostMessage(port, { type: 'FOLDERS_READY', folders });

      // Sample remaining folders
      const foldersToSample = folders.filter(
        (f) => f.media_count > 0 && !sampledSet.has(f.id)
      );

      console.log('[BiliSorter] Sampling', foldersToSample.length, 'remaining folders (', sampledSet.size, 'already cached)');

      for (let i = 0; i < foldersToSample.length; i++) {
        const folder = foldersToSample[i];
        const overallProgress = sampledSet.size + i + 1;

        indexStatus.progress = `采样收藏夹 ${overallProgress}/${folders.length} — ${folder.name}`;
        safePostMessage(port, {
          type: 'SAMPLING_PROGRESS',
          sampled: overallProgress,
          total: folders.length,
          currentFolder: folder.name,
        });

        try {
          const sampleTitles = await fetchFolderSample(folder.id, folder.media_count, cookies);
          folder.sampleTitles = sampleTitles;

          // Persist immediately (crash-safe)
          folderSamples[String(folder.id)] = sampleTitles;
          checkpoint.foldersSampled.push(folder.id);
          await saveFolderSamples(folderSamples);
          await saveCheckpoint(checkpoint);

        } catch (error) {
          if (error instanceof RateLimitError) {
            console.log('[BiliSorter] Rate limited during sampling at folder', folder.id);
            await saveFolderSamples(folderSamples);
            await saveCheckpoint(checkpoint);
            await chrome.storage.local.set({ [STORAGE_KEYS.FOLDERS]: folders });

            indexStatus = { inProgress: false, progress: `已暂停 — 已采样 ${sampledSet.size + i}/${folders.length} 收藏夹` };
            safePostMessage(port, {
              type: 'INDEX_FOLDERS_PAUSED',
              reason: '触发B站速率限制 (412)，请稍后继续',
              sampled: sampledSet.size + i,
              totalFolders: folders.length,
            });
            return;
          }
          // Non-rate-limit error — skip this folder
          console.warn('[BiliSorter] Error sampling folder', folder.id, '— skipping:', error);
          folder.sampleTitles = [];
        }

        if (i < foldersToSample.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, SAMPLING.DELAY_MS));
        }
      }

      // All folders sampled — save and clear checkpoint
      const timestamp = Date.now();
      await chrome.storage.local.set({
        [STORAGE_KEYS.FOLDERS]: folders,
        [STORAGE_KEYS.FOLDER_INDEX_TIME]: timestamp,
      });
      await chrome.storage.local.remove(STORAGE_KEYS.FOLDER_CHECKPOINT);

      indexStatus = { inProgress: false };
      safePostMessage(port, {
        type: 'INDEX_FOLDERS_COMPLETE',
        folders,
        timestamp,
      });

      console.log('[BiliSorter] Folder index complete —', folders.length, 'folders sampled');

    } catch (error) {
      console.error('[BiliSorter] Folder index failed:', error);
      const errorMsg = error instanceof Error ? error.message : '未知错误';
      indexStatus = { inProgress: false, error: errorMsg };
      safePostMessage(port, { type: 'ERROR', error: errorMsg });
    }
  }

  // ─── Pool 2: Source Videos (one-shot, fast) ───

  async function handleFetchSource(folderId: number): Promise<{
    success: boolean;
    videos?: Video[];
    sourceMeta?: SourceMeta;
    error?: string;
  }> {
    try {
      const cookies = await extractCookies();
      if (!cookies) return { success: false, error: '未登录' };

      console.log('[BiliSorter] Fetching source videos from folder:', folderId);

      const result = await fetchVideos(
        folderId,
        cookies,
        undefined,
        1, // start from page 1
        SOURCE.PAGES_PER_LOAD // 3 pages = 60 videos
      );

      const sourceMeta: SourceMeta = {
        folderId,
        total: result.total,
        nextPage: result.nextPage,
        hasMore: result.hasMore,
        lastFetchTime: Date.now(),
      };

      await chrome.storage.local.set({
        [STORAGE_KEYS.SOURCE_VIDEOS]: result.videos,
        [STORAGE_KEYS.SOURCE_META]: sourceMeta,
      });

      console.log('[BiliSorter] Fetched', result.videos.length, 'source videos, total:', result.total);

      return { success: true, videos: result.videos, sourceMeta };
    } catch (error) {
      console.error('[BiliSorter] Fetch source failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '未知错误',
      };
    }
  }

  async function handleRefreshSource(folderId: number): Promise<{
    success: boolean;
    videos?: Video[];
    sourceMeta?: SourceMeta;
    error?: string;
  }> {
    // Clear existing source data and suggestions
    await chrome.storage.local.remove([
      STORAGE_KEYS.SOURCE_VIDEOS,
      STORAGE_KEYS.SOURCE_META,
      STORAGE_KEYS.SUGGESTIONS,
    ]);
    return handleFetchSource(folderId);
  }

  async function handleLoadMore(): Promise<{
    success: boolean;
    videos?: Video[];
    sourceMeta?: SourceMeta;
    error?: string;
  }> {
    try {
      const cookies = await extractCookies();
      if (!cookies) return { success: false, error: '未登录' };

      const stored = await chrome.storage.local.get([
        STORAGE_KEYS.SOURCE_META,
        STORAGE_KEYS.SOURCE_VIDEOS,
      ]);
      const meta: SourceMeta | undefined = stored[STORAGE_KEYS.SOURCE_META];
      const existingVideos: Video[] = stored[STORAGE_KEYS.SOURCE_VIDEOS] || [];

      if (!meta || !meta.hasMore) {
        return { success: false, error: '没有更多视频' };
      }

      console.log('[BiliSorter] Loading more from page', meta.nextPage);

      const result = await fetchVideos(
        meta.folderId,
        cookies,
        undefined,
        meta.nextPage,
        SOURCE.PAGES_PER_LOAD
      );

      const allVideos = [...existingVideos, ...result.videos];
      const updatedMeta: SourceMeta = {
        folderId: meta.folderId,
        total: result.total || meta.total,
        nextPage: result.nextPage,
        hasMore: result.hasMore,
        lastFetchTime: Date.now(),
      };

      await chrome.storage.local.set({
        [STORAGE_KEYS.SOURCE_VIDEOS]: allVideos,
        [STORAGE_KEYS.SOURCE_META]: updatedMeta,
      });

      console.log('[BiliSorter] Loaded', result.videos.length, 'more, total:', allVideos.length);

      return { success: true, videos: allVideos, sourceMeta: updatedMeta };
    } catch (error) {
      console.error('[BiliSorter] Load more failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '未知错误',
      };
    }
  }

  // ─── Force Reindex: Clear ALL pools ───

  async function handleForceReindex(): Promise<{ success: boolean }> {
    console.log('[BiliSorter] Force reindex — clearing all caches');
    await chrome.storage.local.remove([
      STORAGE_KEYS.FOLDERS,
      STORAGE_KEYS.FOLDER_SAMPLES,
      STORAGE_KEYS.FOLDER_INDEX_TIME,
      STORAGE_KEYS.FOLDER_CHECKPOINT,
      STORAGE_KEYS.SOURCE_VIDEOS,
      STORAGE_KEYS.SOURCE_META,
      STORAGE_KEYS.SUGGESTIONS,
    ]);
    return { success: true };
  }

  // ─── Pool 3: AI Suggestions ───

  async function handleGetSuggestions(port: chrome.runtime.Port): Promise<void> {
    console.log('[BiliSorter] Starting suggestion generation (Pool 3)');

    if (suggestStatus.inProgress) {
      safePostMessage(port, { type: 'ERROR', error: '建议生成已在进行中' });
      return;
    }

    suggestStatus = { inProgress: true, progress: '正在准备AI分析...' };

    try {
      // Read all data from storage (background reads directly, no data from popup)
      const stored = await chrome.storage.local.get([
        STORAGE_KEYS.SETTINGS,
        STORAGE_KEYS.SOURCE_VIDEOS,
        STORAGE_KEYS.SOURCE_META,
        STORAGE_KEYS.FOLDERS,
        STORAGE_KEYS.SUGGESTIONS,
      ]);

      const settings = stored[STORAGE_KEYS.SETTINGS];
      const provider = settings?.provider || 'gemini';
      const activeKey = provider === 'gemini' ? settings?.geminiApiKey : settings?.apiKey;
      if (!activeKey) {
        const providerName = provider === 'gemini' ? 'Gemini' : 'Claude';
        suggestStatus = { inProgress: false, error: `未配置 ${providerName} API Key` };
        safePostMessage(port, { type: 'ERROR', error: `请先在 ⚙️ 设置中配置 ${providerName} API Key` });
        return;
      }

      const sourceVideos: Video[] = stored[STORAGE_KEYS.SOURCE_VIDEOS] || [];
      const folders: Folder[] = stored[STORAGE_KEYS.FOLDERS] || [];
      const sourceMeta: SourceMeta | undefined = stored[STORAGE_KEYS.SOURCE_META];
      const existingSuggestions: Record<string, Suggestion[]> = stored[STORAGE_KEYS.SUGGESTIONS] || {};

      if (sourceVideos.length === 0) {
        suggestStatus = { inProgress: false, error: '没有源视频' };
        safePostMessage(port, { type: 'ERROR', error: '请先加载源视频' });
        return;
      }

      const sourceFolderId = sourceMeta?.folderId || settings.sourceFolderId || folders[0]?.id;

      // Generate suggestions (incremental: skip videos that already have suggestions)
      const suggestions = await generateSuggestions(
        sourceVideos,
        folders,
        sourceFolderId,
        settings,
        (completed, total) => {
          suggestStatus.progress = `正在分析视频... ${completed}/${total}`;
          safePostMessage(port, {
            type: 'SUGGESTION_PROGRESS',
            completed,
            total,
          });
        },
        existingSuggestions
      );

      // Save to storage
      await chrome.storage.local.set({
        [STORAGE_KEYS.SUGGESTIONS]: suggestions.results,
      });

      suggestStatus = { inProgress: false };
      safePostMessage(port, {
        type: 'SUGGESTIONS_COMPLETE',
        suggestions: suggestions.results,
        failedCount: suggestions.failedCount,
      });

      console.log('[BiliSorter] Suggestion generation complete, failed:', suggestions.failedCount);
    } catch (error) {
      console.error('[BiliSorter] Suggestion generation failed:', error);
      const errorMsg = error instanceof Error ? error.message : '未知错误';
      suggestStatus = { inProgress: false, error: errorMsg };
      safePostMessage(port, { type: 'ERROR', error: errorMsg });
    }
  }
});
