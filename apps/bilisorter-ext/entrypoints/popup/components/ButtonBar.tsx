import React from 'react';

interface ButtonBarProps {
  onIndex: () => void;
  onSuggest: () => void;
  onExport: () => void;
  onLog: () => void;
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
        title="索引收藏夹"
      >
        📥 索引
      </button>
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
