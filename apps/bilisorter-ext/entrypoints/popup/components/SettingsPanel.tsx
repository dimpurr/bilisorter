import React, { useState, useEffect, useCallback } from 'react';
import type { Folder, Settings } from '../../../lib/types';
import { DEFAULT_SETTINGS } from '../../../lib/constants';

interface SettingsPanelProps {
  isOpen: boolean;
  settings: Settings;
  folders: Folder[];
  onSettingsChange: (settings: Settings) => void;
  onClose: () => void;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({
  isOpen,
  settings,
  folders,
  onSettingsChange,
  onClose,
}) => {
  const [localSettings, setLocalSettings] = useState<Settings>(settings);
  const [showApiKey, setShowApiKey] = useState(false);

  // Update local settings when props change
  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  // Debounced save
  useEffect(() => {
    const timer = setTimeout(() => {
      if (JSON.stringify(localSettings) !== JSON.stringify(settings)) {
        onSettingsChange(localSettings);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [localSettings, settings, onSettingsChange]);

  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalSettings((prev) => ({ ...prev, apiKey: e.target.value }));
  };

  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setLocalSettings((prev) => ({
      ...prev,
      model: e.target.value as Settings['model'],
    }));
  };

  const handleSourceFolderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    setLocalSettings((prev) => ({
      ...prev,
      sourceFolderId: value ? parseInt(value, 10) : null,
    }));
  };

  const handleReset = () => {
    setLocalSettings(DEFAULT_SETTINGS);
    onSettingsChange(DEFAULT_SETTINGS);
  };

  if (!isOpen) return null;

  return (
    <div className="settings-panel-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h3>⚙️ 设置</h3>
          <button className="close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="settings-content">
          {/* API Key */}
          <div className="settings-section">
            <label htmlFor="api-key">Claude API Key</label>
            <div className="input-group">
              <input
                id="api-key"
                type={showApiKey ? 'text' : 'password'}
                value={localSettings.apiKey}
                onChange={handleApiKeyChange}
                placeholder="sk-ant-api03-..."
                className={!localSettings.apiKey ? 'warning' : ''}
              />
              <button
                type="button"
                className="toggle-visibility"
                onClick={() => setShowApiKey(!showApiKey)}
              >
                {showApiKey ? '🙈' : '👁️'}
              </button>
            </div>
            {!localSettings.apiKey && (
              <p className="hint warning">需要 API Key 才能使用 AI 分类功能</p>
            )}
          </div>

          {/* Model Selection */}
          <div className="settings-section">
            <label htmlFor="model">AI 模型</label>
            <select id="model" value={localSettings.model} onChange={handleModelChange}>
              <option value="claude-3-5-haiku-latest">
                Claude 3.5 Haiku (推荐 - 快速经济)
              </option>
              <option value="claude-sonnet-4-latest">
                Claude 4 Sonnet (更智能)
              </option>
            </select>
            <p className="hint">
              Haiku 足够准确且更快速，推荐日常使用
            </p>
          </div>

          {/* Source Folder */}
          <div className="settings-section">
            <label htmlFor="source-folder">源收藏夹</label>
            <select
              id="source-folder"
              value={localSettings.sourceFolderId ?? ''}
              onChange={handleSourceFolderChange}
              disabled={folders.length === 0}
            >
              <option value="">默认收藏夹</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name} ({folder.media_count})
                </option>
              ))}
            </select>
            <p className="hint">
              {folders.length > 0
                ? '选择要从哪个收藏夹整理视频'
                : '请先点击"索引"按钮获取收藏夹列表'}
            </p>
          </div>

          {/* Reset */}
          <div className="settings-section">
            <button className="btn btn-secondary" onClick={handleReset}>
              重置为默认设置
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;
