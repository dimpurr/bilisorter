// BiliSorter - TypeScript Type Definitions (v0.2 Three-Pool Architecture)

// ─── Storage Keys ───

export const STORAGE_KEYS = {
  SETTINGS: 'bilisorter_settings',
  // Pool 1: Folder Index
  FOLDERS: 'bilisorter_folders',
  FOLDER_SAMPLES: 'bilisorter_folderSamples',
  FOLDER_INDEX_TIME: 'bilisorter_folderIndexTime',
  FOLDER_CHECKPOINT: 'bilisorter_folderCheckpoint',
  // Pool 2: Source Videos
  SOURCE_VIDEOS: 'bilisorter_source_videos',
  SOURCE_META: 'bilisorter_source_meta',
  // Pool 3: AI Suggestions
  SUGGESTIONS: 'bilisorter_suggestions',
  // Global
  OPERATION_LOG: 'bilisorter_operation_log',
} as const;

// ─── Core Data Types ───

export interface Folder {
  id: number;
  name: string;
  media_count: number;
  attr: number; // 0 = normal, non-0 = default (pinned)
  sampleTitles: string[];
}

export interface Video {
  bvid: string;
  title: string;
  cover: string;
  upper: {
    name: string;
  };
  cnt_info: {
    play: number;
  };
  fav_time: string;
  intro: string;
  tags: string[];
  attr: number; // 0 = valid, non-0 = invalid
}

export interface Suggestion {
  folderId: number;
  folderName: string;
  confidence: number; // 0.0 - 1.0
}

export interface LogEntry {
  timestamp: string;
  videoTitle: string;
  bvid: string;
  fromFolderName: string;
  toFolderName: string;
}

export interface Settings {
  // AI Provider
  provider: 'gemini' | 'claude';
  // Gemini
  geminiApiKey: string;
  geminiModel: string;
  // Claude
  apiKey: string;
  model: 'claude-3-5-haiku-latest' | 'claude-sonnet-4-latest';
  // Source
  sourceFolderId: number | null;
}

// ─── Pool 2: Source Meta ───

export interface SourceMeta {
  folderId: number;
  total: number;
  nextPage: number;
  hasMore: boolean;
  lastFetchTime: number;
}

// ─── Pool 1: Folder Index Checkpoint ───

export interface FolderIndexCheckpoint {
  uid: string;
  foldersSampled: number[]; // IDs of folders already sampled
  totalFolders: number;
  timestamp: number;
}

// ─── Message Types ───

// One-shot messages via sendMessage
export type OneShotMessage =
  | { type: 'CHECK_AUTH' }
  | { type: 'GET_INDEX_STATUS' }
  | { type: 'GET_SUGGEST_STATUS' }
  | { type: 'GET_COOKIES' }
  | { type: 'FETCH_SOURCE'; folderId: number }
  | { type: 'REFRESH_SOURCE'; folderId: number }
  | { type: 'LOAD_MORE' }
  | { type: 'FORCE_REINDEX' }
  | { type: 'MOVE_VIDEO'; srcFolderId: number; dstFolderId: number; resourceId: string; resourceType: number }
  | { type: 'SORT_FOLDERS'; folderIds: number[] }
  | { type: 'RENAME_FOLDER'; folderId: number; title: string }
  | { type: 'FETCH_FOLDERS_FRESH' };

// Operation status response (for GET_INDEX_STATUS / GET_SUGGEST_STATUS)
export interface OperationStatus {
  inProgress: boolean;
  progress?: string;
  error?: string;
}

// Port-based messages for long-running operations
export type PortMessage =
  // Folder indexing (Port: INDEX_FOLDERS)
  | { type: 'INDEX_FOLDERS' }
  | { type: 'FOLDERS_READY'; folders: Folder[] }
  | { type: 'SAMPLING_PROGRESS'; sampled: number; total: number; currentFolder: string }
  | { type: 'INDEX_FOLDERS_COMPLETE'; folders: Folder[]; timestamp: number }
  | { type: 'INDEX_FOLDERS_PAUSED'; reason: string; sampled: number; totalFolders: number }
  // AI suggestions (Port: GET_SUGGESTIONS)
  | { type: 'GET_SUGGESTIONS' }
  | { type: 'SUGGESTION_PROGRESS'; completed: number; total: number }
  | { type: 'SUGGESTIONS_COMPLETE'; suggestions: Record<string, Suggestion[]>; failedCount: number }
  // Shared
  | { type: 'ERROR'; error: string };

// ─── Auth Response ───

export interface AuthResponse {
  loggedIn: boolean;
  uid?: string;
  username?: string;
}

// ─── Bilibili API Response Types ───

export interface BiliNavResponse {
  code: number;
  data?: {
    isLogin: boolean;
    mid: number;
    uname: string;
  };
}

export interface BiliFolderListResponse {
  code: number;
  data?: {
    list: Array<{
      id: number;
      title: string;
      media_count: number;
      attr: number;
    }>;
  };
}

export interface BiliVideoListResponse {
  code: number;
  data?: {
    medias: Array<{
      id: number;
      bvid: string;
      title: string;
      cover: string;
      upper: {
        name: string;
      };
      cnt_info: {
        play: number;
      };
      fav_time: number;
      intro: string;
      attr: number;
    }>;
    has_more: boolean;
    total: number;
  };
}

export interface BiliMoveResponse {
  code: number;
  message: string;
}

export interface BiliFolderSortResponse {
  code: number;
  message: string;
}

export interface BiliFolderEditResponse {
  code: number;
  message: string;
}
