// BiliSorter - TypeScript Type Definitions

// Storage Keys
export const STORAGE_KEYS = {
  SETTINGS: 'bilisorter_settings',
  FOLDERS: 'bilisorter_folders',
  VIDEOS: 'bilisorter_videos',
  SUGGESTIONS: 'bilisorter_suggestions',
  OPERATION_LOG: 'bilisorter_operation_log',
} as const;

// Core Data Types

export interface Folder {
  id: number;
  name: string;
  media_count: number;
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
  apiKey: string;
  model: 'claude-3-5-haiku-latest' | 'claude-sonnet-4-latest';
  sourceFolderId: number | null;
}

// Message Types for Communication

// One-shot messages via sendMessage
export type OneShotMessage =
  | { type: 'CHECK_AUTH' }
  | { type: 'GET_INDEX_STATUS' }
  | { type: 'GET_SUGGEST_STATUS' }
  | { type: 'MOVE_VIDEO'; srcFolderId: number; dstFolderId: number; resourceId: string; resourceType: number }
  | { type: 'INDEX' }
  | { type: 'GET_SUGGESTIONS'; videos: Video[]; folders: Folder[] };

// Operation status response (for GET_INDEX_STATUS / GET_SUGGEST_STATUS)
export interface OperationStatus {
  inProgress: boolean;
  progress?: string;
  error?: string;
}

// Port-based messages for long-running operations
export type PortMessage =
  | { type: 'FOLDERS_READY'; folders: Folder[] }
  | { type: 'FETCH_PROGRESS'; loaded: number; total: number }
  | { type: 'INDEX_COMPLETE'; videos: Video[]; sourceFolderId: number; timestamp: number }
  | { type: 'SUGGESTION_PROGRESS'; completed: number; total: number }
  | { type: 'SUGGESTIONS_COMPLETE'; suggestions: Record<string, Suggestion[]> }
  | { type: 'ERROR'; error: string };

// Auth Response
export interface AuthResponse {
  loggedIn: boolean;
  uid?: string;
  username?: string;
}

// Bilibili API Response Types

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
