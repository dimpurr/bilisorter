import React, { useState, useEffect, useCallback } from 'react';
import Header from './components/Header';
import EmptyState from './components/EmptyState';
import SettingsPanel from './components/SettingsPanel';
import VideoList from './components/VideoList';
import ToastStack, { type Toast } from './components/ToastStack';
import OperationLogModal from './components/OperationLogModal';
import type { Folder, Video, SourceMeta, FolderIndexCheckpoint, Settings, Suggestion, AuthResponse, PortMessage, LogEntry } from '../../lib/types';
import { STORAGE_KEYS, DEFAULT_SETTINGS, UI } from '../../lib/constants';
import './App.css';

type EmptyStateType =
  | 'not_logged_in'
  | 'folders_not_indexed'
  | 'source_not_loaded'
  | 'source_empty';

const App: React.FC = () => {
  // Auth state
  const [auth, setAuth] = useState<AuthResponse | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  // Pool 1: Folder index
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderIndexTime, setFolderIndexTime] = useState<number | null>(null);
  const [isIndexingFolders, setIsIndexingFolders] = useState(false);
  const [folderCheckpoint, setFolderCheckpoint] = useState<FolderIndexCheckpoint | null>(null);
  const [folderPauseReason, setFolderPauseReason] = useState<string | undefined>(undefined);
  const [folderProgressText, setFolderProgressText] = useState<string | undefined>(undefined);

  // Pool 2: Source videos
  const [sourceVideos, setSourceVideos] = useState<Video[]>([]);
  const [sourceMeta, setSourceMeta] = useState<SourceMeta | null>(null);
  const [sourceFolderId, setSourceFolderId] = useState<number | null>(null);
  const [isLoadingSource, setIsLoadingSource] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Pool 3: Suggestions
  const [suggestions, setSuggestions] = useState<Record<string, Suggestion[]>>({});
  const [isGeneratingSuggestions, setIsGeneratingSuggestions] = useState(false);
  const [suggestProgressText, setSuggestProgressText] = useState<string | undefined>(undefined);

  // Settings state
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Toast state for 5s undo
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Operation log modal
  const [isLogModalOpen, setIsLogModalOpen] = useState(false);
  const [operationLog, setOperationLog] = useState<LogEntry[]>([]);

  // Folder index section collapsed state
  const [isFolderSectionCollapsed, setIsFolderSectionCollapsed] = useState(false);

  // Load operation log on mount
  useEffect(() => {
    const loadLog = async () => {
      try {
        const result = await chrome.storage.local.get(STORAGE_KEYS.OPERATION_LOG);
        if (result[STORAGE_KEYS.OPERATION_LOG]) {
          setOperationLog(result[STORAGE_KEYS.OPERATION_LOG]);
        }
      } catch (error) {
        console.error('[App] Error loading operation log:', error);
      }
    };
    loadLog();
  }, []);

  // Load cached data and settings on mount
  useEffect(() => {
    const loadCache = async () => {
      try {
        const result = await chrome.storage.local.get([
          STORAGE_KEYS.FOLDERS,
          STORAGE_KEYS.FOLDER_INDEX_TIME,
          STORAGE_KEYS.FOLDER_CHECKPOINT,
          STORAGE_KEYS.SOURCE_VIDEOS,
          STORAGE_KEYS.SOURCE_META,
          STORAGE_KEYS.SUGGESTIONS,
          STORAGE_KEYS.SETTINGS,
        ]);

        if (result[STORAGE_KEYS.FOLDERS]) {
          setFolders(result[STORAGE_KEYS.FOLDERS]);
        }

        if (result[STORAGE_KEYS.FOLDER_INDEX_TIME]) {
          setFolderIndexTime(result[STORAGE_KEYS.FOLDER_INDEX_TIME]);
        }

        if (result[STORAGE_KEYS.FOLDER_CHECKPOINT]) {
          setFolderCheckpoint(result[STORAGE_KEYS.FOLDER_CHECKPOINT]);
        }

        if (result[STORAGE_KEYS.SOURCE_VIDEOS]) {
          setSourceVideos(result[STORAGE_KEYS.SOURCE_VIDEOS]);
        }

        if (result[STORAGE_KEYS.SOURCE_META]) {
          const meta: SourceMeta = result[STORAGE_KEYS.SOURCE_META];
          setSourceMeta(meta);
          setSourceFolderId(meta.folderId);
        }

        if (result[STORAGE_KEYS.SUGGESTIONS]) {
          setSuggestions(result[STORAGE_KEYS.SUGGESTIONS]);
        }

        if (result[STORAGE_KEYS.SETTINGS]) {
          const loadedSettings = { ...DEFAULT_SETTINGS, ...result[STORAGE_KEYS.SETTINGS] };
          setSettings(loadedSettings);
          // Set sourceFolderId from settings if not set from meta
          if (!result[STORAGE_KEYS.SOURCE_META] && loadedSettings.sourceFolderId) {
            setSourceFolderId(loadedSettings.sourceFolderId);
          }
        }
      } catch (error) {
        console.error('[App] Error loading cache:', error);
      }
    };

    loadCache();
  }, []);

  // Check auth on mount
  useEffect(() => {
    const checkAuth = async () => {
      setIsCheckingAuth(true);
      try {
        const response = await chrome.runtime.sendMessage({ type: 'CHECK_AUTH' });
        setAuth(response);
      } catch (error) {
        console.error('[App] Auth check failed:', error);
        setAuth({ loggedIn: false });
      } finally {
        setIsCheckingAuth(false);
      }
    };

    checkAuth();
  }, []);

  // Check if background has in-progress operations
  useEffect(() => {
    const checkBackgroundStatus = async () => {
      try {
        const indexRes = await chrome.runtime.sendMessage({ type: 'GET_INDEX_STATUS' });
        if (indexRes?.inProgress) {
          setIsIndexingFolders(true);
          setFolderProgressText(indexRes.progress || '索引进行中...');
        }

        const suggestRes = await chrome.runtime.sendMessage({ type: 'GET_SUGGEST_STATUS' });
        if (suggestRes?.inProgress) {
          setIsGeneratingSuggestions(true);
          setSuggestProgressText(suggestRes.progress || 'AI分析进行中...');
        }
      } catch (error) {
        console.error('[App] Error checking background status:', error);
      }
    };

    checkBackgroundStatus();
  }, []);

  // Listen for storage changes
  useEffect(() => {
    const listener = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area !== 'local') return;

      if (changes[STORAGE_KEYS.FOLDERS]) {
        const newFolders = changes[STORAGE_KEYS.FOLDERS].newValue;
        if (newFolders) setFolders(newFolders);
      }

      if (changes[STORAGE_KEYS.FOLDER_INDEX_TIME]) {
        setFolderIndexTime(changes[STORAGE_KEYS.FOLDER_INDEX_TIME].newValue || null);
      }

      if (changes[STORAGE_KEYS.FOLDER_CHECKPOINT]) {
        setFolderCheckpoint(changes[STORAGE_KEYS.FOLDER_CHECKPOINT].newValue || null);
      }

      if (changes[STORAGE_KEYS.SOURCE_VIDEOS]) {
        const newVideos = changes[STORAGE_KEYS.SOURCE_VIDEOS].newValue;
        if (newVideos) setSourceVideos(newVideos);
      }

      if (changes[STORAGE_KEYS.SOURCE_META]) {
        const newMeta: SourceMeta | undefined = changes[STORAGE_KEYS.SOURCE_META].newValue;
        if (newMeta) setSourceMeta(newMeta);
      }

      if (changes[STORAGE_KEYS.SUGGESTIONS]) {
        const newSuggestions = changes[STORAGE_KEYS.SUGGESTIONS].newValue;
        if (newSuggestions) {
          setSuggestions(newSuggestions);
          // If we were generating, mark complete
          if (isGeneratingSuggestions) {
            setIsGeneratingSuggestions(false);
            setSuggestProgressText(undefined);
          }
        }
      }
    };

    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [isGeneratingSuggestions]);

  // Save settings when changed
  const handleSettingsChange = useCallback(async (newSettings: Settings) => {
    setSettings(newSettings);
    try {
      await chrome.storage.local.set({
        [STORAGE_KEYS.SETTINGS]: newSettings,
      });
    } catch (error) {
      console.error('[App] Error saving settings:', error);
    }
  }, []);

  // ─── Pool 1: Index Folders Handler ───

  const handleIndexFolders = useCallback(() => {
    setIsIndexingFolders(true);
    setFolderPauseReason(undefined);
    setFolderProgressText('正在连接...');

    const port = chrome.runtime.connect({ name: 'bilisorter-index' });

    port.onMessage.addListener((message: PortMessage) => {
      switch (message.type) {
        case 'FOLDERS_READY':
          setFolders(message.folders);
          setFolderProgressText(`已获取 ${message.folders.length} 个收藏夹`);
          break;

        case 'SAMPLING_PROGRESS':
          setFolderProgressText(`采样收藏夹 ${message.sampled}/${message.total} — ${message.currentFolder}`);
          break;

        case 'INDEX_FOLDERS_COMPLETE':
          setFolders(message.folders);
          setFolderIndexTime(message.timestamp);
          setIsIndexingFolders(false);
          setFolderProgressText(undefined);
          setFolderPauseReason(undefined);
          setFolderCheckpoint(null);
          port.disconnect();
          break;

        case 'INDEX_FOLDERS_PAUSED':
          setIsIndexingFolders(false);
          setFolderProgressText(undefined);
          setFolderPauseReason(message.reason);
          port.disconnect();
          break;

        case 'ERROR':
          console.error('[App] Index error:', message.error);
          setIsIndexingFolders(false);
          setFolderProgressText(undefined);
          port.disconnect();
          break;
      }
    });

    port.onDisconnect.addListener(() => {
      console.log('[App] Index port disconnected');
    });

    port.postMessage({ type: 'INDEX_FOLDERS' });
  }, []);

  // ─── Pool 2: Source Video Handlers ───

  const handleFetchSource = useCallback(async (folderId: number) => {
    setIsLoadingSource(true);
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'FETCH_SOURCE',
        folderId,
      });
      if (response?.success) {
        setSourceVideos(response.videos);
        setSourceMeta(response.sourceMeta);
        setSourceFolderId(folderId);
      } else {
        console.error('[App] Fetch source failed:', response?.error);
      }
    } catch (error) {
      console.error('[App] Fetch source error:', error);
    } finally {
      setIsLoadingSource(false);
    }
  }, []);

  const handleRefreshSource = useCallback(async () => {
    if (!sourceFolderId) return;
    setIsLoadingSource(true);
    setSuggestions({});
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'REFRESH_SOURCE',
        folderId: sourceFolderId,
      });
      if (response?.success) {
        setSourceVideos(response.videos);
        setSourceMeta(response.sourceMeta);
      } else {
        console.error('[App] Refresh source failed:', response?.error);
      }
    } catch (error) {
      console.error('[App] Refresh source error:', error);
    } finally {
      setIsLoadingSource(false);
    }
  }, [sourceFolderId]);

  const handleLoadMore = useCallback(async () => {
    if (isLoadingMore || !sourceMeta?.hasMore) return;
    setIsLoadingMore(true);
    try {
      const response = await chrome.runtime.sendMessage({ type: 'LOAD_MORE' });
      if (response?.success) {
        setSourceVideos(response.videos);
        setSourceMeta(response.sourceMeta);
      } else {
        console.error('[App] Load more failed:', response?.error);
      }
    } catch (error) {
      console.error('[App] Load more error:', error);
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, sourceMeta?.hasMore]);

  // ─── Force Reindex ───

  const handleForceReindex = useCallback(async () => {
    try {
      await chrome.runtime.sendMessage({ type: 'FORCE_REINDEX' });
      setFolders([]);
      setSourceVideos([]);
      setSuggestions({});
      setFolderCheckpoint(null);
      setFolderPauseReason(undefined);
      setFolderIndexTime(null);
      setSourceMeta(null);
      setSourceFolderId(null);
      // Start fresh index
      handleIndexFolders();
    } catch (error) {
      console.error('[App] Force reindex error:', error);
    }
  }, [handleIndexFolders]);

  // ─── Pool 3: Suggest Handler ───

  const handleSuggest = useCallback(() => {
    setIsGeneratingSuggestions(true);
    setSuggestProgressText('正在准备AI分析...');

    const port = chrome.runtime.connect({ name: 'bilisorter-suggestions' });

    port.onMessage.addListener((message: PortMessage) => {
      switch (message.type) {
        case 'SUGGESTION_PROGRESS':
          setSuggestProgressText(`正在分析视频... ${message.completed}/${message.total}`);
          break;

        case 'SUGGESTIONS_COMPLETE':
          setSuggestions(message.suggestions);
          setIsGeneratingSuggestions(false);
          setSuggestProgressText(undefined);
          port.disconnect();
          break;

        case 'ERROR':
          console.error('[App] Suggestion error:', message.error);
          setIsGeneratingSuggestions(false);
          setSuggestProgressText(undefined);
          port.disconnect();
          break;
      }
    });

    port.onDisconnect.addListener(() => {
      console.log('[App] Suggestions port disconnected');
    });

    port.postMessage({ type: 'GET_SUGGESTIONS' });
  }, []);

  // ─── Source Folder Change ───

  const handleSourceFolderChange = useCallback((folderId: number) => {
    setSourceFolderId(folderId);
    const newSettings = { ...settings, sourceFolderId: folderId };
    handleSettingsChange(newSettings);
    // Auto-fetch source videos from new folder
    handleFetchSource(folderId);
  }, [settings, handleSettingsChange, handleFetchSource]);

  // ─── Move Handler with 5s Undo ───

  const handleMoveVideo = useCallback(async (video: Video, suggestion: Suggestion) => {
    const toastId = `${video.bvid}-${Date.now()}`;
    const folderName = folders.find(f => f.id === suggestion.folderId)?.name || suggestion.folderName;

    // Optimistically remove video from list
    setSourceVideos(prev => prev.filter(v => v.bvid !== video.bvid));

    const newToast: Toast = {
      id: toastId,
      videoTitle: video.title,
      folderName: folderName,
      timeLeft: UI.UNDO_TIMEOUT_MS,
      totalTime: UI.UNDO_TIMEOUT_MS,
      onUndo: () => {
        setSourceVideos(prev => {
          const index = prev.findIndex(v => v.bvid === video.bvid);
          if (index === -1) return [...prev, video];
          return prev;
        });
        setToasts(prev => prev.filter(t => t.id !== toastId));
      },
      onComplete: async () => {
        try {
          await chrome.runtime.sendMessage({
            type: 'MOVE_VIDEO',
            srcFolderId: sourceFolderId,
            dstFolderId: suggestion.folderId,
            resourceId: video.bvid.replace('BV', ''),
          });

          const logEntry: LogEntry = {
            timestamp: new Date().toISOString(),
            videoTitle: video.title,
            bvid: video.bvid,
            fromFolderName: folders.find(f => f.id === sourceFolderId)?.name || '未知',
            toFolderName: folderName,
          };

          const updatedLog = [logEntry, ...operationLog].slice(0, 1000);
          setOperationLog(updatedLog);
          await chrome.storage.local.set({ [STORAGE_KEYS.OPERATION_LOG]: updatedLog });

          setSuggestions(prev => {
            const next = { ...prev };
            delete next[video.bvid];
            return next;
          });

          // Persist updated source videos and suggestions
          const currentVideos = await chrome.storage.local.get(STORAGE_KEYS.SOURCE_VIDEOS);
          const filtered = (currentVideos[STORAGE_KEYS.SOURCE_VIDEOS] || []).filter(
            (v: Video) => v.bvid !== video.bvid
          );
          await chrome.storage.local.set({
            [STORAGE_KEYS.SOURCE_VIDEOS]: filtered,
          });
        } catch (error) {
          console.error('[App] Move failed:', error);
          setSourceVideos(prev => [...prev, video]);
        }
        setToasts(prev => prev.filter(t => t.id !== toastId));
      },
    };

    setToasts(prev => [...prev, newToast]);
  }, [folders, sourceFolderId, operationLog]);

  // ─── Export Handler ───

  const handleExport = useCallback(() => {
    const exportData = {
      exportDate: new Date().toISOString(),
      sourceFolderId,
      sourceFolderName: folders.find(f => f.id === sourceFolderId)?.name || '未知',
      videos: sourceVideos.map(v => ({
        title: v.title,
        bvid: v.bvid,
        cover: v.cover,
        upper: v.upper,
        tags: v.tags,
        fav_time: v.fav_time,
        suggestions: suggestions[v.bvid] || [],
      })),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bilisorter-export-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [sourceVideos, folders, sourceFolderId, suggestions]);

  // ─── Determine Empty State ───

  const getEmptyState = (): EmptyStateType | null => {
    if (isCheckingAuth) return null;
    if (!auth?.loggedIn) return 'not_logged_in';
    if (folders.length === 0 && !isIndexingFolders) return 'folders_not_indexed';
    if (sourceVideos.length === 0 && folders.length > 0 && !isLoadingSource) return 'source_not_loaded';
    return null;
  };

  const emptyState = getEmptyState();

  // ─── Helper: Format time ago ───

  const formatTimeAgo = (timestamp: number): string => {
    const diffMs = Date.now() - timestamp;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 1) return '刚刚';
    if (diffMins < 60) return `${diffMins}分钟前`;
    if (diffHours < 24) return `${diffHours}小时前`;
    if (diffDays < 7) return `${diffDays}天前`;
    return new Date(timestamp).toLocaleDateString('zh-CN');
  };

  // Index button label
  const indexButtonLabel = (() => {
    if (isIndexingFolders) return '⏳ 索引中...';
    if (folderCheckpoint) return '▶️ 继续索引';
    if (folders.length > 0) return '🔄 重新索引';
    return '📂 索引收藏夹';
  })();

  // Render
  return (
    <div className="app">
      <div className="sticky-header">
        <Header
          username={auth?.username}
          onSettingsToggle={() => setIsSettingsOpen(!isSettingsOpen)}
          onLogToggle={() => setIsLogModalOpen(true)}
          hasSettingsDot={!settings.apiKey && auth?.loggedIn}
        />
      </div>

      <div className="content-area">
        {/* Full-page empty states */}
        {emptyState === 'not_logged_in' && (
          <EmptyState type="not_logged_in" />
        )}

        {emptyState === 'folders_not_indexed' && (
          <EmptyState
            type="folders_not_indexed"
            onAction={handleIndexFolders}
          />
        )}

        {/* Two-zone layout (shown when folders exist) */}
        {auth?.loggedIn && folders.length > 0 && (
          <>
            {/* ─── Zone 1: Folder Index ─── */}
            <div className="folder-index-section">
              <div
                className="section-header clickable"
                onClick={() => setIsFolderSectionCollapsed(!isFolderSectionCollapsed)}
              >
                <span className="section-toggle">{isFolderSectionCollapsed ? '▶' : '▼'}</span>
                <span className="section-title">📂 收藏夹索引</span>
                <span className="section-badge">{folders.length} 个收藏夹</span>
                {folderIndexTime && (
                  <span className="section-time">{formatTimeAgo(folderIndexTime)}</span>
                )}
              </div>

              {!isFolderSectionCollapsed && (
                <div className="section-body">
                  {/* Index status */}
                  {isIndexingFolders && folderProgressText && (
                    <div className="status-loading">
                      <span className="spinner">⏳</span>
                      <span>{folderProgressText}</span>
                    </div>
                  )}

                  {folderPauseReason && (
                    <div className="status-paused">
                      <span className="pause-icon">⏸️</span>
                      <span className="pause-reason">{folderPauseReason}</span>
                    </div>
                  )}

                  {/* Folder index actions */}
                  <div className="section-actions">
                    <button
                      className="btn btn-secondary btn-small"
                      onClick={handleIndexFolders}
                      disabled={isIndexingFolders}
                    >
                      {indexButtonLabel}
                    </button>
                    {folders.length > 0 && (
                      <button
                        className="btn btn-secondary btn-small"
                        onClick={handleForceReindex}
                        disabled={isIndexingFolders}
                        title="清除所有缓存并重新索引"
                      >
                        🗑 清除
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* ─── Zone 2: Source Operations ─── */}
            <div className="source-section">
              <div className="section-header">
                <span className="section-title">📺 源视频</span>
                {/* Source folder selector */}
                {folders.length > 0 && (
                  <div className="source-selector">
                    <select
                      value={sourceFolderId ?? ''}
                      onChange={(e) => handleSourceFolderChange(parseInt(e.target.value, 10))}
                    >
                      {folders.map((folder) => (
                        <option key={folder.id} value={folder.id}>
                          {folder.name} ({folder.media_count})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Source status bar */}
              {(sourceVideos.length > 0 || isLoadingSource) && (
                <div className="source-status">
                  {isLoadingSource ? (
                    <span className="status-loading">
                      <span className="spinner">⏳</span> 正在加载视频...
                    </span>
                  ) : (
                    <>
                      <span className="video-count">
                        {sourceVideos.length}{sourceMeta?.total ? ` / ${sourceMeta.total}` : ''} 个视频
                      </span>
                      {sourceMeta?.lastFetchTime && (
                        <span className="section-time">{formatTimeAgo(sourceMeta.lastFetchTime)}</span>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Suggest progress */}
              {isGeneratingSuggestions && suggestProgressText && (
                <div className="status-loading suggest-progress">
                  <span className="spinner">✨</span>
                  <span>{suggestProgressText}</span>
                </div>
              )}

              {/* Source actions */}
              <div className="section-actions">
                {sourceVideos.length === 0 && !isLoadingSource && sourceFolderId && (
                  <button
                    className="btn btn-primary"
                    onClick={() => handleFetchSource(sourceFolderId)}
                    disabled={isLoadingSource}
                  >
                    📥 加载视频
                  </button>
                )}
                {sourceVideos.length > 0 && (
                  <>
                    <button
                      className="btn btn-primary"
                      onClick={handleSuggest}
                      disabled={!settings.apiKey || isGeneratingSuggestions || isLoadingSource}
                      title={!settings.apiKey ? '请先在设置中配置 API Key' : '生成AI分类建议'}
                    >
                      ✨ AI建议
                    </button>
                    <button
                      className="btn btn-secondary btn-small"
                      onClick={handleRefreshSource}
                      disabled={isLoadingSource}
                      title="重新加载源视频（清除建议）"
                    >
                      🔄 刷新
                    </button>
                    <button
                      className="btn btn-secondary btn-small"
                      onClick={handleExport}
                      title="导出JSON"
                    >
                      📤 导出
                    </button>
                  </>
                )}
              </div>

              {/* Video list or empty */}
              {emptyState === 'source_not_loaded' && sourceFolderId && (
                <EmptyState
                  type="source_not_loaded"
                  onAction={() => handleFetchSource(sourceFolderId)}
                />
              )}

              {sourceVideos.length > 0 && (
                <VideoList
                  videos={sourceVideos}
                  suggestions={suggestions}
                  onSuggestionClick={handleMoveVideo}
                  hasMore={sourceMeta?.hasMore || false}
                  isLoadingMore={isLoadingMore}
                  totalVideoCount={sourceMeta?.total}
                  onLoadMore={handleLoadMore}
                />
              )}
            </div>
          </>
        )}
      </div>

      <div className="toast-area">
        <ToastStack
          toasts={toasts}
          onRemove={(id) => setToasts(prev => prev.filter(t => t.id !== id))}
        />
      </div>

      {isSettingsOpen && (
        <SettingsPanel
          isOpen={isSettingsOpen}
          settings={settings}
          folders={folders}
          onSettingsChange={handleSettingsChange}
          onClose={() => setIsSettingsOpen(false)}
        />
      )}

      {isLogModalOpen && (
        <OperationLogModal
          isOpen={isLogModalOpen}
          log={operationLog}
          onClose={() => setIsLogModalOpen(false)}
        />
      )}
    </div>
  );
};

export default App;
