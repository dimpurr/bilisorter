import React from 'react';

interface HeaderProps {
  username?: string;
  onSettingsToggle: () => void;
  onLogToggle: () => void;
  hasSettingsDot?: boolean;
}

const Header: React.FC<HeaderProps> = ({
  username,
  onSettingsToggle,
  onLogToggle,
  hasSettingsDot = false,
}) => {
  return (
    <div className="header">
      <div className="header-row">
        <div className="header-title">BiliSorter</div>
        <div className="header-actions">
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
