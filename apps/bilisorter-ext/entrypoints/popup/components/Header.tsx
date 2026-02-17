import React from 'react';
import type { Folder } from '../../../lib/types';

interface HeaderProps {
  username?: string;
  folders: Folder[];
  sourceFolderId: number | null;
  onSourceFolderChange: (folderId: number) => void;
  onSettingsToggle: () => void;
  hasSettingsDot?: boolean;
}

const Header: React.FC<HeaderProps> = ({
  username,
  folders,
  sourceFolderId,
  onSourceFolderChange,
  onSettingsToggle,
  hasSettingsDot = false,
}) => {
  const handleFolderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const folderId = parseInt(e.target.value, 10);
    onSourceFolderChange(folderId);
  };

  // Find current folder name for duplicate disambiguation
  const getFolderDisplayName = (folder: Folder): string => {
    const duplicates = folders.filter((f) => f.name === folder.name);
    if (duplicates.length > 1) {
      return `${folder.name} (${folder.media_count})`;
    }
    return folder.name;
  };

  return (
    <div className="header">
      <div className="header-row">
        <div className="header-title">BiliSorter</div>
        <button
          className={`settings-btn ${hasSettingsDot ? 'has-dot' : ''}`}
          onClick={onSettingsToggle}
          title="设置"
        >
          ⚙️
        </button>
      </div>

      {username && (
        <div className="header-row header-info">
          <span className="username">👤 {username}</span>
          {folders.length > 0 && (
            <div className="source-selector">
              <label>源:</label>
              <select
                value={sourceFolderId ?? ''}
                onChange={handleFolderChange}
                disabled={folders.length === 0}
              >
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {getFolderDisplayName(folder)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Header;
