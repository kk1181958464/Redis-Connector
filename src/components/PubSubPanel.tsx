import { useState, useCallback, useRef, useEffect } from 'react';
import { Radio, Send, Trash2, RefreshCw, Play, Square } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import './PubSubPanel.css';

interface PubSubMessage {
  id: number;
  channel: string;
  message: string;
  timestamp: Date;
  type: 'received' | 'sent';
}

interface PubSubPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onExecute: (command: string) => Promise<any>;
}

function PubSubPanel({ isOpen, onClose, onExecute }: PubSubPanelProps) {
  const [channels, setChannels] = useState<string[]>([]);
  const [messages, setMessages] = useState<PubSubMessage[]>([]);
  const [subscribeChannel, setSubscribeChannel] = useState('');
  const [publishChannel, setPublishChannel] = useState('');
  const [publishMessage, setPublishMessage] = useState('');
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [subscribedChannels, setSubscribedChannels] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const messageIdRef = useRef(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const { settings } = useSettings();

  // 加载活跃频道
  const loadChannels = useCallback(async () => {
    setLoading(true);
    try {
      const result = await onExecute('PUBSUB CHANNELS *');
      if (result?.success && Array.isArray(result.data)) {
        setChannels(result.data);
      }
    } finally {
      setLoading(false);
    }
  }, [onExecute]);

  // 发布消息
  const handlePublish = useCallback(async () => {
    if (!publishChannel.trim() || !publishMessage.trim()) return;

    const channel = publishChannel.trim();
    const message = publishMessage.trim();

    const result = await onExecute(`PUBLISH "${channel}" "${message.replace(/"/g, '\\"')}"`);

    if (result?.success) {
      setMessages(prev => [...prev, {
        id: ++messageIdRef.current,
        channel,
        message,
        timestamp: new Date(),
        type: 'sent',
      }]);
      setPublishMessage('');
    }
  }, [publishChannel, publishMessage, onExecute]);

  // 模拟订阅（通过轮询 PUBSUB NUMSUB 检查）
  const startSubscription = useCallback(() => {
    if (!subscribeChannel.trim()) return;

    const channel = subscribeChannel.trim();
    setSubscribedChannels(prev => new Set(prev).add(channel));
    setIsSubscribing(true);

    // 注意：真正的订阅需要独立连接，这里只是模拟
    // 实际生产环境需要在主进程创建专用订阅连接
  }, [subscribeChannel]);

  const stopSubscription = useCallback(() => {
    setIsSubscribing(false);
    setSubscribedChannels(new Set());
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  // 清空消息
  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 打开时加载频道
  useEffect(() => {
    if (isOpen) {
      loadChannels();
    }
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [isOpen, loadChannels]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="pubsub-panel" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2><Radio size={18} /> Pub/Sub</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="pubsub-content">
          {/* 左侧：频道列表 */}
          <div className="pubsub-sidebar">
            <div className="sidebar-header">
              <h3>{settings.language === 'zh-CN' ? '活跃频道' : 'Active Channels'}</h3>
              <button className="refresh-btn" onClick={loadChannels} disabled={loading}>
                <RefreshCw size={14} className={loading ? 'spin' : ''} />
              </button>
            </div>
            <div className="channel-list">
              {channels.length === 0 ? (
                <div className="empty-channels">
                  {settings.language === 'zh-CN' ? '暂无活跃频道' : 'No active channels'}
                </div>
              ) : (
                channels.map((channel, i) => (
                  <div
                    key={i}
                    className={`channel-item ${subscribedChannels.has(channel) ? 'subscribed' : ''}`}
                    onClick={() => {
                      setSubscribeChannel(channel);
                      setPublishChannel(channel);
                    }}
                  >
                    <Radio size={12} />
                    <span>{channel}</span>
                  </div>
                ))
              )}
            </div>

            {/* 订阅控制 */}
            <div className="subscribe-section">
              <h3>{settings.language === 'zh-CN' ? '订阅频道' : 'Subscribe'}</h3>
              <div className="subscribe-input">
                <input
                  type="text"
                  value={subscribeChannel}
                  onChange={e => setSubscribeChannel(e.target.value)}
                  placeholder={settings.language === 'zh-CN' ? '频道名称' : 'Channel name'}
                />
                {isSubscribing ? (
                  <button className="stop-btn" onClick={stopSubscription}>
                    <Square size={14} />
                  </button>
                ) : (
                  <button className="start-btn" onClick={startSubscription} disabled={!subscribeChannel.trim()}>
                    <Play size={14} />
                  </button>
                )}
              </div>
              {subscribedChannels.size > 0 && (
                <div className="subscribed-list">
                  {Array.from(subscribedChannels).map((ch, i) => (
                    <span key={i} className="subscribed-tag">{ch}</span>
                  ))}
                </div>
              )}
              <p className="subscribe-note">
                {settings.language === 'zh-CN'
                  ? '注意：完整订阅功能需要独立连接，当前仅支持发布消息'
                  : 'Note: Full subscription requires a dedicated connection. Currently only publishing is supported.'}
              </p>
            </div>
          </div>

          {/* 右侧：消息区域 */}
          <div className="pubsub-main">
            {/* 消息列表 */}
            <div className="messages-header">
              <h3>{settings.language === 'zh-CN' ? '消息' : 'Messages'}</h3>
              <button className="clear-btn" onClick={clearMessages} disabled={messages.length === 0}>
                <Trash2 size={14} />
              </button>
            </div>
            <div className="messages-list">
              {messages.length === 0 ? (
                <div className="empty-messages">
                  {settings.language === 'zh-CN' ? '暂无消息' : 'No messages'}
                </div>
              ) : (
                messages.map(msg => (
                  <div key={msg.id} className={`message-item ${msg.type}`}>
                    <div className="message-header">
                      <span className="message-channel">{msg.channel}</span>
                      <span className="message-time">
                        {msg.timestamp.toLocaleTimeString()}
                      </span>
                      <span className={`message-type ${msg.type}`}>
                        {msg.type === 'sent'
                          ? (settings.language === 'zh-CN' ? '已发送' : 'Sent')
                          : (settings.language === 'zh-CN' ? '已接收' : 'Received')}
                      </span>
                    </div>
                    <div className="message-body">{msg.message}</div>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* 发布消息 */}
            <div className="publish-section">
              <div className="publish-row">
                <input
                  type="text"
                  value={publishChannel}
                  onChange={e => setPublishChannel(e.target.value)}
                  placeholder={settings.language === 'zh-CN' ? '频道' : 'Channel'}
                  className="publish-channel"
                />
                <input
                  type="text"
                  value={publishMessage}
                  onChange={e => setPublishMessage(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handlePublish()}
                  placeholder={settings.language === 'zh-CN' ? '消息内容' : 'Message'}
                  className="publish-message"
                />
                <button
                  className="publish-btn"
                  onClick={handlePublish}
                  disabled={!publishChannel.trim() || !publishMessage.trim()}
                >
                  <Send size={14} />
                  {settings.language === 'zh-CN' ? '发布' : 'Publish'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PubSubPanel;
