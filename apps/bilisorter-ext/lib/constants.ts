// BiliSorter - Constants

// API Base URLs
export const BILIBILI_API_BASE = 'https://api.bilibili.com';
export const BILIBILI_WEB_BASE = 'https://www.bilibili.com';
export const CLAUDE_API_BASE = 'https://api.anthropic.com';

// Storage Keys
export const STORAGE_KEYS = {
  SETTINGS: 'bilisorter_settings',
  FOLDERS: 'bilisorter_folders',
  VIDEOS: 'bilisorter_videos',
  VIDEO_META: 'bilisorter_videoMeta',
  SUGGESTIONS: 'bilisorter_suggestions',
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
  INTER_BATCH_DELAY_MS: 300,
  MAX_RETRIES: 1,
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
