// BiliSorter - Constants (v0.2 Three-Pool Architecture)

// API Base URLs
export const BILIBILI_API_BASE = 'https://api.bilibili.com';
export const BILIBILI_WEB_BASE = 'https://www.bilibili.com';
export const CLAUDE_API_BASE = 'https://api.anthropic.com';

// Storage Keys (mirrors types.ts)
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

// Default Settings
export const DEFAULT_SETTINGS = {
  apiKey: '',
  model: 'claude-3-5-haiku-latest' as const,
  sourceFolderId: null as number | null,
};

// Bilibili API Endpoints
export const BILI_API = {
  NAV: '/x/web-interface/nav',
  FOLDER_LIST: '/x/v3/fav/folder/created/list-all',
  VIDEO_LIST: '/x/v3/fav/resource/list',
  MOVE: '/x/v3/fav/resource/move',
} as const;

// Claude API Endpoints
export const CLAUDE_API = {
  MESSAGES: '/v1/messages',
} as const;

// Source Video Pagination
export const SOURCE = {
  PAGE_SIZE: 20, // B站 API page size
  PAGES_PER_LOAD: 3, // 3 pages × 20 = 60 videos per load
  PAGE_DELAY_MS: 500, // delay between page fetches
} as const;

// Folder Sampling
export const SAMPLING = {
  DELAY_MS: 500, // delay between folder sample requests
  COOLDOWN_MS: 5000, // cooldown after completing sampling before any video fetches
} as const;

// UI Constants
export const UI = {
  POPUP_WIDTH: 400,
  POPUP_MAX_HEIGHT: 600,
  THUMBNAIL_WIDTH: 60,
  THUMBNAIL_HEIGHT: 45,
  MAX_BADGES_PER_VIDEO: 5,
  MAX_VISIBLE_TOASTS: 5,
  UNDO_TIMEOUT_MS: 5000,
  TOAST_COUNTDOWN_INTERVAL_MS: 100,
} as const;

// AI Batch Constants
export const AI_BATCH = {
  MIN_BATCH_SIZE: 5,
  MAX_BATCH_SIZE: 10,
  INTER_BATCH_DELAY_MS: 1000, // increased from 300ms for reliability
  MAX_RETRIES: 2, // increased from 1
  RETRY_BACKOFF_MS: 2000, // backoff on retry
  RATE_LIMIT_PAUSE_MS: 30000, // 30s
} as const;

// Confidence Thresholds
export const CONFIDENCE = {
  HIGH: 0.8,
  MEDIUM: 0.5,
  HIGH_COLOR: '#22c55e', // green
  MEDIUM_COLOR: '#f59e0b', // amber
  LOW_COLOR: '#6b7280', // grey
} as const;

// Color Theme (Dark)
export const COLORS = {
  BG_PRIMARY: '#17181A',
  BG_SECONDARY: '#1f2022',
  BG_TERTIARY: '#2a2b2d',
  TEXT_PRIMARY: '#ffffff',
  TEXT_SECONDARY: '#b0b0b0',
  TEXT_TERTIARY: '#808080',
  BORDER: '#333333',
  ACCENT: '#00a1d6', // Bilibili blue
  SUCCESS: '#22c55e',
  WARNING: '#f59e0b',
  ERROR: '#ef4444',
} as const;
