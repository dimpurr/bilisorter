import React from 'react';
import type { Video, Suggestion } from '../../../lib/types';

interface VideoCardProps {
  video: Video;
  suggestions?: Suggestion[];
  onSuggestionClick?: (suggestion: Suggestion) => void;
}

const formatPlayCount = (count: number): string => {
  if (count >= 10000) {
    return `${(count / 10000).toFixed(1)}万`;
  }
  return String(count);
};

const formatDate = (dateStr: string): string => {
  const date = new Date(dateStr);
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
};

const getConfidenceColor = (confidence: number): string => {
  if (confidence >= 0.8) return '#22c55e'; // green
  if (confidence >= 0.5) return '#f59e0b'; // amber
  return '#6b7280'; // grey
};

const VideoCard: React.FC<VideoCardProps> = ({
  video,
  suggestions,
  onSuggestionClick,
}) => {
  const isInvalid = video.attr !== 0;

  const handleSuggestionClick = (suggestion: Suggestion) => {
    if (onSuggestionClick && !isInvalid) {
      onSuggestionClick(suggestion);
    }
  };

  return (
    <div className={`video-card ${isInvalid ? 'invalid' : ''}`}>
      <a
        href={`https://www.bilibili.com/video/${video.bvid}`}
        target="_blank"
        rel="noopener noreferrer"
        className="video-thumbnail"
      >
        <img src={video.cover} alt={video.title} loading="lazy" />
        {isInvalid && <span className="invalid-badge">已失效</span>}
      </a>

      <div className="video-info">
        <a
          href={`https://www.bilibili.com/video/${video.bvid}`}
          target="_blank"
          rel="noopener noreferrer"
          className="video-title"
          title={video.title}
        >
          {video.title}
        </a>

        <div className="video-meta">
          <span className="upper-name">{video.upper.name}</span>
          <span className="separator">·</span>
          <span className="play-count">{formatPlayCount(video.cnt_info.play)}播放</span>
          <span className="separator">·</span>
          <span className="fav-time">{formatDate(video.fav_time)}</span>
        </div>

        {suggestions && suggestions.length > 0 && !isInvalid && (
          <div className="suggestion-badges">
            {suggestions.map((suggestion, index) => (
              <button
                key={`${suggestion.folderId}-${index}`}
                className="suggestion-badge"
                onClick={() => handleSuggestionClick(suggestion)}
                title={`${suggestion.folderName} (${Math.round(suggestion.confidence * 100)}% 置信度)`}
              >
                <span
                  className="confidence-bar"
                  style={{
                    width: `${suggestion.confidence * 100}%`,
                    backgroundColor: getConfidenceColor(suggestion.confidence),
                  }}
                />
                <span className="folder-name">{suggestion.folderName}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default VideoCard;
