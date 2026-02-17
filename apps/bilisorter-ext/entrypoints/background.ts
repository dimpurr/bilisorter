import { defineBackground } from 'wxt/sandbox';
import {
  extractCookies,
  checkAuth,
  fetchFolders,
  fetchFolderSample,
  fetchVideos,
  moveVideo,
} from '../lib/bilibiliApi';
import { generateSuggestions } from '../lib/claudeApi';
import type {
  AuthResponse,
  Folder,
  Video,
  VideoMeta,
  BiliCookies,
  PortMessage,
} from '../lib/types';
import { STORAGE_KEYS } from '../lib/constants';

export default defineBackground(() => {
  console.log('[BiliSorter] Background service worker started');

  // Track active ports for cleanup
  const activePorts = new Map<string, chrome.runtime.Port>();

  // Track in-progress operations so popup can recover state on reopen
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
   * Returns false if the port is disconnected.
   */
  function safePostMessage(port: chrome.runtime.Port, message: PortMessage): boolean {
    try {
      port.postMessage(message);
      return true;
    } catch (e) {
      // Port disconnected — popup was closed. Continue operation silently.
      console.log('[BiliSorter] Port disconnected, continuing operation in background');
      return false;
    }
  }

  // Handle one-shot messages
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
      const { srcFolderId, dstFolderId, resourceId, resourceType } = message;
      extractCookies()
        .then((cookies) => {
          if (!cookies) throw new Error('未登录');
          return moveVideo(srcFolderId, dstFolderId, resourceId, cookies);
        })
        .then(sendResponse)
        .catch((error) => sendResponse({ success: false, error: error.message }));
      return true;
    }

    if (message.type === 'LOAD_MORE_VIDEOS') {
      handleLoadMore().then(sendResponse).catch((error) => {
        console.error('[BiliSorter] LOAD_MORE_VIDEOS error:', error);
        sendResponse({ success: false, error: error.message });
      });
      return true;
    }

    return false;
  });

  // Handle port connections for long-running operations
  chrome.runtime.onConnect.addListener((port) => {
    console.log('[BiliSorter] Port connected:', port.name);
    activePorts.set(port.name, port);

    port.onMessage.addListener((message: PortMessage) => {
      if (message.type === 'INDEX') {
        handleIndex(port);
      } else if (message.type === 'GET_SUGGESTIONS') {
        handleGetSuggestions(port, message.videos, message.folders);
      }
    });

    port.onDisconnect.addListener(() => {
      console.log('[BiliSorter] Port disconnected:', port.name);
      activePorts.delete(port.name);
    });
  });

  async function handleCheckAuth(): Promise<AuthResponse> {
    const cookies = await extractCookies();

    if (!cookies) {
      console.log('[BiliSorter] No valid cookies found');
      return { loggedIn: false };
    }

    const authResult = await checkAuth(cookies);
    console.log('[BiliSorter] Auth check result:', authResult);
    return authResult;
  }

  async function handleIndex(port: chrome.runtime.Port): Promise<void> {
    console.log('[BiliSorter] Starting index operation');

    // Prevent duplicate index operations
    if (indexStatus.inProgress) {
      safePostMessage(port, { type: 'ERROR', error: '索引操作已在进行中' });
      return;
    }

    indexStatus = { inProgress: true, progress: '正在连接...' };

    try {
      // Extract cookies
      const cookies = await extractCookies();
      if (!cookies) {
        indexStatus = { inProgress: false, error: '未登录' };
        safePostMessage(port, { type: 'ERROR', error: '未登录' });
        return;
      }

      // Check auth to get UID
      const authResult = await checkAuth(cookies);
      if (!authResult.loggedIn || !authResult.uid) {
        indexStatus = { inProgress: false, error: '登录已过期' };
        safePostMessage(port, { type: 'ERROR', error: '登录已过期' });
        return;
      }

      const uid = authResult.uid;

      // Fetch folders
      console.log('[BiliSorter] Fetching folders for uid:', uid);
      const folders = await fetchFolders(uid, cookies);
      console.log('[BiliSorter] Fetched', folders.length, 'folders');

      // Sample titles from each folder with adaptive rate limiting
      const SAMPLE_BASE_DELAY = 500;       // 500ms between requests
      const SAMPLE_BATCH_SIZE = 15;        // pause every 15 folders
      const SAMPLE_BATCH_COOLDOWN = 2000;  // 2s cooldown between batches
      const SAMPLE_RETRY_DELAY = 3000;     // 3s wait before retry on 412

      for (let i = 0; i < folders.length; i++) {
        const folder = folders[i];
        if (folder.media_count > 0) {
          let sampled = false;

          // First attempt
          try {
            const sampleTitles = await fetchFolderSample(
              folder.id,
              folder.media_count,
              cookies
            );
            folder.sampleTitles = sampleTitles;
            sampled = true;
          } catch (error) {
            console.warn('[BiliSorter] Sample attempt 1 failed for folder', folder.id, error);
          }

          // Retry once after 3s if first attempt failed (likely 412)
          if (!sampled) {
            console.log('[BiliSorter] Retrying folder', folder.id, 'after', SAMPLE_RETRY_DELAY, 'ms');
            await new Promise((resolve) => setTimeout(resolve, SAMPLE_RETRY_DELAY));
            try {
              const sampleTitles = await fetchFolderSample(
                folder.id,
                folder.media_count,
                cookies
              );
              folder.sampleTitles = sampleTitles;
            } catch (error) {
              console.warn('[BiliSorter] Sample attempt 2 failed for folder', folder.id, '— skipping');
              folder.sampleTitles = [];
            }
          }
        }

        // Send progress update (safe — won't crash if popup closed)
        indexStatus.progress = `采样收藏夹 ${i + 1}/${folders.length}...`;
        safePostMessage(port, {
          type: 'FOLDERS_READY',
          folders: folders.slice(0, i + 1),
        });

        // Rate limiting: 500ms base delay + 2s cooldown every 15 folders
        if (i < folders.length - 1) {
          const isBatchBoundary = (i + 1) % SAMPLE_BATCH_SIZE === 0;
          const delay = isBatchBoundary
            ? SAMPLE_BASE_DELAY + SAMPLE_BATCH_COOLDOWN
            : SAMPLE_BASE_DELAY;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      // Save folders to storage immediately (in case popup is closed)
      await chrome.storage.local.set({
        [STORAGE_KEYS.FOLDERS]: folders,
      });

      // Determine source folder
      const settings = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
      const sourceFolderId =
        settings[STORAGE_KEYS.SETTINGS]?.sourceFolderId || folders[0]?.id;

      if (!sourceFolderId) {
        indexStatus = { inProgress: false, error: '没有找到收藏夹' };
        safePostMessage(port, { type: 'ERROR', error: '没有找到收藏夹' });
        return;
      }

      // Fetch first batch of videos from source folder (max 3 pages = ~60 videos)
      console.log('[BiliSorter] Fetching videos from folder:', sourceFolderId);
      indexStatus.progress = '正在获取视频...';
      const result = await fetchVideos(sourceFolderId, cookies, (count, total) => {
        indexStatus.progress = `正在获取视频... ${count}/${total}`;
        safePostMessage(port, {
          type: 'FETCH_PROGRESS',
          loaded: count,
          total,
        });
      });

      const { videos, total: totalVideoCount, hasMore, nextPage } = result;
      console.log('[BiliSorter] Fetched', videos.length, 'of', totalVideoCount, 'videos, hasMore:', hasMore);

      // Save video pagination metadata
      const videoMeta: VideoMeta = {
        sourceFolderId,
        nextPage,
        hasMore,
        total: totalVideoCount,
      };

      // Complete — save results to storage regardless of port status
      const timestamp = Date.now();
      await chrome.storage.local.set({
        [STORAGE_KEYS.FOLDERS]: folders,
        [STORAGE_KEYS.VIDEOS]: videos,
        [STORAGE_KEYS.VIDEO_META]: videoMeta,
        bilisorter_lastIndexed: timestamp,
      });

      indexStatus = { inProgress: false };
      safePostMessage(port, {
        type: 'INDEX_COMPLETE',
        videos,
        sourceFolderId,
        timestamp,
        hasMore,
        totalVideoCount,
      });

      console.log('[BiliSorter] Index operation complete');
    } catch (error) {
      console.error('[BiliSorter] Index operation failed:', error);
      const errorMsg = error instanceof Error ? error.message : '未知错误';
      indexStatus = { inProgress: false, error: errorMsg };
      safePostMessage(port, {
        type: 'ERROR',
        error: errorMsg,
      });
    }
  }

  /**
   * Load more videos from the source folder (next 3 pages).
   * Appends to existing cached videos.
   */
  async function handleLoadMore(): Promise<{
    success: boolean;
    videos?: Video[];
    hasMore?: boolean;
    totalVideoCount?: number;
    error?: string;
  }> {
    try {
      const cookies = await extractCookies();
      if (!cookies) return { success: false, error: '未登录' };

      // Read current video meta
      const stored = await chrome.storage.local.get([
        STORAGE_KEYS.VIDEO_META,
        STORAGE_KEYS.VIDEOS,
      ]);
      const meta: VideoMeta | undefined = stored[STORAGE_KEYS.VIDEO_META];
      const existingVideos: Video[] = stored[STORAGE_KEYS.VIDEOS] || [];

      if (!meta || !meta.hasMore) {
        return { success: false, error: '没有更多视频' };
      }

      console.log('[BiliSorter] Loading more videos from page', meta.nextPage);

      const result = await fetchVideos(
        meta.sourceFolderId,
        cookies,
        undefined, // no progress callback for load more
        meta.nextPage,
        3 // 3 more pages
      );

      const allVideos = [...existingVideos, ...result.videos];
      const updatedMeta: VideoMeta = {
        sourceFolderId: meta.sourceFolderId,
        nextPage: result.nextPage,
        hasMore: result.hasMore,
        total: result.total || meta.total,
      };

      // Save to storage
      await chrome.storage.local.set({
        [STORAGE_KEYS.VIDEOS]: allVideos,
        [STORAGE_KEYS.VIDEO_META]: updatedMeta,
      });

      console.log('[BiliSorter] Loaded', result.videos.length, 'more videos, total:', allVideos.length);

      return {
        success: true,
        videos: allVideos,
        hasMore: result.hasMore,
        totalVideoCount: updatedMeta.total,
      };
    } catch (error) {
      console.error('[BiliSorter] Load more failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '未知错误',
      };
    }
  }

  async function handleGetSuggestions(
    port: chrome.runtime.Port,
    videos: Video[],
    folders: Folder[]
  ): Promise<void> {
    console.log('[BiliSorter] Starting suggestion generation');

    if (suggestStatus.inProgress) {
      safePostMessage(port, { type: 'ERROR', error: '建议生成已在进行中' });
      return;
    }

    suggestStatus = { inProgress: true, progress: '正在准备AI分析...' };

    try {
      // Get settings
      const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
      const settings = result[STORAGE_KEYS.SETTINGS];

      if (!settings?.apiKey) {
        suggestStatus = { inProgress: false, error: '未配置 API Key' };
        safePostMessage(port, { type: 'ERROR', error: '未配置 API Key' });
        return;
      }

      // Find source folder from videos
      const sourceFolderId = folders[0]?.id;

      // Generate suggestions
      const suggestions = await generateSuggestions(
        videos,
        folders,
        sourceFolderId,
        settings.apiKey,
        settings.model || 'claude-3-5-haiku-latest',
        (completed, total) => {
          suggestStatus.progress = `正在分析视频... ${completed}/${total}`;
          safePostMessage(port, {
            type: 'SUGGESTION_PROGRESS',
            completed,
            total,
          });
        }
      );

      // Save to storage regardless of port status
      await chrome.storage.local.set({
        [STORAGE_KEYS.SUGGESTIONS]: suggestions,
      });

      suggestStatus = { inProgress: false };

      // Complete
      safePostMessage(port, {
        type: 'SUGGESTIONS_COMPLETE',
        suggestions,
      });

      console.log('[BiliSorter] Suggestion generation complete');
    } catch (error) {
      console.error('[BiliSorter] Suggestion generation failed:', error);
      const errorMsg = error instanceof Error ? error.message : '未知错误';
      suggestStatus = { inProgress: false, error: errorMsg };
      safePostMessage(port, {
        type: 'ERROR',
        error: errorMsg,
      });
    }
  }
});
