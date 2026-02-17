// BiliSorter - Bilibili API Functions

import {
  BiliNavResponse,
  BiliFolderListResponse,
  BiliVideoListResponse,
  BiliMoveResponse,
  BiliFolderSortResponse,
  BiliFolderEditResponse,
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
 * Custom error for 412 rate limiting.
 * Distinguished from other errors so callers can save checkpoint and pause.
 */
export class RateLimitError extends Error {
  constructor(url: string) {
    super(`Rate limited (HTTP 412) — ${url}`);
    this.name = 'RateLimitError';
  }
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
 * Build common fetch headers for Bilibili API requests.
 * Includes Cookie, Referer, and User-Agent to avoid anti-hotlinking HTML responses.
 */
export function buildFetchHeaders(cookies: BiliCookies): Record<string, string> {
  return {
    Cookie: buildCookieHeader(cookies),
    Referer: 'https://www.bilibili.com',
    Origin: 'https://www.bilibili.com',
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  };
}

/**
 * Safely parse a Bilibili API JSON response.
 * Throws a descriptive error if the response is not valid JSON (e.g. HTML anti-crawler page).
 */
async function safeParseBiliJson<T>(response: Response, context: string): Promise<T> {
  const contentType = response.headers.get('content-type') || '';

  // Detect 412 rate limiting specifically
  if (response.status === 412) {
    throw new RateLimitError(response.url);
  }

  if (!response.ok) {
    const bodyPreview = await response.text().catch(() => '(unreadable)');
    throw new Error(
      `[${context}] HTTP ${response.status} from ${response.url} — ${bodyPreview.slice(0, 200)}`
    );
  }

  if (!contentType.includes('json')) {
    const bodyPreview = await response.text().catch(() => '(unreadable)');
    throw new Error(
      `[${context}] Expected JSON but got ${contentType} from ${response.url} — ${bodyPreview.slice(0, 200)}`
    );
  }

  return response.json() as Promise<T>;
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
    const headers = buildFetchHeaders(cookies);
    const response = await fetch(`${BILIBILI_API_BASE}${BILI_API.NAV}`, { headers });

    const data = await safeParseBiliJson<BiliNavResponse>(response, 'checkAuth');

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
    const headers = buildFetchHeaders(cookies);
    const response = await fetch(
      `${BILIBILI_API_BASE}${BILI_API.FOLDER_LIST}?up_mid=${uid}`,
      { headers }
    );

    const data = await safeParseBiliJson<BiliFolderListResponse>(response, 'fetchFolders');

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
    const headers = buildFetchHeaders(cookies);

    // Calculate random page
    const totalPages = Math.ceil(mediaCount / 20);
    const randomPage = Math.max(1, Math.ceil(Math.random() * totalPages));

    const response = await fetch(
      `${BILIBILI_API_BASE}${BILI_API.VIDEO_LIST}?media_id=${folderId}&pn=${randomPage}&ps=20`,
      { headers }
    );

    const data = await safeParseBiliJson<BiliVideoListResponse>(response, 'fetchFolderSample');

    if (data.code !== 0 || !data.data || !data.data.medias) {
      return [];
    }

    // Extract up to 10 titles
    return data.data.medias.slice(0, 10).map((m) => m.title);
  } catch (error) {
    // Re-throw RateLimitError so callers can save checkpoint and pause
    if (error instanceof RateLimitError) {
      throw error;
    }
    console.error('[BiliAPI] Error fetching folder sample:', error);
    return [];
  }
}

/**
 * Result of a paginated video fetch
 */
export interface FetchVideosResult {
  videos: Video[];
  total: number;
  hasMore: boolean;
  nextPage: number;
}

/**
 * Fetch videos from a folder with pagination limit and rate limiting.
 * Fetches up to `maxPages` pages (default 3 = ~60 videos).
 * Returns partial results + pagination info for "load more".
 */
export async function fetchVideos(
  folderId: number,
  cookies: BiliCookies,
  onProgress?: (loaded: number, total: number) => void,
  startPage: number = 1,
  maxPages: number = 3
): Promise<FetchVideosResult> {
  const videos: Video[] = [];
  let page = startPage;
  let hasMore = true;
  let total = 0;
  let pagesFetched = 0;

  const headers = buildFetchHeaders(cookies);
  const PAGE_DELAY = 500; // 500ms between page fetches
  const RETRY_DELAY = 3000; // 3s retry on 412

  while (hasMore && pagesFetched < maxPages) {
    let data: BiliVideoListResponse | null = null;

    // Try fetching with one retry on failure (412)
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(
          `${BILIBILI_API_BASE}${BILI_API.VIDEO_LIST}?media_id=${folderId}&pn=${page}&ps=20`,
          { headers }
        );

        data = await safeParseBiliJson<BiliVideoListResponse>(response, 'fetchVideos');
        break; // success
      } catch (error) {
        // On RateLimitError: retry once, then re-throw so caller can save checkpoint
        if (error instanceof RateLimitError) {
          if (attempt === 0) {
            console.warn('[BiliAPI] fetchVideos page', page, 'rate limited, retrying in', RETRY_DELAY, 'ms');
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
          } else {
            // Re-throw so caller can save checkpoint with partial results
            console.error('[BiliAPI] fetchVideos page', page, 'rate limited after retry');
            throw error;
          }
        } else {
          // Non-rate-limit error — return what we have
          console.error('[BiliAPI] fetchVideos page', page, 'error:', error);
          return { videos, total, hasMore: true, nextPage: page };
        }
      }
    }

    if (!data || data.code !== 0 || !data.data) {
      // API returned an error code — stop and return partial
      console.error('[BiliAPI] fetchVideos bad response code:', data?.code);
      return { videos, total, hasMore: true, nextPage: page };
    }

    const { medias, has_more, total: responseTotal } = data.data;

    if (responseTotal !== undefined && responseTotal > 0) {
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
        tags: [],
        attr: media.attr,
      });
    }

    // Report progress
    onProgress?.(videos.length, total);

    hasMore = has_more;
    page++;
    pagesFetched++;

    // Rate limiting between pages
    if (hasMore && pagesFetched < maxPages) {
      await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY));
    }
  }

  return { videos, total, hasMore, nextPage: page };
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
    const headers = buildFetchHeaders(cookies);

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
          ...headers,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
      }
    );

    const data = await safeParseBiliJson<BiliMoveResponse>(response, 'moveVideo');

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

/**
 * Sort (reorder) all user folders.
 * The sort param is a comma-separated list of ALL folder IDs in desired order.
 * Matches B站's POST /x/v3/fav/folder/sort?sort=id1,id2,...&csrf=xxx
 */
export async function sortFolders(
  folderIds: number[],
  cookies: BiliCookies
): Promise<{ success: boolean; error?: string }> {
  try {
    const headers = buildFetchHeaders(cookies);

    const params = new URLSearchParams();
    params.append('sort', folderIds.join(','));
    params.append('csrf', cookies.bili_jct);

    const response = await fetch(
      `${BILIBILI_API_BASE}${BILI_API.FOLDER_SORT}?${params.toString()}`,
      {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Length': '0',
          Referer: 'https://space.bilibili.com',
          Origin: 'https://space.bilibili.com',
        },
      }
    );

    const data = await safeParseBiliJson<BiliFolderSortResponse>(response, 'sortFolders');

    if (data.code !== 0) {
      return {
        success: false,
        error: data.message || `Error code: ${data.code}`,
      };
    }

    return { success: true };
  } catch (error) {
    console.error('[BiliAPI] Error sorting folders:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Rename a folder.
 * POST /x/v3/fav/folder/edit with form-encoded media_id, title, csrf.
 */
export async function renameFolder(
  folderId: number,
  title: string,
  cookies: BiliCookies
): Promise<{ success: boolean; error?: string }> {
  try {
    const headers = buildFetchHeaders(cookies);

    const formData = new URLSearchParams();
    formData.append('media_id', folderId.toString());
    formData.append('title', title);
    formData.append('csrf', cookies.bili_jct);

    const response = await fetch(
      `${BILIBILI_API_BASE}${BILI_API.FOLDER_EDIT}`,
      {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/x-www-form-urlencoded',
          Referer: 'https://space.bilibili.com',
          Origin: 'https://space.bilibili.com',
        },
        body: formData.toString(),
      }
    );

    const data = await safeParseBiliJson<BiliFolderEditResponse>(response, 'renameFolder');

    if (data.code !== 0) {
      return {
        success: false,
        error: data.message || `Error code: ${data.code}`,
      };
    }

    return { success: true };
  } catch (error) {
    console.error('[BiliAPI] Error renaming folder:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
