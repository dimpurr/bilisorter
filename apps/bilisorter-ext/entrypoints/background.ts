import { defineBackground } from 'wxt/sandbox';
import { extractCookies, checkAuth } from '../lib/bilibiliApi';
import type { AuthResponse } from '../lib/types';

export default defineBackground(() => {
  console.log('[BiliSorter] Background service worker started');

  // Handle one-shot messages
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'CHECK_AUTH') {
      handleCheckAuth().then(sendResponse).catch((error) => {
        console.error('[BiliSorter] CHECK_AUTH error:', error);
        sendResponse({ loggedIn: false });
      });
      return true; // Keep message channel open for async
    }

    // Unknown message type
    return false;
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
});
