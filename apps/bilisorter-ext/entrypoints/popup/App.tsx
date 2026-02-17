import React, { useState, useEffect, useCallback } from 'react';
import Header from './components/Header';
import ButtonBar from './components/ButtonBar';
import StatusBar from './components/StatusBar';
import EmptyState from './components/EmptyState';
import SettingsPanel from './components/SettingsPanel';
import VideoList from './components/VideoList';
import ToastStack, { type Toast } from './components/ToastStack';
import OperationLogModal from './components/OperationLogModal';
import type { Folder, Video, Settings, Suggestion, AuthResponse, PortMessage, LogEntry } from '../../lib/types';
import { STORAGE_KEYS, DEFAULT_SETTINGS, UI } from '../../lib/constants';
import './App.css';

type EmptyStateType =
  | 'not_logged_in'
  | 'no_cache_no_key'
  | 'no_cache_with_key'
  | 'empty_folder'
  | 'all_invalid'
  | 'only_one_folder'
  | 'ai_all_failed'
  | 'ai_partial_failed';

const App: React.FC = () => {
  // Auth state
  const [auth, setAuth] = useState<AuthResponse | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  // Data state
  const [folders, setFolders] = useState<Folder[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [suggestions, setSuggestions] = useState<Record<string, Suggestion[]>>({});
  const [sourceFolderId, setSourceFolderId] = useState<number | null>(null);
  const [lastIndexed, setLastIndexed] = useState<number | null>(null);

  // Settings state
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Loading state
  const [isIndexing, setIsIndexing] = useState(false);
  const [isGeneratingSuggestions, setIsGeneratingSuggestions] = useState(false);
  const [progressText, setProgressText] = useState<string | undefined>(undefined);

  // Toast state for 5s undo
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Operation log modal
  const [isLogModalOpen, setIsLogModalOpen] = useState(false);
  const [operationLog, setOperationLog] = useState<LogEntry[]>([]);

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
          STORAGE_KEYS.VIDEOS,
          STORAGE_KEYS.SUGGESTIONS,
          STORAGE_KEYS.SETTINGS,
          'bilisorter_lastIndexed',
        ]);

        if (result[STORAGE_KEYS.FOLDERS]) {
          setFolders(result[STORAGE_KEYS.FOLDERS]);
        }

        if (result[STORAGE_KEYS.VIDEOS]) {
          setVideos(result[STORAGE_KEYS.VIDEOS]);
        }

        if (result[STORAGE_KEYS.SUGGESTIONS]) {
          setSuggestions(result[STORAGE_KEYS.SUGGESTIONS]);
        }

        if (result[STORAGE_KEYS.SETTINGS]) {
          setSettings({ ...DEFAULT_SETTINGS, ...result[STORAGE_KEYS.SETTINGS] });
        }

        if (result.bilisorter_lastIndexed) {
          setLastIndexed(result.bilisorter_lastIndexed);
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

  // Check if background has an in-progress operation (popup was closed and reopened)
  useEffect(() => {
    const checkBackgroundStatus = async () => {
      try {
        const indexRes = await chrome.runtime.sendMessage({ type: 'GET_INDEX_STATUS' });
        if (indexRes?.inProgress) {
          setIsIndexing(true);
          setProgressText(indexRes.progress || '索引进行中...');
        }

        const suggestRes = await chrome.runtime.sendMessage({ type: 'GET_SUGGEST_STATUS' });
        if (suggestRes?.inProgress) {
          setIsGeneratingSuggestions(true);
          setProgressText(suggestRes.progress || 'AI分析进行中...');
        }
      } catch (error) {
        console.error('[App] Error checking background status:', error);
      }
    };

    checkBackgroundStatus();
  }, []);

  // Listen for storage changes to detect when background completes an operation
  useEffect(() => {
    const listener = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area !== 'local') return;

      // If videos were updated while we're in indexing state, reload data
      if (changes[STORAGE_KEYS.VIDEOS] && isIndexing) {
        const newVideos = changes[STORAGE_KEYS.VIDEOS].newValue;
        if (newVideos) {
          setVideos(newVideos);
          setIsIndexing(false);
          setProgressText(undefined);
        }
      }

      if (changes[STORAGE_KEYS.FOLDERS]) {
        const newFolders = changes[STORAGE_KEYS.FOLDERS].newValue;
        if (newFolders) {
          setFolders(newFolders);
        }
      }

      if (changes.bilisorter_lastIndexed) {
        setLastIndexed(changes.bilisorter_lastIndexed.newValue);
      }

      // If suggestions were updated while generating
      if (changes[STORAGE_KEYS.SUGGESTIONS] && isGeneratingSuggestions) {
        const newSuggestions = changes[STORAGE_KEYS.SUGGESTIONS].newValue;
        if (newSuggestions) {
          setSuggestions(newSuggestions);
          setIsGeneratingSuggestions(false);
          setProgressText(undefined);
        }
      }
    };

    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [isIndexing, isGeneratingSuggestions]);

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

  // Index handler
  const handleIndex = useCallback(() => {
    setIsIndexing(true);
    setProgressText('正在连接...');

    const port = chrome.runtime.connect({ name: 'bilisorter-index' });

    port.onMessage.addListener((message: PortMessage) => {
      switch (message.type) {
        case 'FOLDERS_READY':
          setFolders(message.folders);
          setProgressText(`已获取 ${message.folders.length} 个收藏夹`);
          break;

        case 'FETCH_PROGRESS':
          setProgressText(`正在获取视频... ${message.loaded}/${message.total}`);
          break;

        case 'INDEX_COMPLETE':
          setVideos(message.videos);
          setSourceFolderId(message.sourceFolderId);
          setLastIndexed(message.timestamp);
          setIsIndexing(false);
          setProgressText(undefined);
          port.disconnect();
          break;

        case 'ERROR':
          console.error('[App] Index error:', message.error);
          setIsIndexing(false);
          setProgressText(undefined);
          port.disconnect();
          break;
      }
    });

    port.onDisconnect.addListener(() => {
      // Don't reset state — background may still be working.
      // The storage.onChanged listener will handle completion.
      console.log('[App] Index port disconnected');
    });

    port.postMessage({ type: 'INDEX' });
  }, [isIndexing]);

  // Suggest handler
  const handleSuggest = useCallback(() => {
    setIsGeneratingSuggestions(true);
    setProgressText('正在准备AI分析...');

    const port = chrome.runtime.connect({ name: 'bilisorter-suggestions' });

    port.onMessage.addListener((message: PortMessage) => {
      switch (message.type) {
        case 'SUGGESTION_PROGRESS':
          setProgressText(`正在分析视频... ${message.completed}/${message.total}`);
          break;

        case 'SUGGESTIONS_COMPLETE':
          setSuggestions(message.suggestions);
          setIsGeneratingSuggestions(false);
          setProgressText(undefined);
          // Save to storage
          chrome.storage.local.set({ [STORAGE_KEYS.SUGGESTIONS]: message.suggestions });
          port.disconnect();
          break;

        case 'ERROR':
          console.error('[App] Suggestion error:', message.error);
          setIsGeneratingSuggestions(false);
          setProgressText(undefined);
          port.disconnect();
          break;
      }
    });

    port.onDisconnect.addListener(() => {
      // Don't reset state — background may still be working.
      console.log('[App] Suggestions port disconnected');
    });

    // Send GET_SUGGESTIONS message with videos and folders
    port.postMessage({
      type: 'GET_SUGGESTIONS',
      videos,
      folders,
    });
  }, [videos, folders, isGeneratingSuggestions]);

  // Move handler with 5s undo
  const handleMoveVideo = useCallback(async (video: Video, suggestion: Suggestion) => {
    const toastId = `${video.bvid}-${Date.now()}`;
    const folderName = folders.find(f => f.id === suggestion.folderId)?.name || suggestion.folderName;

    // Optimistically remove video from list
    setVideos(prev => prev.filter(v => v.bvid !== video.bvid));

    // Create toast
    const newToast: Toast = {
      id: toastId,
      videoTitle: video.title,
      folderName: folderName,
      timeLeft: UI.UNDO_TIMEOUT_MS,
      totalTime: UI.UNDO_TIMEOUT_MS,
      onUndo: () => {
        // Re-insert video at original position
        setVideos(prev => {
          const index = prev.findIndex(v => v.bvid === video.bvid);
          if (index === -1) {
            return [...prev, video];
          }
          return prev;
        });
        setToasts(prev => prev.filter(t => t.id !== toastId));
      },
      onComplete: async () => {
        // Perform actual move via background
        try {
          const cookies = await chrome.runtime.sendMessage({ type: 'GET_COOKIES' });
          if (!cookies) return;

          await chrome.runtime.sendMessage({
            type: 'MOVE_VIDEO',
            srcFolderId: sourceFolderId,
            dstFolderId: suggestion.folderId,
            resourceId: video.bvid.replace('BV', ''),
            resourceType: 2
          });

          // Add to operation log
          const logEntry: LogEntry = {
            timestamp: new Date().toISOString(),
            videoTitle: video.title,
            bvid: video.bvid,
            fromFolderName: folders.find(f => f.id === sourceFolderId)?.name || '未知',
            toFolderName: folderName
          };

          const updatedLog = [logEntry, ...operationLog].slice(0, 1000); // Keep last 1000
          setOperationLog(updatedLog);
          await chrome.storage.local.set({ [STORAGE_KEYS.OPERATION_LOG]: updatedLog });

          // Remove from suggestions
          setSuggestions(prev => {
            const newSuggestions = { ...prev };
            delete newSuggestions[video.bvid];
            return newSuggestions;
          });

          // Save updated videos and suggestions
          await chrome.storage.local.set({
            [STORAGE_KEYS.VIDEOS]: videos.filter(v => v.bvid !== video.bvid),
            [STORAGE_KEYS.SUGGESTIONS]: suggestions
          });
        } catch (error) {
          console.error('[App] Move failed:', error);
          // Re-insert video on error
          setVideos(prev => [...prev, video]);
        }
        setToasts(prev => prev.filter(t => t.id !== toastId));
      }
    };

    setToasts(prev => [...prev, newToast]);
  }, [videos, folders, sourceFolderId, suggestions, operationLog]);

  // Export handler
  const handleExport = useCallback(() => {
    const exportData = {
      exportDate: new Date().toISOString(),
      sourceFolderId,
      sourceFolderName: folders.find(f => f.id === sourceFolderId)?.name || '未知',
      videos: videos.map(v => ({
        title: v.title,
        bvid: v.bvid,
        cover: v.cover,
        upper: v.upper,
        tags: v.tags,
        fav_time: v.fav_time,
        suggestions: suggestions[v.bvid] || []
      }))
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bilisorter-export-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [videos, folders, sourceFolderId, suggestions]);

  // Log handler
  const handleLog = useCallback(() => {
    setIsLogModalOpen(true);
  }, []);

  // Source folder change handler
  const handleSourceFolderChange = useCallback((folderId: number) => {
    setSourceFolderId(folderId);
    // Save to settings
    const newSettings = { ...settings, sourceFolderId: folderId };
    handleSettingsChange(newSettings);
    // Will trigger re-fetch in Step 4
  }, [settings, handleSettingsChange]);

  // Determine empty state
  const getEmptyState = (): EmptyStateType | null => {
    if (isCheckingAuth) return null;
    if (!auth?.loggedIn) return 'not_logged_in';
    if (videos.length === 0) {
      if (!settings.apiKey) return 'no_cache_no_key';
      return 'no_cache_with_key';
    }
    // Additional states would be checked here based on video content
    return null;
  };

  const emptyState = getEmptyState();

  // Render
  return (
    <div className="app">
      <div className="sticky-header">
        <Header
          username={auth?.username}
          folders={folders}
          sourceFolderId={sourceFolderId}
          onSourceFolderChange={handleSourceFolderChange}
          onSettingsToggle={() => setIsSettingsOpen(!isSettingsOpen)}
          hasSettingsDot={!settings.apiKey && auth?.loggedIn}
        />

        <ButtonBar
          onIndex={handleIndex}
          onSuggest={handleSuggest}
          onExport={handleExport}
          onLog={handleLog}
          canIndex={auth?.loggedIn === true && !isIndexing}
          canSuggest={auth?.loggedIn === true && videos.length > 0 && !!settings.apiKey && !isIndexing && !isGeneratingSuggestions}
          canExport={videos.length > 0}
          hasIndexedData={videos.length > 0}
        />

        <StatusBar
          progressText={isIndexing ? progressText : undefined}
          videoCount={videos.length > 0 && !isIndexing ? videos.length : undefined}
          lastIndexed={!isIndexing ? lastIndexed : undefined}
          isLoading={isIndexing}
        />
      </div>

      <div className="content-area">
        {emptyState ? (
          <EmptyState
            type={emptyState}
            onAction={emptyState === 'no_cache_no_key' || emptyState === 'no_cache_with_key' ? handleIndex : undefined}
          />
        ) : (
          <VideoList
            videos={videos}
            suggestions={suggestions}
          />
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
