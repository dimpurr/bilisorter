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

      // Sample titles from each folder (with 300ms delay to avoid rate limiting)
      for (let i = 0; i < folders.length; i++) {
        const folder = folders[i];
        if (folder.media_count > 0) {
          try {
            const sampleTitles = await fetchFolderSample(
              folder.id,
              folder.media_count,
              cookies
            );
            folder.sampleTitles = sampleTitles;
          } catch (error) {
            console.warn('[BiliSorter] Failed to sample folder', folder.id, error);
            folder.sampleTitles = [];
          }
        }

        // Send progress update (safe — won't crash if popup closed)
        indexStatus.progress = `已获取 ${i + 1}/${folders.length} 个收藏夹`;
        safePostMessage(port, {
          type: 'FOLDERS_READY',
          folders: folders.slice(0, i + 1),
        });

        // 300ms delay between folder samples to avoid rate limiting
        if (i < folders.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 300));
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

      // Fetch videos from source folder
      console.log('[BiliSorter] Fetching videos from folder:', sourceFolderId);
      indexStatus.progress = '正在获取视频...';
      const videos = await fetchVideos(sourceFolderId, cookies, (count, total) => {
        indexStatus.progress = `正在获取视频... ${count}/${total}`;
        safePostMessage(port, {
          type: 'FETCH_PROGRESS',
          loaded: count,
          total,
        });
      });

      console.log('[BiliSorter] Fetched', videos.length, 'videos');

      // Complete — save results to storage regardless of port status
      const timestamp = Date.now();
      await chrome.storage.local.set({
        [STORAGE_KEYS.FOLDERS]: folders,
        [STORAGE_KEYS.VIDEOS]: videos,
        bilisorter_lastIndexed: timestamp,
      });

      indexStatus = { inProgress: false };
      safePostMessage(port, {
        type: 'INDEX_COMPLETE',
        videos,
        sourceFolderId,
        timestamp,
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
