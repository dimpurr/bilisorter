// BiliSorter - Bilibili API Functions

import {
  BiliNavResponse,
  BiliFolderListResponse,
  BiliVideoListResponse,
  BiliMoveResponse,
  Folder,
  Video,
} from './types';
import { BILIBILI_API_BASE, BILI_API } from './constants';

// Cookie Types
interface BiliCookies {
  SESSDATA: string;
  bili_jct: string;
  DedeUserID: string;
}

/**
 * Extract required cookies from bilibili.com
 */
export async function extractCookies(): Promise<BiliCookies | null> {
  try {
    const [sessdata, biliJct, dedeUserID] = await Promise.all([
      chrome.cookies.get({ url: 'https://www.bilibili.com', name: 'SESSDATA' }),
      chrome.cookies.get({ url: 'https://www.bilibili.com', name: 'bili_jct' }),
      chrome.cookies.get({ url: 'https://www.bilibili.com', name: 'DedeUserID' }),
    ]);

    if (!sessdata?.value) {
      console.log('[BiliAPI] SESSDATA not found, user not logged in');
      return null;
    }

    return {
      SESSDATA: sessdata.value,
      bili_jct: biliJct?.value || '',
      DedeUserID: dedeUserID?.value || '',
    };
  } catch (error) {
    console.error('[BiliAPI] Error extracting cookies:', error);
    return null;
  }
}

/**
 * Build Cookie header string from cookies
 */
export function buildCookieHeader(cookies: BiliCookies): string {
  const parts = [`SESSDATA=${cookies.SESSDATA}`];
  if (cookies.bili_jct) {
    parts.push(`bili_jct=${cookies.bili_jct}`);
  }
  if (cookies.DedeUserID) {
    parts.push(`DedeUserID=${cookies.DedeUserID}`);
  }
  return parts.join('; ');
}

/**
 * Check authentication status
 */
export async function checkAuth(cookies: BiliCookies): Promise<{
  loggedIn: boolean;
  uid?: string;
  username?: string;
}> {
  try {
    const cookieHeader = buildCookieHeader(cookies);
    const response = await fetch(`${BILIBILI_API_BASE}${BILI_API.NAV}`, {
      headers: {
        Cookie: cookieHeader,
      },
    });

    const data: BiliNavResponse = await response.json();

    if (data.code !== 0 || !data.data) {
      console.log('[BiliAPI] Nav API error:', data);
      return { loggedIn: false };
    }

    // Use mid from response if DedeUserID cookie is missing
    const uid = cookies.DedeUserID || String(data.data.mid);

    return {
      loggedIn: data.data.isLogin,
      uid,
      username: data.data.uname,
    };
  } catch (error) {
    console.error('[BiliAPI] Error checking auth:', error);
    return { loggedIn: false };
  }
}

/**
 * Fetch all folders for a user
 */
export async function fetchFolders(
  uid: string,
  cookies: BiliCookies
): Promise<Folder[]> {
  try {
    const cookieHeader = buildCookieHeader(cookies);
    const response = await fetch(
      `${BILIBILI_API_BASE}${BILI_API.FOLDER_LIST}?up_mid=${uid}`,
      {
        headers: {
          Cookie: cookieHeader,
        },
      }
    );

    const data: BiliFolderListResponse = await response.json();

    if (data.code !== 0 || !data.data) {
      throw new Error(`Failed to fetch folders: ${data.code}`);
    }

    return data.data.list.map((folder) => ({
      id: folder.id,
      name: folder.title,
      media_count: folder.media_count,
      sampleTitles: [],
    }));
  } catch (error) {
    console.error('[BiliAPI] Error fetching folders:', error);
    throw error;
  }
}

/**
 * Fetch a random sample of video titles from a folder
 */
export async function fetchFolderSample(
  folderId: number,
  mediaCount: number,
  cookies: BiliCookies
): Promise<string[]> {
  // Skip if folder is empty
  if (mediaCount === 0) {
    return [];
  }

  try {
    const cookieHeader = buildCookieHeader(cookies);

    // Calculate random page
    const totalPages = Math.ceil(mediaCount / 20);
    const randomPage = Math.max(1, Math.ceil(Math.random() * totalPages));

    const response = await fetch(
      `${BILIBILI_API_BASE}${BILI_API.VIDEO_LIST}?media_id=${folderId}&pn=${randomPage}&ps=20`,
      {
        headers: {
          Cookie: cookieHeader,
        },
      }
    );

    const data: BiliVideoListResponse = await response.json();

    if (data.code !== 0 || !data.data || !data.data.medias) {
      return [];
    }

    // Extract up to 10 titles
    return data.data.medias.slice(0, 10).map((m) => m.title);
  } catch (error) {
    console.error('[BiliAPI] Error fetching folder sample:', error);
    return [];
  }
}

/**
 * Fetch all videos from a folder with progress callback
 */
export async function fetchVideos(
  folderId: number,
  cookies: BiliCookies,
  onProgress?: (loaded: number, total: number) => void
): Promise<Video[]> {
  const videos: Video[] = [];
  let page = 1;
  let hasMore = true;
  let total = 0;

  const cookieHeader = buildCookieHeader(cookies);

  while (hasMore) {
    try {
      const response = await fetch(
        `${BILIBILI_API_BASE}${BILI_API.VIDEO_LIST}?media_id=${folderId}&pn=${page}&ps=20`,
        {
          headers: {
            Cookie: cookieHeader,
          },
        }
      );

      const data: BiliVideoListResponse = await response.json();

      if (data.code !== 0 || !data.data) {
        throw new Error(`Failed to fetch videos: ${data.code}`);
      }

      const { medias, has_more, total: responseTotal } = data.data;

      if (responseTotal !== undefined) {
        total = responseTotal;
      }

      // Transform and add videos
      for (const media of medias || []) {
        videos.push({
          bvid: media.bvid,
          title: media.title,
          cover: media.cover,
          upper: media.upper,
          cnt_info: media.cnt_info,
          fav_time: new Date(media.fav_time * 1000).toISOString(),
          intro: media.intro,
          tags: [], // Tags require additional API call
          attr: media.attr,
        });
      }

      // Report progress
      onProgress?.(videos.length, total);

      hasMore = has_more;
      page++;
    } catch (error) {
      console.error('[BiliAPI] Error fetching videos:', error);
      throw error;
    }
  }

  return videos;
}

/**
 * Move a video from one folder to another
 */
export async function moveVideo(
  srcFolderId: number,
  dstFolderId: number,
  resourceId: string,
  cookies: BiliCookies
): Promise<{ success: boolean; error?: string; code?: number }> {
  try {
    const cookieHeader = buildCookieHeader(cookies);

    const formData = new URLSearchParams();
    formData.append('media_id', srcFolderId.toString());
    formData.append('target_media_id', dstFolderId.toString());
    formData.append('resources', `${resourceId}:2`); // 2 = video type
    formData.append('csrf', cookies.bili_jct);

    const response = await fetch(
      `${BILIBILI_API_BASE}${BILI_API.MOVE}`,
      {
        method: 'POST',
        headers: {
          Cookie: cookieHeader,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
      }
    );

    const data: BiliMoveResponse = await response.json();

    // Handle specific error codes
    if (data.code === 72010002) {
      // Already in target - treat as success
      return { success: true };
    }

    if (data.code !== 0) {
      return {
        success: false,
        error: data.message || `Error code: ${data.code}`,
        code: data.code,
      };
    }

    return { success: true };
  } catch (error) {
    console.error('[BiliAPI] Error moving video:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
