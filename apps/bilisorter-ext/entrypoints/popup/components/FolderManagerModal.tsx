import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Folder } from '../../../lib/types';

// ─── Types ───

interface FolderManagerModalProps {
  isOpen: boolean;
  folders: Folder[];
  onFoldersReorder: (folders: Folder[]) => Promise<boolean>;
  onFolderRename: (folderId: number, newName: string) => Promise<boolean>;
  onClose: () => void;
}

// ─── Sortable Folder Chip ───

interface SortableChipProps {
  folder: Folder;
  isEditing: boolean;
  editValue: string;
  onEditStart: (folderId: number) => void;
  onEditChange: (value: string) => void;
  onEditSave: () => void;
  onEditCancel: () => void;
  isSaving: boolean;
}

const SortableChip: React.FC<SortableChipProps> = ({
  folder,
  isEditing,
  editValue,
  onEditStart,
  onEditChange,
  onEditSave,
  onEditCancel,
  isSaving,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: folder.id });

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onEditSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onEditCancel();
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`folder-chip ${isDragging ? 'dragging' : ''} ${isEditing ? 'editing' : ''}`}
    >
      {/* Drag handle */}
      <span className="chip-drag-handle" {...attributes} {...listeners}>
        ⠿
      </span>

      {/* Content */}
      {isEditing ? (
        <input
          ref={inputRef}
          className="chip-edit-input"
          value={editValue}
          onChange={(e) => onEditChange(e.target.value)}
          onBlur={onEditSave}
          onKeyDown={handleKeyDown}
          disabled={isSaving}
          maxLength={80}
        />
      ) : (
        <span className="chip-name" title={folder.name}>
          {folder.name}
        </span>
      )}

      {/* Count */}
      <span className="chip-count">{folder.media_count}</span>

      {/* Edit button (only when not editing) */}
      {!isEditing && (
        <button
          className="chip-edit-btn"
          onClick={(e) => {
            e.stopPropagation();
            onEditStart(folder.id);
          }}
          title="重命名"
        >
          ✏️
        </button>
      )}
    </div>
  );
};

// ─── Drag Overlay Chip (for the floating clone) ───

const DragOverlayChip: React.FC<{ folder: Folder }> = ({ folder }) => (
  <div className="folder-chip drag-overlay-chip">
    <span className="chip-drag-handle">⠿</span>
    <span className="chip-name">{folder.name}</span>
    <span className="chip-count">{folder.media_count}</span>
  </div>
);

// ─── Main Modal ───

const FolderManagerModal: React.FC<FolderManagerModalProps> = ({
  isOpen,
  folders,
  onFoldersReorder,
  onFolderRename,
  onClose,
}) => {
  const [localFolders, setLocalFolders] = useState<Folder[]>(folders);
  const [isLoading, setIsLoading] = useState(false);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Fetch fresh folder list from B站 API on open
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setIsLoading(true);
    setStatusMessage('正在加载最新收藏夹...');

    chrome.runtime.sendMessage({ type: 'FETCH_FOLDERS_FRESH' }).then((response) => {
      if (cancelled) return;
      if (response?.success && response.folders) {
        setLocalFolders(response.folders);
        setStatusMessage(null);
      } else {
        // Fallback to cached folders
        setLocalFolders(folders);
        setStatusMessage('⚠️ 加载失败，使用缓存数据');
      }
      setIsLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setLocalFolders(folders);
      setStatusMessage('⚠️ 加载失败，使用缓存数据');
      setIsLoading(false);
    });

    return () => { cancelled = true; };
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear status after 2s
  useEffect(() => {
    if (statusMessage) {
      const timer = setTimeout(() => setStatusMessage(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [statusMessage]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // 5px movement threshold to start drag
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Default folder is always the first one (B站 API invariant)
  const defaultFolder = localFolders.length > 0 ? localFolders[0] : null;
  const sortableFolders = localFolders.slice(1);

  const activeFolder = activeId
    ? sortableFolders.find((f) => f.id === activeId)
    : null;

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as number);
  }, []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveId(null);

      if (!over || active.id === over.id) return;

      const oldIndex = sortableFolders.findIndex((f) => f.id === active.id);
      const newIndex = sortableFolders.findIndex((f) => f.id === over.id);

      if (oldIndex === -1 || newIndex === -1) return;

      const newSortableOrder = arrayMove(sortableFolders, oldIndex, newIndex);
      // Reconstruct full list: default folder first, then sorted folders
      const fullList = defaultFolder
        ? [defaultFolder, ...newSortableOrder]
        : newSortableOrder;
      setLocalFolders(fullList);

      // Call parent — this triggers the API call
      setStatusMessage('正在保存排序...');
      try {
        const success = await onFoldersReorder(fullList);
        if (success) {
          setStatusMessage('✅ 排序已保存');
        } else {
          setLocalFolders(localFolders);
          setStatusMessage('❌ 排序保存失败');
        }
      } catch {
        // Revert on error
        setLocalFolders(localFolders);
        setStatusMessage('❌ 排序保存失败');
      }
    },
    [localFolders, sortableFolders, defaultFolder, onFoldersReorder]
  );

  const handleEditStart = useCallback((folderId: number) => {
    const folder = localFolders.find((f) => f.id === folderId);
    if (!folder || folder.id === localFolders[0]?.id) return; // Cannot rename default folder
    setEditingId(folderId);
    setEditValue(folder.name);
  }, [localFolders]);

  const handleEditSave = useCallback(async () => {
    if (!editingId || isSaving) return;

    const trimmed = editValue.trim();
    const originalFolder = localFolders.find((f) => f.id === editingId);
    if (!originalFolder) {
      setEditingId(null);
      return;
    }

    // No change — just close
    if (trimmed === originalFolder.name || !trimmed) {
      setEditingId(null);
      return;
    }

    setIsSaving(true);
    setStatusMessage('正在重命名...');

    try {
      const success = await onFolderRename(editingId, trimmed);
      if (success) {
        // Update local state
        setLocalFolders((prev) =>
          prev.map((f) => (f.id === editingId ? { ...f, name: trimmed } : f))
        );
        setStatusMessage('✅ 重命名成功');
      } else {
        setStatusMessage('❌ 重命名失败');
      }
    } catch {
      setStatusMessage('❌ 重命名失败');
    } finally {
      setIsSaving(false);
      setEditingId(null);
    }
  }, [editingId, editValue, isSaving, localFolders, onFolderRename]);

  const handleEditCancel = useCallback(() => {
    setEditingId(null);
    setEditValue('');
  }, []);

  // ─── One-click sort helpers ───

  const applySort = useCallback(async (sorted: Folder[]) => {
    const fullList = defaultFolder ? [defaultFolder, ...sorted] : sorted;
    setLocalFolders(fullList);
    setStatusMessage('正在保存排序...');
    try {
      const success = await onFoldersReorder(fullList);
      if (success) {
        setStatusMessage('✅ 排序已保存');
      } else {
        setStatusMessage('❌ 排序保存失败');
      }
    } catch {
      setStatusMessage('❌ 排序保存失败');
    }
  }, [defaultFolder, onFoldersReorder]);

  const handleSortByName = useCallback(() => {
    const sorted = [...sortableFolders].sort((a, b) =>
      a.name.localeCompare(b.name, 'zh-CN')
    );
    applySort(sorted);
  }, [sortableFolders, applySort]);

  const handleSortByCount = useCallback(() => {
    const sorted = [...sortableFolders].sort((a, b) =>
      b.media_count - a.media_count
    );
    applySort(sorted);
  }, [sortableFolders, applySort]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content folder-manager-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>📁 收藏夹管理</h3>
          <button className="close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal-body folder-manager-body">
          {isLoading ? (
            <div className="empty-log">
              <p>⏳ 正在加载收藏夹列表...</p>
            </div>
          ) : localFolders.length === 0 ? (
            <div className="empty-log">
              <p>没有收藏夹，请先索引</p>
            </div>
          ) : (
            <>
              {/* Sortable folders (default folder rendered inline but not draggable) */}
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={sortableFolders.map((f) => f.id)}
                  strategy={rectSortingStrategy}
                >
                  <div className="folder-chip-grid">
                    {/* Default folder — same style, just no drag handle */}
                    {defaultFolder && (
                      <div className="folder-chip">
                        <span className="chip-handle-spacer" />
                        <span className="chip-name" title={defaultFolder.name}>
                          {defaultFolder.name}
                        </span>
                        <span className="chip-count">{defaultFolder.media_count}</span>
                      </div>
                    )}
                    {sortableFolders.map((folder) => (
                      <SortableChip
                        key={folder.id}
                        folder={folder}
                        isEditing={editingId === folder.id}
                        editValue={editingId === folder.id ? editValue : ''}
                        onEditStart={handleEditStart}
                        onEditChange={setEditValue}
                        onEditSave={handleEditSave}
                        onEditCancel={handleEditCancel}
                        isSaving={isSaving && editingId === folder.id}
                      />
                    ))}
                  </div>
                </SortableContext>

                <DragOverlay>
                  {activeFolder ? (
                    <DragOverlayChip folder={activeFolder} />
                  ) : null}
                </DragOverlay>
              </DndContext>
            </>
          )}
        </div>

        <div className="folder-manager-footer">
          <div className="folder-manager-actions">
            <button
              className="folder-sort-btn"
              onClick={handleSortByName}
              disabled={isLoading || sortableFolders.length === 0}
              title="按名称 A→Z 排序"
            >
              🔤 按名称排序
            </button>
            <button
              className="folder-sort-btn"
              onClick={handleSortByCount}
              disabled={isLoading || sortableFolders.length === 0}
              title="按视频数量降序排序"
            >
              📊 按数量排序
            </button>
          </div>
          {statusMessage && (
            <span className="folder-manager-status">{statusMessage}</span>
          )}
          <span className="folder-manager-hint">
            拖拽排序 · 点击 ✏️ 重命名 · 创建/删除请前往
            <a
              href="https://space.bilibili.com"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#00a1d6', marginLeft: 4 }}
            >
              B站
            </a>
          </span>
        </div>
      </div>
    </div>
  );
};

export default FolderManagerModal;
