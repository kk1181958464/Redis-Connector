import { useState, useCallback, useRef, useEffect } from 'react';
import { Radio, Send, Trash2, RefreshCw, Play, Square, X } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import { useToast } from './Toast';
import Modal from './Modal';
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
  connectionId: string;
}

function PubSubPanel({ isOpen, onClose, onExecute, connectionId }: PubSubPanelProps) {
  const [channels, setChannels] = useState<string[]>([]);
  const [messages, setMessages] = useState<PubSubMessage[]>([]);
  const [subscribeChannel, setSubscribeChannel] = useState('');
  const [publishChannel, setPublishChannel] = useState('');
  const [publishMessage, setPublishMessage] = useState('');
  const [subscribedChannels, setSubscribedChannels] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const messageIdRef = useRef(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { settings } = useSettings();
  const { showToast } = useToast();

  // 加载活跃频道
  const loadChannels = useCallback(async () => {
    if (!connectionId) return;
    setLoading(true);
    try {
      const result = await onExecute('PUBSUB CHANNELS *');
      if (result?.success && Array.isArray(result.data)) {
        setChannels(result.data);
      }
    } catch (error) {
      console.error('Failed to load channels:', error);
    } finally {
      setLoading(false);
    }
  }, [onExecute, connectionId]);

  // 订阅频道
  const handleSubscribe = useCallback(async () => {
    if (!subscribeChannel.trim() || subscribing) return;

    const channel = subscribeChannel.trim();
    if (subscribedChannels.has(channel)) {
      showToast(
        settings.language === 'zh-CN' ? '已订阅该频道' : 'Already subscribed',
        'warning'
      );
      return;
    }

    setSubscribing(true);
    try {
      const result = await (window as any).electronAPI?.redis.subscribe(connectionId, [channel]);
      if (result?.success) {
        setSubscribedChannels(new Set(result.channels));
        setSubscribeChannel('');
        showToast(
          settings.language === 'zh-CN' ? `已订阅: ${channel}` : `Subscribed: ${channel}`,
          'success'
        );
      } else {
        showToast(result?.error || 'Subscribe failed', 'error');
      }
    } catch (error) {
      console.error('Subscribe failed:', error);
      showToast(
        settings.language === 'zh-CN' ? '订阅失败' : 'Subscribe failed',
        'error'
      );
    } finally {
      setSubscribing(false);
    }
  }, [subscribeChannel, subscribing, subscribedChannels, connectionId, showToast, settings.language]);

  // 取消订阅单个频道
  const handleUnsubscribe = useCallback(async (channel: string) => {
    try {
      const result = await (window as any).electronAPI?.redis.unsubscribe(connectionId, [channel]);
      if (result?.success) {
        setSubscribedChannels(new Set(result.channels));
        showToast(
          settings.language === 'zh-CN' ? `已取消订阅: ${channel}` : `Unsubscribed: ${channel}`,
          'success'
        );
      }
    } catch (error) {
      console.error('Unsubscribe failed:', error);
      showToast(
        settings.language === 'zh-CN' ? '取消订阅失败' : 'Unsubscribe failed',
        'error'
      );
    }
  }, [connectionId, showToast, settings.language]);

  // 取消所有订阅
  const handleUnsubscribeAll = useCallback(async () => {
    try {
      await (window as any).electronAPI?.redis.unsubscribeAll(connectionId);
      setSubscribedChannels(new Set());
      showToast(
        settings.language === 'zh-CN' ? '已取消所有订阅' : 'Unsubscribed all',
        'success'
      );
    } catch (error) {
      console.error('Unsubscribe all failed:', error);
      showToast(
        settings.language === 'zh-CN' ? '取消订阅失败' : 'Unsubscribe failed',
        'error'
      );
    }
  }, [connectionId, showToast, settings.language]);

  // 发布消息
  const handlePublish = useCallback(async () => {
    if (!publishChannel.trim() || !publishMessage.trim()) return;

    const channel = publishChannel.trim();
    const message = publishMessage.trim();

    try {
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
    } catch (error) {
      console.error('Publish failed:', error);
    }
  }, [publishChannel, publishMessage, onExecute]);

  // 清空消息
  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  // 监听订阅消息
  useEffect(() => {
    if (!isOpen) return;

    const unsubscribe = (window as any).electronAPI?.on(
      'redis:pubsub-message',
      (connId: string, data: { channel: string; message: string; timestamp: number }) => {
        if (connId === connectionId) {
          setMessages(prev => [...prev, {
            id: ++messageIdRef.current,
            channel: data.channel,
            message: data.message,
            timestamp: new Date(data.timestamp),
            type: 'received',
          }]);
        }
      }
    );

    return () => unsubscribe?.();
  }, [isOpen, connectionId]);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 打开时加载频道和已订阅列表
  useEffect(() => {
    if (isOpen && connectionId) {
      loadChannels();
      // 加载已订阅的频道
      (window as any).electronAPI?.redis.getSubscriptions(connectionId)
        .then((result: any) => {
          if (result?.success && result.channels) {
            setSubscribedChannels(new Set(result.channels));
          }
        })
        .catch((error: any) => {
          console.error('Failed to get subscriptions:', error);
        });
    }
  }, [isOpen, loadChannels, connectionId]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={<><Radio size={18} /> Pub/Sub</>}
      width={800}
      height={600}
      minWidth={500}
      minHeight={400}
      className="pubsub-modal"
      storageKey="pubsub-panel"
    >
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
                  {subscribedChannels.has(channel) && (
                    <span className="subscribed-badge">
                      {settings.language === 'zh-CN' ? '已订阅' : 'Subscribed'}
                    </span>
                  )}
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
                onKeyDown={e => e.key === 'Enter' && handleSubscribe()}
                placeholder={settings.language === 'zh-CN' ? '频道名称' : 'Channel name'}
              />
              <button
                className="start-btn"
                onClick={handleSubscribe}
                disabled={!subscribeChannel.trim() || subscribing}
                title={settings.language === 'zh-CN' ? '订阅频道' : 'Subscribe to channel'}
              >
                {subscribing ? <RefreshCw size={14} className="spin" /> : <Play size={14} />}
              </button>
            </div>
            {subscribedChannels.size > 0 && (
              <div className="subscribed-list">
                <div className="subscribed-header">
                  <span>{settings.language === 'zh-CN' ? '已订阅:' : 'Subscribed:'}</span>
                  <button
                    className="unsubscribe-all-btn"
                    onClick={handleUnsubscribeAll}
                    title={settings.language === 'zh-CN' ? '取消所有订阅' : 'Unsubscribe all'}
                  >
                    <Square size={12} />
                    {settings.language === 'zh-CN' ? '全部取消' : 'Stop All'}
                  </button>
                </div>
                <div className="subscribed-tags">
                  {Array.from(subscribedChannels).map((ch, i) => (
                    <span key={i} className="subscribed-tag">
                      {ch}
                      <button
                        className="remove-tag-btn"
                        onClick={() => handleUnsubscribe(ch)}
                        title={settings.language === 'zh-CN' ? '取消订阅' : 'Unsubscribe'}
                      >
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 右侧：消息区域 */}
        <div className="pubsub-main">
          {/* 消息列表 */}
          <div className="messages-header">
            <h3>
              {settings.language === 'zh-CN' ? '消息' : 'Messages'}
              {messages.length > 0 && <span className="message-count">({messages.length})</span>}
            </h3>
            <button className="clear-btn" onClick={clearMessages} disabled={messages.length === 0}>
              <Trash2 size={14} />
            </button>
          </div>
          <div className="messages-list">
            {messages.length === 0 ? (
              <div className="empty-messages">
                {subscribedChannels.size > 0
                  ? (settings.language === 'zh-CN' ? '等待接收消息...' : 'Waiting for messages...')
                  : (settings.language === 'zh-CN' ? '订阅频道后可接收消息' : 'Subscribe to channels to receive messages')}
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
    </Modal>
  );
}

export default PubSubPanel;
