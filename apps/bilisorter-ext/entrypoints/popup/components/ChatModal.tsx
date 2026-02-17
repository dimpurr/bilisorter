import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { Folder, Settings, ChatMessage } from '../../../lib/types';
import { STORAGE_KEYS } from '../../../lib/constants';
import { chatWithAI } from '../../../lib/aiApi';

// ─── Types ───

interface ChatModalProps {
  isOpen: boolean;
  folders: Folder[];
  settings: Settings;
  onClose: () => void;
}

// ─── Quick Action Presets ───

const QUICK_ACTIONS = [
  {
    emoji: '📊',
    label: '收藏夹调整建议',
    prompt: '分析我的收藏夹结构，指出哪些收藏夹太大需要拆分、哪些太小可以合并、哪些内容重叠可以整合。给出具体的调整方案和理由。',
  },
  {
    emoji: '❤️',
    label: '分析收藏偏好',
    prompt: '根据我的收藏夹名称和内容样本，分析我的内容兴趣偏好和收藏习惯。我主要关注哪些领域？有什么收藏模式？',
  },
  {
    emoji: '🔀',
    label: '合并建议',
    prompt: '哪些收藏夹内容高度相似可以合并？给出具体的合并方案，说明合并后的新名称和理由。',
  },
  {
    emoji: '📐',
    label: '命名优化',
    prompt: '审视所有收藏夹的命名，建议更清晰、一致的命名方案。指出哪些命名含糊、哪些风格不统一，给出改名建议。',
  },
];

// ─── Build System Prompt with Folder Context ───

function buildChatSystemPrompt(folders: Folder[]): string {
  const totalVideos = folders.reduce((sum, f) => sum + f.media_count, 0);
  const counts = folders.map(f => f.media_count);
  const avgCount = folders.length > 0 ? Math.round(totalVideos / folders.length) : 0;
  const maxCount = Math.max(...counts, 0);
  const minCount = Math.min(...counts, 0);

  const folderList = folders.map((f, idx) => {
    const samples = f.sampleTitles.length > 0
      ? `\n    示例视频: ${f.sampleTitles.join(', ')}`
      : '';
    return `  ${idx + 1}. 「${f.name}」(ID: ${f.id}, ${f.media_count}个视频)${samples}`;
  }).join('\n');

  return `你是一位专业的 Bilibili 收藏夹顾问。用户希望你分析他们的收藏夹结构并提供整理建议。

## 用户收藏夹概况

- 总收藏夹数: ${folders.length}
- 总视频数: ${totalVideos}
- 平均每个收藏夹: ${avgCount} 个视频
- 最大收藏夹: ${maxCount} 个视频
- 最小收藏夹: ${minCount} 个视频

## 完整收藏夹列表 (按当前顺序)

${folderList}

## 你的角色

- 基于收藏夹名称、视频数量和示例视频内容，给出具体、可操作的建议
- 建议应包括：合并相似收藏夹、拆分过大收藏夹、重命名不清晰的收藏夹、调整收藏夹顺序
- 回答使用中文，语气友好专业
- 给出建议时要说明具体的收藏夹名称和理由
- 如果用户问的问题与收藏夹无关，也可以友好地回答，但适时引导回收藏夹整理话题`;
}

// ─── Chat Modal Component ───

const ChatModal: React.FC<ChatModalProps> = ({
  isOpen,
  folders,
  settings,
  onClose,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // Load chat history from storage on mount
  useEffect(() => {
    if (!isOpen) return;
    chrome.storage.local.get(STORAGE_KEYS.CHAT_HISTORY, (result: Record<string, unknown>) => {
      const saved = result[STORAGE_KEYS.CHAT_HISTORY];
      if (Array.isArray(saved) && saved.length > 0) {
        setMessages(saved);
      }
    });
  }, [isOpen]);

  // Save messages to storage whenever they change
  useEffect(() => {
    if (messages.length > 0) {
      chrome.storage.local.set({ [STORAGE_KEYS.CHAT_HISTORY]: messages });
    }
  }, [messages]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Focus input on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [isOpen]);

  // ─── Send Message ───

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      role: 'user',
      content: text.trim(),
      timestamp: Date.now(),
    };

    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInputValue('');
    setIsLoading(true);

    try {
      const systemPrompt = buildChatSystemPrompt(folders);
      const response = await chatWithAI(updatedMessages, systemPrompt, settings);

      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: response,
        timestamp: Date.now(),
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      const errorMessage: ChatMessage = {
        role: 'assistant',
        content: `⚠️ 请求失败: ${error instanceof Error ? error.message : '未知错误'}`,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  }, [messages, isLoading, folders, settings]);

  // ─── Handle Input ───

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(inputValue);
    }
  };

  const handleQuickAction = (prompt: string) => {
    sendMessage(prompt);
  };

  // ─── Clear Chat ───

  const handleClearChat = () => {
    setMessages([]);
    chrome.storage.local.remove(STORAGE_KEYS.CHAT_HISTORY);
  };

  // ─── Format Time ───

  const formatTime = (timestamp: number): string => {
    const d = new Date(timestamp);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  if (!isOpen) return null;

  const hasApiKey = settings.provider === 'gemini' ? !!settings.geminiApiKey : !!settings.apiKey;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content chat-modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <h3>💬 收藏夹顾问</h3>
          <div className="chat-header-actions">
            {messages.length > 0 && (
              <button
                className="btn btn-secondary btn-small"
                onClick={handleClearChat}
                title="清空聊天记录"
              >
                🗑 清空
              </button>
            )}
            <button className="modal-close" onClick={onClose}>✕</button>
          </div>
        </div>

        {/* Messages Area */}
        <div className="chat-messages" ref={messagesContainerRef}>
          {messages.length === 0 && !isLoading && (
            <div className="chat-welcome">
              <div className="chat-welcome-icon">🤖</div>
              <div className="chat-welcome-title">收藏夹 AI 顾问</div>
              <div className="chat-welcome-desc">
                我可以分析你的 {folders.length} 个收藏夹，提供整理建议。
                <br />点击下方快捷按钮或直接输入你的问题。
              </div>
            </div>
          )}

          {messages.map((msg, idx) => (
            <div key={idx} className={`chat-bubble-wrapper ${msg.role}`}>
              <div className={`chat-bubble ${msg.role}`}>
                <div className="chat-bubble-content">
                  {msg.content.split('\n').map((line, i) => (
                    <React.Fragment key={i}>
                      {line}
                      {i < msg.content.split('\n').length - 1 && <br />}
                    </React.Fragment>
                  ))}
                </div>
                <div className="chat-bubble-time">{formatTime(msg.timestamp)}</div>
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="chat-bubble-wrapper assistant">
              <div className="chat-bubble assistant">
                <div className="chat-typing">
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Quick Actions */}
        {messages.length === 0 && (
          <div className="chat-quick-actions">
            {QUICK_ACTIONS.map((action, idx) => (
              <button
                key={idx}
                className="chat-quick-btn"
                onClick={() => handleQuickAction(action.prompt)}
                disabled={isLoading || !hasApiKey}
              >
                <span className="chat-quick-emoji">{action.emoji}</span>
                <span className="chat-quick-label">{action.label}</span>
              </button>
            ))}
          </div>
        )}

        {/* Input Area */}
        <div className="chat-input-bar">
          {!hasApiKey ? (
            <div className="chat-no-key">
              ⚠️ 请先在设置中配置 {settings.provider === 'gemini' ? 'Gemini' : 'Claude'} API Key
            </div>
          ) : (
            <>
              <textarea
                ref={inputRef}
                className="chat-input"
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入你的问题... (Enter 发送, Shift+Enter 换行)"
                rows={1}
                disabled={isLoading}
              />
              <button
                className="chat-send-btn"
                onClick={() => sendMessage(inputValue)}
                disabled={isLoading || !inputValue.trim()}
                title="发送"
              >
                ▶
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChatModal;
