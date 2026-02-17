import React from 'react';

interface HeaderProps {
  username?: string;
  onSettingsToggle: () => void;
  onLogToggle: () => void;
  onFolderManager: () => void;
  hasSettingsDot?: boolean;
}

const Header: React.FC<HeaderProps> = ({
  username,
  onSettingsToggle,
  onLogToggle,
  onFolderManager,
  hasSettingsDot = false,
}) => {
  const isSidepanel = document.body.classList.contains('sidepanel');

  const handleOpenSidepanel = () => {
    // Open side panel from popup, then close popup
    chrome.runtime.sendMessage({ type: 'OPEN_SIDEPANEL' });
    window.close();
  };

  return (
    <div className="header">
      <div className="header-row">
        <div className="header-title">BiliSorter</div>
        <div className="header-actions">
          {!isSidepanel && (
            <button
              className="icon-btn"
              onClick={handleOpenSidepanel}
              title="在侧栏打开"
            >
              📌
            </button>
          )}
          <button
            className="icon-btn"
            onClick={onFolderManager}
            title="收藏夹管理"
          >
            📁
          </button>
          <button
            className="icon-btn"
            onClick={onLogToggle}
            title="操作日志"
          >
            📋
          </button>
          <button
            className={`icon-btn ${hasSettingsDot ? 'has-dot' : ''}`}
            onClick={onSettingsToggle}
            title="设置"
          >
            ⚙️
          </button>
        </div>
      </div>

      {username && (
        <div className="header-row header-info">
          <span className="username">👤 {username}</span>
        </div>
      )}
    </div>
  );
};

export default Header;
