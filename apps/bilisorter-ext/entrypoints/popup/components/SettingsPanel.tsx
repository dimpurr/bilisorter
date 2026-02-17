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
  const [showGeminiKey, setShowGeminiKey] = useState(false);

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

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setLocalSettings((prev) => ({
      ...prev,
      provider: e.target.value as Settings['provider'],
    }));
  };

  const handleGeminiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalSettings((prev) => ({ ...prev, geminiApiKey: e.target.value }));
  };

  const handleGeminiModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setLocalSettings((prev) => ({ ...prev, geminiModel: e.target.value }));
  };

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

  const isGemini = localSettings.provider === 'gemini';
  const activeKey = isGemini ? localSettings.geminiApiKey : localSettings.apiKey;

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
          {/* Provider Selection */}
          <div className="settings-section">
            <label htmlFor="provider">AI 服务商</label>
            <select id="provider" value={localSettings.provider || 'gemini'} onChange={handleProviderChange}>
              <option value="gemini">Google Gemini (推荐)</option>
              <option value="claude">Anthropic Claude</option>
            </select>
          </div>

          {/* Gemini Settings */}
          {isGemini && (
            <>
              <div className="settings-section">
                <label htmlFor="gemini-key">Gemini API Key</label>
                <div className="input-group">
                  <input
                    id="gemini-key"
                    type={showGeminiKey ? 'text' : 'password'}
                    value={localSettings.geminiApiKey}
                    onChange={handleGeminiKeyChange}
                    placeholder="AIza..."
                    className={!localSettings.geminiApiKey ? 'warning' : ''}
                  />
                  <button
                    type="button"
                    className="toggle-visibility"
                    onClick={() => setShowGeminiKey(!showGeminiKey)}
                  >
                    {showGeminiKey ? '🙈' : '👁️'}
                  </button>
                </div>
                {!localSettings.geminiApiKey && (
                  <p className="hint warning">需要 API Key 才能使用 AI 分类功能</p>
                )}
                <p className="hint">
                  从 <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" style={{color: '#00a1d6'}}>AI Studio</a> 获取免费 API Key
                </p>
              </div>

              <div className="settings-section">
                <label htmlFor="gemini-model">Gemini 模型</label>
                <select id="gemini-model" value={localSettings.geminiModel || 'gemini-3-flash-preview'} onChange={handleGeminiModelChange}>
                  <option value="gemini-3-flash-preview">
                    Gemini 3 Flash Preview (推荐 - 最新)
                  </option>
                  <option value="gemini-2.5-flash-preview-05-20">
                    Gemini 2.5 Flash Preview
                  </option>
                  <option value="gemini-2.0-flash">
                    Gemini 2.0 Flash (稳定)
                  </option>
                </select>
              </div>
            </>
          )}

          {/* Claude Settings */}
          {!isGemini && (
            <>
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

              <div className="settings-section">
                <label htmlFor="model">Claude 模型</label>
                <select id="model" value={localSettings.model} onChange={handleModelChange}>
                  <option value="claude-3-5-haiku-latest">
                    Claude 3.5 Haiku (推荐 - 快速经济)
                  </option>
                  <option value="claude-sonnet-4-latest">
                    Claude 4 Sonnet (更智能)
                  </option>
                </select>
              </div>
            </>
          )}

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
