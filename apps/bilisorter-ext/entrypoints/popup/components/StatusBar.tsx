import React from 'react';
import type { IndexCheckpoint } from '../../../lib/types';

interface StatusBarProps {
  progressText?: string;
  pauseReason?: string;
  videoCount?: number;
  totalVideoCount?: number;
  lastIndexed?: number | null;
  isLoading?: boolean;
  checkpoint?: IndexCheckpoint | null;
}

const StatusBar: React.FC<StatusBarProps> = ({
  progressText,
  pauseReason,
  videoCount,
  totalVideoCount,
  lastIndexed,
  isLoading = false,
  checkpoint,
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

  // Build checkpoint status summary
  const checkpointStatus = (() => {
    if (!checkpoint || checkpoint.stage === 'complete') return null;
    const parts: string[] = [];
    if (checkpoint.stage === 'sampling') {
      parts.push(`已采样 ${checkpoint.foldersSampled.length}/${checkpoint.totalFolders} 收藏夹`);
    } else if (checkpoint.stage === 'videos') {
      parts.push(`采样完成`);
      if (checkpoint.videosNextPage > 1) {
        parts.push(`已获取 ${(checkpoint.videosNextPage - 1) * 20} 个视频`);
      }
    }
    return parts.join(', ');
  })();

  return (
    <div className="status-bar">
      {isLoading && progressText ? (
        <div className="status-loading">
          <span className="spinner">⏳</span>
          <span>{progressText}</span>
        </div>
      ) : pauseReason ? (
        <div className="status-paused">
          <span className="pause-icon">⏸️</span>
          <span className="pause-reason">{pauseReason}</span>
        </div>
      ) : (
        <div className="status-info">
          {videoCount !== undefined && (
            <span className="video-count">
              {videoCount} 个视频{totalVideoCount && totalVideoCount > videoCount ? ` / 共 ${totalVideoCount}` : ''}
            </span>
          )}
          {checkpointStatus && (
            <span className="checkpoint-status">
              {checkpointStatus}
            </span>
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
