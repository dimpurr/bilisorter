import React from 'react';

type EmptyStateType =
  | 'not_logged_in'
  | 'folders_not_indexed'
  | 'source_not_loaded'
  | 'source_empty';

interface EmptyStateProps {
  type: EmptyStateType;
  onAction?: () => void;
}

const EmptyState: React.FC<EmptyStateProps> = ({ type, onAction }) => {
  const renderContent = () => {
    switch (type) {
      case 'not_logged_in':
        return (
          <div className="empty-state not-logged-in">
            <div className="empty-icon">🔒</div>
            <h3>请先登录 bilibili.com</h3>
            <p>需要在B站登录后才能使用此扩展</p>
            <a
              href="https://www.bilibili.com"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary"
            >
              前往登录
            </a>
          </div>
        );

      case 'folders_not_indexed':
        return (
          <div className="empty-state no-cache">
            <div className="empty-icon">📂</div>
            <h3>开始整理收藏夹</h3>
            <p>先索引收藏夹列表，然后加载源视频并生成 AI 分类建议</p>
            <button className="btn btn-primary" onClick={onAction}>
              📂 索引收藏夹
            </button>
          </div>
        );

      case 'source_not_loaded':
        return (
          <div className="empty-state source-empty">
            <div className="empty-icon">📺</div>
            <h3>选择源并加载视频</h3>
            <p>在上方选择源收藏夹，然后点击"加载视频"获取前 60 个视频</p>
            {onAction && (
              <button className="btn btn-primary" onClick={onAction}>
                📥 加载视频
              </button>
            )}
          </div>
        );

      case 'source_empty':
        return (
          <div className="empty-state">
            <div className="empty-icon">📭</div>
            <h3>该收藏夹为空</h3>
            <p>当前选择的源收藏夹没有视频</p>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="empty-state-container">
      {renderContent()}
    </div>
  );
};

export default EmptyState;
