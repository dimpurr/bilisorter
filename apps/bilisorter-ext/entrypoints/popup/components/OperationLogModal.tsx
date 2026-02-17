import React from 'react';
import type { LogEntry } from '../../../lib/types';

interface OperationLogModalProps {
  isOpen: boolean;
  log: LogEntry[];
  onClose: () => void;
}

const formatDate = (dateStr: string): string => {
  const date = new Date(dateStr);
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const OperationLogModal: React.FC<OperationLogModalProps> = ({
  isOpen,
  log,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>📋 操作日志</h3>
          <button className="close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          {log.length === 0 ? (
            <div className="empty-log">
              <p>暂无操作记录</p>
            </div>
          ) : (
            <ul className="log-list">
              {log.map((entry, index) => (
                <li key={index} className="log-entry">
                  <span className="log-time">{formatDate(entry.timestamp)}</span>
                  <span className="log-action">
                    《{entry.videoTitle}》→ [{entry.toFolderName}]
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export default OperationLogModal;
