import { defineBackground } from 'wxt/sandbox';
import {
  extractCookies,
  checkAuth,
  fetchFolders,
  fetchFolderSample,
  fetchVideos,
} from '../lib/bilibiliApi';
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

  // Handle one-shot messages
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'CHECK_AUTH') {
      handleCheckAuth().then(sendResponse).catch((error) => {
        console.error('[BiliSorter] CHECK_AUTH error:', error);
        sendResponse({ loggedIn: false });
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

    try {
      // Extract cookies
      const cookies = await extractCookies();
      if (!cookies) {
        port.postMessage({ type: 'ERROR', error: '未登录' });
        return;
      }

      // Check auth to get UID
      const authResult = await checkAuth(cookies);
      if (!authResult.loggedIn || !authResult.uid) {
        port.postMessage({ type: 'ERROR', error: '登录已过期' });
        return;
      }

      const uid = authResult.uid;

      // Fetch folders
      console.log('[BiliSorter] Fetching folders for uid:', uid);
      const folders = await fetchFolders(uid, cookies);
      console.log('[BiliSorter] Fetched', folders.length, 'folders');

      // Sample titles from each folder
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

        // Send progress update
        port.postMessage({
          type: 'FOLDERS_READY',
          folders: folders.slice(0, i + 1),
        });

        // Small delay to prevent overwhelming the port
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      // Determine source folder
      const settings = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
      const sourceFolderId =
        settings[STORAGE_KEYS.SETTINGS]?.sourceFolderId || folders[0]?.id;

      if (!sourceFolderId) {
        port.postMessage({ type: 'ERROR', error: '没有找到收藏夹' });
        return;
      }

      // Fetch videos from source folder
      console.log('[BiliSorter] Fetching videos from folder:', sourceFolderId);
      let loaded = 0;
      const videos = await fetchVideos(sourceFolderId, cookies, (count, total) => {
        loaded = count;
        port.postMessage({
          type: 'FETCH_PROGRESS',
          loaded: count,
          total,
        });
      });

      console.log('[BiliSorter] Fetched', videos.length, 'videos');

      // Complete
      const timestamp = Date.now();
      port.postMessage({
        type: 'INDEX_COMPLETE',
        videos,
        sourceFolderId,
        timestamp,
      });

      // Save to storage
      await chrome.storage.local.set({
        [STORAGE_KEYS.FOLDERS]: folders,
        [STORAGE_KEYS.VIDEOS]: videos,
        bilisorter_lastIndexed: timestamp,
      });

      console.log('[BiliSorter] Index operation complete');
    } catch (error) {
      console.error('[BiliSorter] Index operation failed:', error);
      port.postMessage({
        type: 'ERROR',
        error: error instanceof Error ? error.message : '未知错误',
      });
    }
  }
});
