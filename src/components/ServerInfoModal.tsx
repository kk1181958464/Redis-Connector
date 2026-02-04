import { useState, useEffect, useCallback } from 'react';
import { X, RefreshCw, Server, Cpu, HardDrive, Users, Activity, Database, Clock, AlertTriangle, List } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
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

interface SlowLogEntry {
  id: number;
  timestamp: number;
  duration: number;
  command: string[];
  clientAddr?: string;
  clientName?: string;
}

interface BigKeyInfo {
  key: string;
  type: string;
  size: number;
  elements?: number;
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
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [activeSection, setActiveSection] = useState('server');
  const [slowLogs, setSlowLogs] = useState<SlowLogEntry[]>([]);
  const [bigKeys, setBigKeys] = useState<BigKeyInfo[]>([]);
  const [bigKeyScanning, setBigKeyScanning] = useState(false);
  const [bigKeyScanProgress, setBigKeyScanProgress] = useState(0);
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
      }
    } finally {
      setLoading(false);
    }
  }, [onExecute]);

  // 加载慢查询日志
  const loadSlowLogs = useCallback(async () => {
    setLoading(true);
    try {
      const result = await onExecute('SLOWLOG GET 50');
      if (result?.success && Array.isArray(result.data)) {
        const logs: SlowLogEntry[] = result.data.map((entry: any[]) => ({
          id: entry[0],
          timestamp: entry[1],
          duration: entry[2],
          command: entry[3] || [],
          clientAddr: entry[4],
          clientName: entry[5],
        }));
        setSlowLogs(logs);
      }
    } finally {
      setLoading(false);
    }
  }, [onExecute]);

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
      }
    } finally {
      setLoading(false);
    }
  }, [onExecute]);

  // 扫描大 Key
  const scanBigKeys = useCallback(async () => {
    setBigKeyScanning(true);
    setBigKeys([]);
    setBigKeyScanProgress(0);

    try {
      const allKeys: BigKeyInfo[] = [];
      let cursor = '0';
      let scanned = 0;

      // 获取总 key 数量用于计算进度
      const dbsizeResult = await onExecute('DBSIZE');
      const totalKeys = dbsizeResult?.success ? dbsizeResult.data : 1000;

      do {
        const scanResult = await onExecute(`SCAN ${cursor} COUNT 100`);
        if (!scanResult?.success || !Array.isArray(scanResult.data)) break;

        const [newCursor, keys] = scanResult.data;
        cursor = newCursor;
        scanned += keys.length;

        // 更新进度
        setBigKeyScanProgress(Math.min(100, Math.round((scanned / totalKeys) * 100)));

        // 获取每个 key 的内存占用
        for (const key of keys) {
          const memResult = await onExecute(`MEMORY USAGE "${key}"`);
          const typeResult = await onExecute(`TYPE "${key}"`);

          if (memResult?.success && memResult.data > 1024) { // 只记录 > 1KB 的 key
            const keyInfo: BigKeyInfo = {
              key,
              type: typeResult?.data || 'unknown',
              size: memResult.data,
            };

            // 获取元素数量
            const type = typeResult?.data;
            if (type === 'list') {
              const lenResult = await onExecute(`LLEN "${key}"`);
              if (lenResult?.success) keyInfo.elements = lenResult.data;
            } else if (type === 'set') {
              const lenResult = await onExecute(`SCARD "${key}"`);
              if (lenResult?.success) keyInfo.elements = lenResult.data;
            } else if (type === 'zset') {
              const lenResult = await onExecute(`ZCARD "${key}"`);
              if (lenResult?.success) keyInfo.elements = lenResult.data;
            } else if (type === 'hash') {
              const lenResult = await onExecute(`HLEN "${key}"`);
              if (lenResult?.success) keyInfo.elements = lenResult.data;
            } else if (type === 'string') {
              const lenResult = await onExecute(`STRLEN "${key}"`);
              if (lenResult?.success) keyInfo.elements = lenResult.data;
            }

            allKeys.push(keyInfo);
          }
        }

        // 实时更新结果（按大小排序，取前 50）
        allKeys.sort((a, b) => b.size - a.size);
        setBigKeys(allKeys.slice(0, 50));

      } while (cursor !== '0');

      setBigKeyScanProgress(100);
    } finally {
      setBigKeyScanning(false);
    }
  }, [onExecute]);

  useEffect(() => {
    if (isOpen) {
      loadInfo();
    }
  }, [isOpen, loadInfo]);

  // 切换到慢查询时加载数据
  useEffect(() => {
    if (isOpen && activeSection === 'slowlog') {
      loadSlowLogs();
    }
  }, [isOpen, activeSection, loadSlowLogs]);

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

  // 格式化时间戳
  const formatTimestamp = (timestamp: number): string => {
    const date = new Date(timestamp * 1000);
    return date.toLocaleString(settings.language === 'zh-CN' ? 'zh-CN' : 'en-US');
  };

  // 格式化微秒为可读时间
  const formatDuration = (microseconds: number): string => {
    if (microseconds < 1000) return `${microseconds} μs`;
    if (microseconds < 1000000) return `${(microseconds / 1000).toFixed(2)} ms`;
    return `${(microseconds / 1000000).toFixed(2)} s`;
  };

  if (!isOpen) return null;

  const sections = [
    { key: 'server', label: settings.language === 'zh-CN' ? '服务器' : 'Server', icon: <Server size={16} /> },
    { key: 'clients', label: settings.language === 'zh-CN' ? '客户端' : 'Clients', icon: <Users size={16} /> },
    { key: 'memory', label: settings.language === 'zh-CN' ? '内存' : 'Memory', icon: <HardDrive size={16} /> },
    { key: 'stats', label: settings.language === 'zh-CN' ? '统计' : 'Stats', icon: <Activity size={16} /> },
    { key: 'cpu', label: 'CPU', icon: <Cpu size={16} /> },
    { key: 'keyspace', label: settings.language === 'zh-CN' ? '键空间' : 'Keyspace', icon: <Database size={16} /> },
    { key: 'slowlog', label: settings.language === 'zh-CN' ? '慢查询' : 'Slow Log', icon: <Clock size={16} /> },
    { key: 'bigkeys', label: settings.language === 'zh-CN' ? '大 Key' : 'Big Keys', icon: <AlertTriangle size={16} /> },
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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="server-info-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{settings.language === 'zh-CN' ? '服务器信息' : 'Server Info'}</h2>
          <div className="header-actions">
            <button className="refresh-btn" onClick={loadInfo} disabled={loading}>
              <RefreshCw size={16} className={loading ? 'spin' : ''} />
            </button>
            <button className="close-btn" onClick={onClose}>
              <X size={20} />
            </button>
          </div>
        </div>

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
            ) : activeSection === 'slowlog' ? (
              // 慢查询日志
              slowLogs.length === 0 ? (
                <div className="empty">{settings.language === 'zh-CN' ? '无慢查询记录' : 'No slow queries'}</div>
              ) : (
                <div className="slowlog-list">
                  {slowLogs.map(log => (
                    <div key={log.id} className="slowlog-item">
                      <div className="slowlog-header">
                        <span className="slowlog-id">#{log.id}</span>
                        <span className="slowlog-time">{formatTimestamp(log.timestamp)}</span>
                        <span className={`slowlog-duration ${log.duration > 100000 ? 'slow' : log.duration > 10000 ? 'medium' : ''}`}>
                          {formatDuration(log.duration)}
                        </span>
                      </div>
                      <div className="slowlog-command">
                        {log.command.join(' ')}
                      </div>
                      {log.clientAddr && (
                        <div className="slowlog-client">
                          {log.clientAddr} {log.clientName ? `(${log.clientName})` : ''}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )
            ) : activeSection === 'bigkeys' ? (
              // 大 Key 分析
              <div className="bigkeys-section">
                <div className="bigkeys-header">
                  <p className="bigkeys-desc">
                    {settings.language === 'zh-CN'
                      ? '扫描数据库中占用内存较大的 Key（> 1KB）'
                      : 'Scan for keys with large memory usage (> 1KB)'}
                  </p>
                  <button
                    className="scan-btn"
                    onClick={scanBigKeys}
                    disabled={bigKeyScanning}
                  >
                    {bigKeyScanning ? (
                      <>
                        <RefreshCw size={14} className="spin" />
                        {bigKeyScanProgress}%
                      </>
                    ) : (
                      <>
                        <RefreshCw size={14} />
                        {settings.language === 'zh-CN' ? '开始扫描' : 'Start Scan'}
                      </>
                    )}
                  </button>
                </div>
                {bigKeyScanning && (
                  <div className="scan-progress">
                    <div className="progress-bar" style={{ width: `${bigKeyScanProgress}%` }} />
                  </div>
                )}
                {bigKeys.length === 0 ? (
                  <div className="empty">
                    {bigKeyScanning
                      ? (settings.language === 'zh-CN' ? '扫描中...' : 'Scanning...')
                      : (settings.language === 'zh-CN' ? '点击"开始扫描"分析大 Key' : 'Click "Start Scan" to analyze big keys')}
                  </div>
                ) : (
                  <div className="bigkeys-list">
                    <table className="info-table">
                      <thead>
                        <tr>
                          <th>{settings.language === 'zh-CN' ? '排名' : 'Rank'}</th>
                          <th>Key</th>
                          <th>{settings.language === 'zh-CN' ? '类型' : 'Type'}</th>
                          <th>{settings.language === 'zh-CN' ? '大小' : 'Size'}</th>
                          <th>{settings.language === 'zh-CN' ? '元素数' : 'Elements'}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bigKeys.map((item, index) => (
                          <tr key={item.key} className={index < 3 ? 'top-key' : ''}>
                            <td className="rank-cell">#{index + 1}</td>
                            <td className="key-cell" title={item.key}>{item.key}</td>
                            <td className="type-cell">{item.type}</td>
                            <td className="size-cell">{formatBytes(String(item.size))}</td>
                            <td className="elements-cell">{item.elements ?? '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
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
      </div>
    </div>
  );
}

export default ServerInfoModal;
