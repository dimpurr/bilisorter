import React from 'react';

type EmptyStateType =
  | 'not_logged_in'
  | 'no_cache_no_key'
  | 'no_cache_with_key'
  | 'empty_folder'
  | 'all_invalid'
  | 'only_one_folder'
  | 'ai_all_failed'
  | 'ai_partial_failed';

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

      case 'no_cache_no_key':
        return (
          <div className="empty-state no-cache">
            <div className="empty-icon">📥</div>
            <h3>开始整理收藏夹</h3>
            <p>点击"索引"按钮获取收藏夹数据</p>
            <p className="hint">💡 提示: 请在 ⚙️ 设置中配置 Claude API Key 以使用AI分类功能</p>
            <button className="btn btn-primary" onClick={onAction}>
              📥 索引收藏夹
            </button>
          </div>
        );

      case 'no_cache_with_key':
        return (
          <div className="empty-state no-cache">
            <div className="empty-icon">📥</div>
            <h3>开始整理收藏夹</h3>
            <p>点击"索引"按钮获取收藏夹数据，然后使用AI生成分类建议</p>
            <button className="btn btn-primary" onClick={onAction}>
              📥 索引收藏夹
            </button>
          </div>
        );

      case 'empty_folder':
        return (
          <div className="empty-state">
            <div className="empty-icon">📂</div>
            <h3>该收藏夹为空</h3>
            <p>当前选择的收藏夹没有视频</p>
          </div>
        );

      case 'all_invalid':
        return (
          <div className="empty-state">
            <div className="empty-icon">⚠️</div>
            <h3>没有有效视频可分析</h3>
            <p>当前收藏夹中的视频全部已失效</p>
          </div>
        );

      case 'only_one_folder':
        return (
          <div className="empty-state">
            <div className="empty-icon">📁</div>
            <h3>没有目标收藏夹</h3>
            <p>请先在 B站 创建收藏夹，才能使用AI分类功能</p>
            <a
              href="https://space.bilibili.com/favlist"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary"
            >
              管理收藏夹
            </a>
          </div>
        );

      case 'ai_all_failed':
        return (
          <div className="empty-state">
            <div className="empty-icon">❌</div>
            <h3>AI 分析失败</h3>
            <p>无法获取分类建议，请检查API Key或稍后重试</p>
          </div>
        );

      case 'ai_partial_failed':
        return (
          <div className="empty-state">
            <div className="empty-icon">⚡</div>
            <h3>部分视频分析失败</h3>
            <p>已跳过部分视频，请检查网络连接或稍后重试</p>
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
