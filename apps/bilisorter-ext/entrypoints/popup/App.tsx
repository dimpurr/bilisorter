import React, { useState, useEffect, useCallback } from 'react';
import Header from './components/Header';
import ButtonBar from './components/ButtonBar';
import StatusBar from './components/StatusBar';
import EmptyState from './components/EmptyState';
import type { Folder, Video, Settings, AuthResponse } from '../../lib/types';
import { STORAGE_KEYS, DEFAULT_SETTINGS } from '../../lib/constants';
import './App.css';

type EmptyStateType =
  | 'not_logged_in'
  | 'no_cache_no_key'
  | 'no_cache_with_key'
  | 'empty_folder'
  | 'all_invalid'
  | 'only_one_folder';

const App: React.FC = () => {
  // Auth state
  const [auth, setAuth] = useState<AuthResponse> | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  // Data state
  const [folders, setFolders] = useState<Folder[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [sourceFolderId, setSourceFolderId] = useState<number | null>(null);
  const [lastIndexed, setLastIndexed] = useState<number | null>(null);

  // Settings state
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Loading state
  const [isIndexing, setIsIndexing] = useState(false);
  const [progressText, setProgressText] = useState<string | undefined>(undefined);

  // Load cached data and settings on mount
  useEffect(() => {
    const loadCache = async () => {
      try {
        const result = await chrome.storage.local.get([
          STORAGE_KEYS.FOLDERS,
          STORAGE_KEYS.VIDEOS,
          STORAGE_KEYS.SETTINGS,
          'bilisorter_lastIndexed',
        ]);

        if (result[STORAGE_KEYS.FOLDERS]) {
          setFolders(result[STORAGE_KEYS.FOLDERS]);
        }

        if (result[STORAGE_KEYS.VIDEOS]) {
          setVideos(result[STORAGE_KEYS.VIDEOS]);
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

  // Handlers
  const handleIndex = () => {
    // Will be implemented in Step 4
    console.log('[App] Index requested');
  };

  const handleSuggest = () => {
    // Will be implemented in Step 6
    console.log('[App] Suggest requested');
  };

  const handleExport = () => {
    // Will be implemented in Step 9
    console.log('[App] Export requested');
  };

  const handleLog = () => {
    // Will be implemented in Step 9
    console.log('[App] Log requested');
  };

  const handleSourceFolderChange = (folderId: number) => {
    setSourceFolderId(folderId);
    // Will trigger re-fetch in Step 4
  };

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
          canSuggest={auth?.loggedIn === true && videos.length > 0 && !!settings.apiKey && !isIndexing}
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
          <div className="video-list-placeholder">
            {/* Video list will be implemented in Step 4 */}
            <div className="placeholder-text">视频列表将在此处显示</div>
          </div>
        )}
      </div>

      <div className="toast-area">{/* Toasts will be implemented in Step 8 */}</div>
    </div>
  );
};

export default App;
