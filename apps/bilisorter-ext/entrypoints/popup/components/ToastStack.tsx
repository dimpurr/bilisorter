import React, { useState, useEffect, useCallback } from 'react';

interface Toast {
  id: string;
  videoTitle: string;
  folderName: string;
  timeLeft: number;
  totalTime: number;
  onUndo: () => void;
  onComplete: () => void;
}

interface ToastStackProps {
  toasts: Toast[];
  onRemove: (id: string) => void;
}

const ToastItem: React.FC<{
  toast: Toast;
  onRemove: (id: string) => void;
}> = ({ toast, onRemove }) => {
  const [timeLeft, setTimeLeft] = useState(toast.timeLeft);

  useEffect(() => {
    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        const newTime = prev - 100;
        if (newTime <= 0) {
          clearInterval(interval);
          toast.onComplete();
          onRemove(toast.id);
          return 0;
        }
        return newTime;
      });
    }, 100);

    return () => clearInterval(interval);
  }, [toast, onRemove]);

  const handleUndo = () => {
    toast.onUndo();
    onRemove(toast.id);
  };

  const progress = (timeLeft / toast.totalTime) * 100;
  const truncatedTitle =
    toast.videoTitle.length > 12
      ? toast.videoTitle.slice(0, 12) + '...'
      : toast.videoTitle;

  return (
    <div className="toast-item">
      <div className="toast-content">
        <span className="toast-message">
          已移动《{truncatedTitle}》→ [{toast.folderName}]
        </span>
        <button className="toast-undo" onClick={handleUndo}>
          撤销
        </button>
      </div>
      <div className="toast-progress-bar">
        <div
          className="toast-progress-fill"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
};

const ToastStack: React.FC<ToastStackProps> = ({ toasts, onRemove }) => {
  if (toasts.length === 0) return null;

  // Only show max 5 toasts
  const visibleToasts = toasts.slice(-5);

  return (
    <div className="toast-stack">
      {visibleToasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onRemove={onRemove} />
      ))}
    </div>
  );
};

export default ToastStack;
export type { Toast };
