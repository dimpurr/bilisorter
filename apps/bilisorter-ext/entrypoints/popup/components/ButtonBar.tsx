import React from 'react';

interface ButtonBarProps {
  onIndex: () => void;
  onSuggest: () => void;
  onExport: () => void;
  onLog: () => void;
  onForceReindex?: () => void;
  indexButtonLabel: string;
  canIndex: boolean;
  canSuggest: boolean;
  canExport: boolean;
  hasIndexedData: boolean;
}

const ButtonBar: React.FC<ButtonBarProps> = ({
  onIndex,
  onSuggest,
  onExport,
  onLog,
  onForceReindex,
  indexButtonLabel,
  canIndex,
  canSuggest,
  canExport,
  hasIndexedData,
}) => {
  return (
    <div className="button-bar">
      <button
        className="btn btn-primary"
        onClick={onIndex}
        disabled={!canIndex}
        title="索引收藏夹 (从断点续传)"
      >
        {indexButtonLabel}
      </button>
      {hasIndexedData && onForceReindex && (
        <button
          className="btn btn-secondary btn-small"
          onClick={onForceReindex}
          disabled={!canIndex}
          title="清除缓存并重新索引"
        >
          🗑
        </button>
      )}
      <button
        className="btn btn-primary"
        onClick={onSuggest}
        disabled={!canSuggest}
        title="生成AI分类建议"
      >
        ✨ 建议
      </button>
      <button
        className="btn btn-secondary"
        onClick={onExport}
        disabled={!canExport}
        title="导出JSON"
      >
        📤 导出
      </button>
      <button
        className="btn btn-secondary"
        onClick={onLog}
        title="操作日志"
      >
        📋 日志
      </button>
    </div>
  );
};

export default ButtonBar;
