import React from 'react';
import VideoCard from './VideoCard';
import type { Video, Suggestion } from '../../../lib/types';

interface VideoListProps {
  videos: Video[];
  suggestions: Record<string, Suggestion[]>;
  onSuggestionClick?: (video: Video, suggestion: Suggestion) => void;
}

const VideoList: React.FC<VideoListProps> = ({
  videos,
  suggestions,
  onSuggestionClick,
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
          suggestions={suggestions[video.bvid]}
          onSuggestionClick={(suggestion) =>
            onSuggestionClick?.(video, suggestion)
          }
        />
      ))}
    </div>
  );
};

export default VideoList;
