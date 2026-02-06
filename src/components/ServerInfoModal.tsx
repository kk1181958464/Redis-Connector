import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Server, Cpu, HardDrive, Users, Activity, Database, List } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import { useToast } from './Toast';
import Modal from './Modal';
import './ServerInfoModal.css';

interface ServerInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExecute: (command: string) => Promise<any>;
}

interface ServerInfo {
  server: Record<string, string>;
  clients: Record<string, string>;
  memory: Record<string, string>;
  stats: Record<string, string>;
  replication: Record<string, string>;
  cpu: Record<string, string>;
  keyspace: Record<string, string>;
}

interface ClientInfo {
  id: string;
  addr: string;
  name: string;
  age: number;
  idle: number;
  flags: string;
  db: number;
  cmd: string;
}

function ServerInfoModal({ isOpen, onClose, onExecute }: ServerInfoModalProps) {
  const { settings } = useSettings();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [activeSection, setActiveSection] = useState('server');
  const [clientList, setClientList] = useState<ClientInfo[]>([]);

  // 解析 INFO 命令结果
  const parseInfo = (infoStr: string): ServerInfo => {
    const sections: ServerInfo = {
      server: {},
      clients: {},
      memory: {},
      stats: {},
      replication: {},
      cpu: {},
      keyspace: {},
    };

    let currentSection = '';
    const lines = infoStr.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith('#')) {
        currentSection = trimmed.slice(2).toLowerCase();
        continue;
      }

      const colonIndex = trimmed.indexOf(':');
      if (colonIndex > 0) {
        const key = trimmed.slice(0, colonIndex);
        const value = trimmed.slice(colonIndex + 1);

        if (currentSection in sections) {
          (sections as any)[currentSection][key] = value;
        }
      }
    }

    return sections;
  };

  // 加载服务器信息
  const loadInfo = useCallback(async () => {
    setLoading(true);
    try {
      const result = await onExecute('INFO');
      if (result?.success && result.data) {
        setInfo(parseInfo(result.data));
      } else {
        showToast(settings.language === 'zh-CN' ? '加载服务器信息失败' : 'Failed to load server info', 'error');
      }
    } catch (e) {
      showToast(settings.language === 'zh-CN' ? '加载服务器信息失败' : 'Failed to load server info', 'error');
    } finally {
      setLoading(false);
    }
  }, [onExecute, showToast, settings.language]);

  // 加载客户端列表
  const loadClientList = useCallback(async () => {
    setLoading(true);
    try {
      const result = await onExecute('CLIENT LIST');
      if (result?.success && typeof result.data === 'string') {
        const clients: ClientInfo[] = [];
        const lines = result.data.split('\n').filter((line: string) => line.trim());

        for (const line of lines) {
          const client: Partial<ClientInfo> = {};
          const pairs = line.split(' ');

          for (const pair of pairs) {
            const [key, value] = pair.split('=');
            if (key && value !== undefined) {
              switch (key) {
                case 'id': client.id = value; break;
                case 'addr': client.addr = value; break;
                case 'name': client.name = value || '-'; break;
                case 'age': client.age = parseInt(value, 10); break;
                case 'idle': client.idle = parseInt(value, 10); break;
                case 'flags': client.flags = value; break;
                case 'db': client.db = parseInt(value, 10); break;
                case 'cmd': client.cmd = value || '-'; break;
              }
            }
          }

          if (client.id && client.addr) {
            clients.push(client as ClientInfo);
          }
        }

        setClientList(clients);
      } else {
        showToast(settings.language === 'zh-CN' ? '加载客户端列表失败' : 'Failed to load client list', 'error');
      }
    } catch (e) {
      showToast(settings.language === 'zh-CN' ? '加载客户端列表失败' : 'Failed to load client list', 'error');
    } finally {
      setLoading(false);
    }
  }, [onExecute, showToast, settings.language]);

  useEffect(() => {
    if (isOpen) {
      loadInfo();
    }
  }, [isOpen, loadInfo]);

  // 切换到客户端列表时加载数据
  useEffect(() => {
    if (isOpen && activeSection === 'clientlist') {
      loadClientList();
    }
  }, [isOpen, activeSection, loadClientList]);

  // 格式化字节大小
  const formatBytes = (bytes: string): string => {
    const num = parseInt(bytes, 10);
    if (isNaN(num)) return bytes;
    if (num < 1024) return `${num} B`;
    if (num < 1024 * 1024) return `${(num / 1024).toFixed(2)} KB`;
    if (num < 1024 * 1024 * 1024) return `${(num / (1024 * 1024)).toFixed(2)} MB`;
    return `${(num / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  // 格式化运行时间
  const formatUptime = (seconds: string): string => {
    const num = parseInt(seconds, 10);
    if (isNaN(num)) return seconds;
    const days = Math.floor(num / 86400);
    const hours = Math.floor((num % 86400) / 3600);
    const minutes = Math.floor((num % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  const sections = [
    { key: 'server', label: settings.language === 'zh-CN' ? '服务器' : 'Server', icon: <Server size={16} /> },
    { key: 'clients', label: settings.language === 'zh-CN' ? '客户端' : 'Clients', icon: <Users size={16} /> },
    { key: 'memory', label: settings.language === 'zh-CN' ? '内存' : 'Memory', icon: <HardDrive size={16} /> },
    { key: 'stats', label: settings.language === 'zh-CN' ? '统计' : 'Stats', icon: <Activity size={16} /> },
    { key: 'cpu', label: 'CPU', icon: <Cpu size={16} /> },
    { key: 'keyspace', label: settings.language === 'zh-CN' ? '键空间' : 'Keyspace', icon: <Database size={16} /> },
    { key: 'clientlist', label: settings.language === 'zh-CN' ? '连接列表' : 'Client List', icon: <List size={16} /> },
  ];

  // 重要指标高亮显示
  const renderValue = (key: string, value: string): string => {
    if (key.includes('memory') && key.includes('bytes')) {
      return formatBytes(value);
    }
    if (key === 'uptime_in_seconds') {
      return formatUptime(value);
    }
    return value;
  };

  const currentData = info ? (info as any)[activeSection] || {} : {};

  const headerActions = (
    <button className="refresh-btn" onClick={loadInfo} disabled={loading}>
      <RefreshCw size={16} className={loading ? 'spin' : ''} />
    </button>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={<>{settings.language === 'zh-CN' ? '服务器信息' : 'Server Info'}{headerActions}</>}
      width={900}
      height={700}
      minWidth={600}
      minHeight={400}
      className="server-info-modal"
      storageKey="server-info"
    >
      <div className="modal-body">
        {/* 快速概览 */}
        {info && (
          <div className="quick-stats">
            <div className="stat-card">
              <span className="stat-label">Redis Version</span>
              <span className="stat-value">{info.server.redis_version || '-'}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">{settings.language === 'zh-CN' ? '运行时间' : 'Uptime'}</span>
              <span className="stat-value">{formatUptime(info.server.uptime_in_seconds || '0')}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">{settings.language === 'zh-CN' ? '已用内存' : 'Used Memory'}</span>
              <span className="stat-value">{formatBytes(info.memory.used_memory || '0')}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">{settings.language === 'zh-CN' ? '连接数' : 'Clients'}</span>
              <span className="stat-value">{info.clients.connected_clients || '0'}</span>
            </div>
          </div>
        )}

        {/* 分类标签 */}
        <div className="section-tabs">
          {sections.map(section => (
            <button
              key={section.key}
              className={`section-tab ${activeSection === section.key ? 'active' : ''}`}
              onClick={() => setActiveSection(section.key)}
            >
              {section.icon}
              <span>{section.label}</span>
            </button>
          ))}
        </div>

        {/* 详细信息 */}
        <div className="info-content">
          {loading ? (
            <div className="loading">{settings.language === 'zh-CN' ? '加载中...' : 'Loading...'}</div>
          ) : activeSection === 'clientlist' ? (
            // 客户端连接列表
            <div className="clientlist-section">
              <div className="clientlist-header">
                <p className="clientlist-desc">
                  {settings.language === 'zh-CN'
                    ? `当前共 ${clientList.length} 个客户端连接`
                    : `${clientList.length} client connections`}
                </p>
                <button
                  className="scan-btn"
                  onClick={loadClientList}
                  disabled={loading}
                >
                  <RefreshCw size={14} className={loading ? 'spin' : ''} />
                  {settings.language === 'zh-CN' ? '刷新' : 'Refresh'}
                </button>
              </div>
              {clientList.length === 0 ? (
                <div className="empty">
                  {loading
                    ? (settings.language === 'zh-CN' ? '加载中...' : 'Loading...')
                    : (settings.language === 'zh-CN' ? '无客户端连接' : 'No client connections')}
                </div>
              ) : (
                <div className="clientlist-list">
                  <table className="info-table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>{settings.language === 'zh-CN' ? '地址' : 'Address'}</th>
                        <th>{settings.language === 'zh-CN' ? '名称' : 'Name'}</th>
                        <th>{settings.language === 'zh-CN' ? '连接时长' : 'Age'}</th>
                        <th>{settings.language === 'zh-CN' ? '空闲时间' : 'Idle'}</th>
                        <th>DB</th>
                        <th>{settings.language === 'zh-CN' ? '最后命令' : 'Last Cmd'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {clientList.map((client) => (
                        <tr key={client.id}>
                          <td className="client-id-cell">{client.id}</td>
                          <td className="client-addr-cell">{client.addr}</td>
                          <td className="client-name-cell">{client.name || '-'}</td>
                          <td className="client-age-cell">{formatUptime(String(client.age))}</td>
                          <td className="client-idle-cell">{client.idle}s</td>
                          <td className="client-db-cell">{client.db}</td>
                          <td className="client-cmd-cell">{client.cmd}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : Object.keys(currentData).length === 0 ? (
            <div className="empty">{settings.language === 'zh-CN' ? '无数据' : 'No data'}</div>
          ) : (
            <table className="info-table">
              <tbody>
                {Object.entries(currentData).map(([key, value]) => (
                  <tr key={key}>
                    <td className="info-key">{key}</td>
                    <td className="info-value">{renderValue(key, value as string)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Modal>
  );
}

export default ServerInfoModal;
