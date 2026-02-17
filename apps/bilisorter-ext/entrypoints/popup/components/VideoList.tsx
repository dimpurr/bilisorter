import React from 'react';
import VideoCard from './VideoCard';
import type { Video, Suggestion } from '../../../lib/types';

interface VideoListProps {
  videos: Video[];
  suggestions: Record<string, Suggestion[]>;
  onSuggestionClick?: (video: Video, suggestion: Suggestion) => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  totalVideoCount?: number;
  onLoadMore?: () => void;
}

const VideoList: React.FC<VideoListProps> = ({
  videos,
  suggestions,
  onSuggestionClick,
  hasMore = false,
  isLoadingMore = false,
  totalVideoCount,
  onLoadMore,
}) => {
  if (videos.length === 0) {
    return null;
  }

  return (
    <div className="video-list">
      {videos.map((video) => (
        <VideoCard
          key={video.bvid}
          video={video}
          suggestions={suggestions[video.bvid] || []}
          onSuggestionClick={(suggestion) =>
            onSuggestionClick?.(video, suggestion)
          }
        />
      ))}
      {hasMore && (
        <div className="load-more-container">
          <button
            className="btn btn-secondary load-more-btn"
            onClick={onLoadMore}
            disabled={isLoadingMore}
          >
            {isLoadingMore
              ? '⏳ 加载中...'
              : `加载更多 (已加载 ${videos.length}/${totalVideoCount || '?'})`}
          </button>
        </div>
      )}
    </div>
  );
};

export default VideoList;
