import React from 'react';
import { ChevronUp } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import './StatusBar.css';

interface Connection {
  id: string;
  name: string;
  host: string;
  port: number;
  status: 'connected' | 'connecting' | 'disconnecting' | 'disconnected' | 'error';
  // SSH 配置
  useSSH?: boolean;
  sshHost?: string;
  sshPort?: number;
}

interface StatusBarProps {
  connection?: Connection;
  consoleVisible?: boolean;
  onToggleConsole?: () => void;
}

function StatusBar({ connection, consoleVisible, onToggleConsole }: StatusBarProps) {
  const { t, settings } = useSettings();

  const getStatusText = (status?: string): string => {
    switch (status) {
      case 'connected': return t('status.connected');
      case 'connecting': return t('status.connecting');
      case 'disconnecting': return settings.language === 'zh-CN' ? '断开中...' : 'Disconnecting...';
      case 'disconnected': return t('status.disconnected');
      case 'error': return t('status.error');
      default: return t('status.disconnected');
    }
  };

  // 显示连接地址：如果是 SSH 连接，显示 SSH 主机 → Redis 主机
  const getConnectionInfo = () => {
    if (!connection) return '';
    if (connection.useSSH && connection.sshHost) {
      return `${connection.sshHost}:${connection.sshPort || 22} → ${connection.host}:${connection.port}`;
    }
    return `${connection.host}:${connection.port}`;
  };

  return (
    <div className="status-bar">
      <div className="status-left">
        {connection ? (
          <>
            <span className={`status-dot ${connection.status}`} />
            <span className="status-text">{getStatusText(connection.status)}</span>
            <span className="status-divider">|</span>
            <span className="status-name">{connection.name}</span>
            <span className="status-divider">|</span>
            <span className="status-info">{getConnectionInfo()}</span>
          </>
        ) : (
          <>
            <span className="status-dot disconnected" />
            <span className="status-text">{t('status.disconnected')}</span>
          </>
        )}
      </div>
      <div className="status-right">
        {/* 控制台展开按钮 */}
        {!consoleVisible && onToggleConsole && connection?.status === 'connected' && (
          <button
            className="console-toggle-btn"
            onClick={onToggleConsole}
            title={settings.language === 'zh-CN' ? '显示控制台' : 'Show Console'}
          >
            <ChevronUp size={14} />
            <span>{settings.language === 'zh-CN' ? '控制台' : 'Console'}</span>
          </button>
        )}
        <span className="version">Redis Connector v1.0.0</span>
      </div>
    </div>
  );
}

export default React.memo(StatusBar);
