import React from 'react';

interface StatusBarProps {
  progressText?: string;
  videoCount?: number;
  lastIndexed?: number | null;
  isLoading?: boolean;
}

const StatusBar: React.FC<StatusBarProps> = ({
  progressText,
  videoCount,
  lastIndexed,
  isLoading = false,
}) => {
  const formatLastIndexed = (timestamp: number): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return '刚刚';
    if (diffMins < 60) return `${diffMins}分钟前`;
    if (diffHours < 24) return `${diffHours}小时前`;
    if (diffDays < 7) return `${diffDays}天前`;
    return date.toLocaleDateString('zh-CN');
  };

  return (
    <div className="status-bar">
      {isLoading && progressText ? (
        <div className="status-loading">
          <span className="spinner">⏳</span>
          <span>{progressText}</span>
        </div>
      ) : (
        <div className="status-info">
          {videoCount !== undefined && (
            <span className="video-count">{videoCount} 个视频</span>
          )}
          {lastIndexed && (
            <span className="last-indexed">
              上次索引: {formatLastIndexed(lastIndexed)}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export default StatusBar;
