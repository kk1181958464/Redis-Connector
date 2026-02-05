import { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, Server, Cpu, HardDrive, Users, Activity, Database, Clock, AlertTriangle, List, StopCircle } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import { useToast } from './Toast';
import Modal from './Modal';
import './ServerInfoModal.css';

interface ServerInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExecute: (command: string) => Promise<any>;
  onPipeline?: (commands: string[]) => Promise<{ success: boolean; results?: any[]; error?: string }>;
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

function ServerInfoModal({ isOpen, onClose, onExecute, onPipeline }: ServerInfoModalProps) {
  const { settings } = useSettings();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [activeSection, setActiveSection] = useState('server');

  // 慢查询状态
  const [slowLogs, setSlowLogs] = useState<SlowLogEntry[]>([]);
  const [slowLogMinDuration, setSlowLogMinDuration] = useState<string>('1'); // 字符串类型
  const [slowLogDurationUnit, setSlowLogDurationUnit] = useState<'us' | 'ms' | 's'>('ms'); // 单位
  const [slowLogPage, setSlowLogPage] = useState(1); // 当前页码
  const [slowLogLoading, setSlowLogLoading] = useState(false);
  const [slowLogHasMore, setSlowLogHasMore] = useState(true);
  const slowLogOffsetRef = useRef(0); // 已加载的偏移量

  // 大 Key 状态
  const [bigKeys, setBigKeys] = useState<BigKeyInfo[]>([]);
  const [bigKeyScanning, setBigKeyScanning] = useState(false);
  const [bigKeyScanProgress, setBigKeyScanProgress] = useState(0);
  const [bigKeyMinSize, setBigKeyMinSize] = useState<string>('1'); // 改为字符串类型
  const [bigKeySizeUnit, setBigKeySizeUnit] = useState<'B' | 'KB' | 'MB'>('KB'); // 单位
  const [bigKeyPage, setBigKeyPage] = useState(1); // 当前页码
  const [bigKeyHasMore, setBigKeyHasMore] = useState(true); // 是否还有更多数据
  const [bigKeyTotalScanned, setBigKeyTotalScanned] = useState(0); // 已扫描的 key 数量
  const bigKeyScanAbortRef = useRef(false); // 中断标志
  const bigKeyCursorRef = useRef('0'); // SCAN 游标
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

  // 计算慢查询阈值（微秒）
  const getSlowLogThreshold = useCallback(() => {
    const multipliers = { us: 1, ms: 1000, s: 1000000 };
    const duration = parseInt(slowLogMinDuration, 10) || 0;
    return duration * multipliers[slowLogDurationUnit];
  }, [slowLogMinDuration, slowLogDurationUnit]);

  // 加载慢查询日志（按需加载）
  const loadSlowLogs = useCallback(async (isNewScan: boolean = true) => {
    // 验证输入
    const durationValue = parseInt(slowLogMinDuration, 10);
    if (durationValue < 0) {
      showToast(settings.language === 'zh-CN' ? '请输入有效的时间' : 'Please enter a valid duration', 'error');
      return;
    }

    if (isNewScan) {
      setSlowLogs([]);
      setSlowLogPage(1);
      setSlowLogHasMore(false);
      slowLogOffsetRef.current = 0;
    }

    setSlowLogLoading(true);
    const threshold = getSlowLogThreshold();

    try {
      // 获取慢查询日志总数
      const lenResult = await onExecute('SLOWLOG LEN');
      const totalLogs = lenResult?.success ? lenResult.data : 0;

      if (totalLogs === 0) {
        setSlowLogs([]);
        setSlowLogHasMore(false);
        showToast(settings.language === 'zh-CN' ? '无慢查询记录' : 'No slow queries', 'info');
        setSlowLogLoading(false);
        return;
      }

      // SLOWLOG GET 只支持 count 参数，不支持 offset
      // 所以我们一次性获取所有日志，然后在前端过滤和分页
      const result = await onExecute(`SLOWLOG GET ${totalLogs}`);

      if (result?.success && Array.isArray(result.data)) {
        const allLogs: SlowLogEntry[] = result.data
          .map((entry: any[]) => ({
            id: entry[0],
            timestamp: entry[1],
            duration: entry[2],
            command: entry[3] || [],
            clientAddr: entry[4],
            clientName: entry[5],
          }))
          .filter((log: SlowLogEntry) => log.duration >= threshold);

        setSlowLogs(allLogs);
        setSlowLogHasMore(false); // SLOWLOG 不支持分页，一次加载全部

        showToast(
          settings.language === 'zh-CN'
            ? `已加载 ${allLogs.length} 条慢查询`
            : `Loaded ${allLogs.length} slow queries`,
          'success'
        );
      } else {
        showToast(settings.language === 'zh-CN' ? '加载慢查询日志失败' : 'Failed to load slow logs', 'error');
      }
    } catch (e) {
      showToast(settings.language === 'zh-CN' ? '加载慢查询日志失败' : 'Failed to load slow logs', 'error');
    } finally {
      setSlowLogLoading(false);
    }
  }, [onExecute, showToast, settings.language, slowLogMinDuration, getSlowLogThreshold]);

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

  // 计算大 Key 阈值（字节）
  const getBigKeyThreshold = useCallback(() => {
    const multipliers = { B: 1, KB: 1024, MB: 1024 * 1024 };
    const size = parseInt(bigKeyMinSize, 10) || 1; // 默认为 1
    return size * multipliers[bigKeySizeUnit];
  }, [bigKeyMinSize, bigKeySizeUnit]);

  // 停止扫描
  const stopBigKeyScan = useCallback(() => {
    bigKeyScanAbortRef.current = true;
  }, []);

  // 扫描大 Key（按页加载模式）
  const scanBigKeys = useCallback(async (isNewScan: boolean = true) => {
    // 验证输入
    const sizeValue = parseInt(bigKeyMinSize, 10);
    if (!sizeValue || sizeValue <= 0) {
      showToast(settings.language === 'zh-CN' ? '请输入有效的最小大小' : 'Please enter a valid minimum size', 'error');
      return;
    }

    if (isNewScan) {
      // 新扫描：重置所有状态
      setBigKeys([]);
      setBigKeyScanProgress(0);
      setBigKeyPage(1);
      setBigKeyHasMore(true);
      setBigKeyTotalScanned(0);
      bigKeyCursorRef.current = '0';
    }

    setBigKeyScanning(true);
    bigKeyScanAbortRef.current = false;

    const threshold = getBigKeyThreshold();
    const pageSize = settings.data.keysPerPage;

    try {
      const newKeys: BigKeyInfo[] = isNewScan ? [] : [...bigKeys];
      let cursor = bigKeyCursorRef.current;
      let scanned = bigKeyTotalScanned;
      let foundInThisBatch = 0;
      const targetCount = isNewScan ? pageSize : newKeys.length + pageSize;

      // 获取总 key 数量用于计算进度
      const dbsizeResult = await onExecute('DBSIZE');
      const totalKeys = dbsizeResult?.success ? dbsizeResult.data : 1000;

      // 扫描直到找到足够的大 Key 或扫描完成
      while (newKeys.length < targetCount && cursor !== '0' || (cursor === '0' && scanned === 0)) {
        // 检查是否中断
        if (bigKeyScanAbortRef.current) {
          showToast(settings.language === 'zh-CN' ? '扫描已停止' : 'Scan stopped', 'info');
          break;
        }

        const scanResult = await onExecute(`SCAN ${cursor} COUNT 200`);
        if (!scanResult?.success || !Array.isArray(scanResult.data)) break;

        const [newCursor, keys] = scanResult.data;
        cursor = newCursor;
        scanned += keys.length;

        // 更新进度
        setBigKeyScanProgress(Math.min(100, Math.round((scanned / totalKeys) * 100)));
        setBigKeyTotalScanned(scanned);

        if (keys.length === 0) {
          if (cursor === '0') break;
          continue;
        }

        // 使用 Pipeline 批量获取内存和类型
        if (onPipeline) {
          const memCommands = keys.map((key: string) => `MEMORY USAGE "${key}"`);
          const typeCommands = keys.map((key: string) => `TYPE "${key}"`);

          const [memResponse, typeResponse] = await Promise.all([
            onPipeline(memCommands),
            onPipeline(typeCommands)
          ]);

          const memResults = memResponse?.success ? memResponse.results : [];
          const typeResults = typeResponse?.success ? typeResponse.results : [];

          if (!memResults?.length || !typeResults?.length) {
            if (cursor === '0') break;
            continue;
          }

          // 筛选大 Key
          const bigKeyIndices: number[] = [];
          for (let i = 0; i < keys.length; i++) {
            const memResult = memResults[i];
            if (memResult?.success && memResult.data >= threshold) {
              bigKeyIndices.push(i);
            }
          }

          // 对大 Key 批量获取元素数量
          if (bigKeyIndices.length > 0) {
            const lenCommands: string[] = [];
            const lenKeyMap: { index: number; type: string }[] = [];

            for (const i of bigKeyIndices) {
              const key = keys[i];
              const type = typeResults[i]?.data || 'unknown';
              let cmd = '';

              switch (type) {
                case 'list': cmd = `LLEN "${key}"`; break;
                case 'set': cmd = `SCARD "${key}"`; break;
                case 'zset': cmd = `ZCARD "${key}"`; break;
                case 'hash': cmd = `HLEN "${key}"`; break;
                case 'string': cmd = `STRLEN "${key}"`; break;
              }

              if (cmd) {
                lenCommands.push(cmd);
                lenKeyMap.push({ index: i, type });
              } else {
                newKeys.push({
                  key: keys[i],
                  type,
                  size: memResults[i].data,
                });
                foundInThisBatch++;
              }
            }

            if (lenCommands.length > 0) {
              const lenResponse = await onPipeline(lenCommands);
              const lenResults = lenResponse?.success ? lenResponse.results : [];

              for (let j = 0; j < lenKeyMap.length; j++) {
                const { index, type } = lenKeyMap[j];
                newKeys.push({
                  key: keys[index],
                  type,
                  size: memResults[index]?.data,
                  elements: lenResults?.[j]?.success ? lenResults[j].data : undefined,
                });
                foundInThisBatch++;
              }
            }
          }
        } else {
          // 降级：逐个执行
          for (const key of keys) {
            if (bigKeyScanAbortRef.current) break;
            if (newKeys.length >= targetCount) break;

            const memResult = await onExecute(`MEMORY USAGE "${key}"`);
            const typeResult = await onExecute(`TYPE "${key}"`);

            if (memResult?.success && memResult.data >= threshold) {
              const keyInfo: BigKeyInfo = {
                key,
                type: typeResult?.data || 'unknown',
                size: memResult.data,
              };

              const type = typeResult?.data;
              let lenResult;
              if (type === 'list') lenResult = await onExecute(`LLEN "${key}"`);
              else if (type === 'set') lenResult = await onExecute(`SCARD "${key}"`);
              else if (type === 'zset') lenResult = await onExecute(`ZCARD "${key}"`);
              else if (type === 'hash') lenResult = await onExecute(`HLEN "${key}"`);
              else if (type === 'string') lenResult = await onExecute(`STRLEN "${key}"`);

              if (lenResult?.success) keyInfo.elements = lenResult.data;
              newKeys.push(keyInfo);
              foundInThisBatch++;
            }
          }
        }

        // 保存游标位置
        bigKeyCursorRef.current = cursor;

        // 如果已经找到足够的数据，暂停扫描
        if (newKeys.length >= targetCount) break;

        // 如果扫描完成
        if (cursor === '0') break;
      }

      // 按大小排序
      newKeys.sort((a, b) => b.size - a.size);
      setBigKeys(newKeys);

      // 判断是否还有更多
      const hasMore = cursor !== '0';
      setBigKeyHasMore(hasMore);

      if (!bigKeyScanAbortRef.current) {
        if (!hasMore) {
          setBigKeyScanProgress(100);
        }
        if (isNewScan) {
          showToast(
            settings.language === 'zh-CN'
              ? `已加载 ${newKeys.length} 个大 Key${hasMore ? '，可加载更多' : ''}`
              : `Loaded ${newKeys.length} big keys${hasMore ? ', more available' : ''}`,
            'success'
          );
        }
      }
    } catch (e) {
      showToast(settings.language === 'zh-CN' ? '扫描失败' : 'Scan failed', 'error');
    } finally {
      setBigKeyScanning(false);
      bigKeyScanAbortRef.current = false;
    }
  }, [onExecute, onPipeline, getBigKeyThreshold, showToast, settings.language, settings.data.keysPerPage, bigKeyMinSize, bigKeys, bigKeyTotalScanned]);

  // 加载更多大 Key
  const loadMoreBigKeys = useCallback(() => {
    if (!bigKeyScanning && bigKeyHasMore) {
      setBigKeyPage(prev => prev + 1);
      scanBigKeys(false);
    }
  }, [bigKeyScanning, bigKeyHasMore, scanBigKeys]);

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
      className="server-info-modal"
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
            ) : activeSection === 'slowlog' ? (
              // 慢查询日志
              <div className="slowlog-section">
                <div className="slowlog-header">
                  <div className="slowlog-filter">
                    <label>{settings.language === 'zh-CN' ? '最小耗时：' : 'Min Duration: '}</label>
                    <input
                      type="number"
                      value={slowLogMinDuration}
                      onChange={e => setSlowLogMinDuration(e.target.value)}
                      className="slowlog-duration-input"
                      disabled={slowLogLoading}
                      placeholder="0"
                    />
                    <select
                      value={slowLogDurationUnit}
                      onChange={e => setSlowLogDurationUnit(e.target.value as 'us' | 'ms' | 's')}
                      className="slowlog-unit-select"
                      disabled={slowLogLoading}
                    >
                      <option value="us">μs</option>
                      <option value="ms">ms</option>
                      <option value="s">s</option>
                    </select>
                  </div>
                  <button
                    className="scan-btn"
                    onClick={() => loadSlowLogs(true)}
                    disabled={slowLogLoading}
                  >
                    <RefreshCw size={14} className={slowLogLoading ? 'spin' : ''} />
                    {settings.language === 'zh-CN' ? '开始扫描' : 'Start Scan'}
                  </button>
                </div>
                {slowLogs.length === 0 ? (
                  <div className="empty">
                    {slowLogLoading
                      ? (settings.language === 'zh-CN' ? '加载中...' : 'Loading...')
                      : (settings.language === 'zh-CN' ? '点击"开始扫描"加载慢查询' : 'Click "Start Scan" to load slow queries')}
                  </div>
                ) : (
                  <div className="slowlog-list-wrapper">
                    <div className="slowlog-summary">
                      {settings.language === 'zh-CN'
                        ? `已加载 ${slowLogs.length} 条慢查询`
                        : `Loaded ${slowLogs.length} slow queries`}
                      {slowLogHasMore && !slowLogLoading && (
                        <span className="has-more-hint">
                          {settings.language === 'zh-CN' ? '，可加载更多' : ', more available'}
                        </span>
                      )}
                    </div>
                    <div className="slowlog-table-wrapper">
                      <table className="info-table slowlog-table">
                        <thead>
                          <tr>
                            <th>ID</th>
                            <th>{settings.language === 'zh-CN' ? '时间' : 'Time'}</th>
                            <th>{settings.language === 'zh-CN' ? '耗时' : 'Duration'}</th>
                            <th>{settings.language === 'zh-CN' ? '命令' : 'Command'}</th>
                            <th>{settings.language === 'zh-CN' ? '客户端' : 'Client'}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {slowLogs
                            .slice((slowLogPage - 1) * settings.data.keysPerPage, slowLogPage * settings.data.keysPerPage)
                            .map(log => (
                              <tr key={log.id}>
                                <td className="id-cell">#{log.id}</td>
                                <td className="time-cell">{formatTimestamp(log.timestamp)}</td>
                                <td className={`duration-cell ${log.duration > 100000 ? 'slow' : log.duration > 10000 ? 'medium' : ''}`}>
                                  {formatDuration(log.duration)}
                                </td>
                                <td className="command-cell">
                                  <div className="command-content" title={log.command.join(' ')}>
                                    {log.command.map((arg, i) => {
                                      const safeArg = typeof arg === 'string' ? arg : String(arg);
                                      const hasBinary = /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(safeArg);
                                      if (hasBinary) {
                                        return <span key={i} className="binary-arg">[binary:{safeArg.length}B]</span>;
                                      }
                                      const display = safeArg.length > 50 ? safeArg.substring(0, 50) + '...' : safeArg;
                                      return <span key={i}>{i > 0 ? ' ' : ''}{display}</span>;
                                    })}
                                  </div>
                                </td>
                                <td className="client-cell">{log.clientAddr || '-'}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                    {/* 分页和加载更多 */}
                    <div className="slowlog-footer">
                      <div className="pagination">
                        <button
                          className="page-btn"
                          disabled={slowLogPage <= 1}
                          onClick={() => setSlowLogPage(1)}
                        >
                          «
                        </button>
                        <button
                          className="page-btn"
                          disabled={slowLogPage <= 1}
                          onClick={() => setSlowLogPage(p => p - 1)}
                        >
                          ‹
                        </button>
                        <span className="page-info">
                          {slowLogPage} / {Math.ceil(slowLogs.length / settings.data.keysPerPage) || 1}
                        </span>
                        <button
                          className="page-btn"
                          disabled={slowLogPage >= Math.ceil(slowLogs.length / settings.data.keysPerPage)}
                          onClick={() => setSlowLogPage(p => p + 1)}
                        >
                          ›
                        </button>
                        <button
                          className="page-btn"
                          disabled={slowLogPage >= Math.ceil(slowLogs.length / settings.data.keysPerPage)}
                          onClick={() => setSlowLogPage(Math.ceil(slowLogs.length / settings.data.keysPerPage))}
                        >
                          »
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : activeSection === 'bigkeys' ? (
              // 大 Key 分析
              <div className="bigkeys-section">
                <div className="bigkeys-header">
                  <div className="bigkeys-filter">
                    <label>{settings.language === 'zh-CN' ? '最小大小：' : 'Min Size: '}</label>
                    <input
                      type="number"
                      value={bigKeyMinSize}
                      onChange={e => setBigKeyMinSize(e.target.value)}
                      className="bigkey-size-input"
                      disabled={bigKeyScanning}
                      placeholder="1"
                    />
                    <select
                      value={bigKeySizeUnit}
                      onChange={e => setBigKeySizeUnit(e.target.value as 'B' | 'KB' | 'MB')}
                      className="bigkey-unit-select"
                      disabled={bigKeyScanning}
                    >
                      <option value="B">B</option>
                      <option value="KB">KB</option>
                      <option value="MB">MB</option>
                    </select>
                  </div>
                  <div className="bigkeys-actions">
                    {bigKeyScanning ? (
                      <button
                        className="scan-btn stop"
                        onClick={stopBigKeyScan}
                      >
                        <StopCircle size={14} />
                        {settings.language === 'zh-CN' ? '停止扫描' : 'Stop'}
                      </button>
                    ) : (
                      <button
                        className="scan-btn"
                        onClick={() => scanBigKeys(true)}
                      >
                        <RefreshCw size={14} />
                        {settings.language === 'zh-CN' ? '开始扫描' : 'Start Scan'}
                      </button>
                    )}
                  </div>
                </div>
                {bigKeyScanning && (
                  <div className="scan-progress">
                    <div className="progress-bar" style={{ width: `${bigKeyScanProgress}%` }} />
                    <span className="progress-text">{bigKeyScanProgress}%</span>
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
                    <div className="bigkeys-summary">
                      {settings.language === 'zh-CN'
                        ? `已加载 ${bigKeys.length} 个大 Key（已扫描 ${bigKeyTotalScanned} 个 Key）`
                        : `Loaded ${bigKeys.length} big keys (scanned ${bigKeyTotalScanned} keys)`}
                      {bigKeyHasMore && !bigKeyScanning && (
                        <span className="has-more-hint">
                          {settings.language === 'zh-CN' ? '，可加载更多' : ', more available'}
                        </span>
                      )}
                    </div>
                    <div className="bigkeys-table-wrapper">
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
                          {bigKeys
                            .slice((bigKeyPage - 1) * settings.data.keysPerPage, bigKeyPage * settings.data.keysPerPage)
                            .map((item, index) => {
                              const globalIndex = (bigKeyPage - 1) * settings.data.keysPerPage + index;
                              return (
                                <tr key={item.key} className={globalIndex < 3 ? 'top-key' : ''}>
                                  <td className="rank-cell">#{globalIndex + 1}</td>
                                  <td className="key-cell">
                                    <div className="key-cell-content">
                                      <span className="key-name-full" title={item.key}>{item.key}</span>
                                      <button
                                        className="copy-key-btn"
                                        onClick={() => {
                                          navigator.clipboard.writeText(item.key);
                                          showToast(settings.language === 'zh-CN' ? '已复制' : 'Copied', 'success');
                                        }}
                                        title={settings.language === 'zh-CN' ? '复制 Key' : 'Copy Key'}
                                      >
                                        📋
                                      </button>
                                    </div>
                                  </td>
                                  <td className="type-cell">{item.type}</td>
                                  <td className="size-cell">{formatBytes(String(item.size))}</td>
                                  <td className="elements-cell">{item.elements ?? '-'}</td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                    {/* 分页和加载更多 - 固定在底部 */}
                    <div className="bigkeys-footer">
                      {/* 前端分页控件 */}
                      <div className="pagination">
                        <button
                          className="page-btn"
                          disabled={bigKeyPage <= 1}
                          onClick={() => setBigKeyPage(1)}
                          title={settings.language === 'zh-CN' ? '首页' : 'First'}
                        >
                          «
                        </button>
                        <button
                          className="page-btn"
                          disabled={bigKeyPage <= 1}
                          onClick={() => setBigKeyPage(p => p - 1)}
                          title={settings.language === 'zh-CN' ? '上一页' : 'Previous'}
                        >
                          ‹
                        </button>
                        <span className="page-info">
                          {bigKeyPage} / {Math.ceil(bigKeys.length / settings.data.keysPerPage) || 1}
                        </span>
                        <button
                          className="page-btn"
                          disabled={bigKeyPage >= Math.ceil(bigKeys.length / settings.data.keysPerPage)}
                          onClick={() => setBigKeyPage(p => p + 1)}
                          title={settings.language === 'zh-CN' ? '下一页' : 'Next'}
                        >
                          ›
                        </button>
                        <button
                          className="page-btn"
                          disabled={bigKeyPage >= Math.ceil(bigKeys.length / settings.data.keysPerPage)}
                          onClick={() => setBigKeyPage(Math.ceil(bigKeys.length / settings.data.keysPerPage))}
                          title={settings.language === 'zh-CN' ? '末页' : 'Last'}
                        >
                          »
                        </button>
                      </div>
                      {/* 加载更多按钮 */}
                      {bigKeyHasMore && (
                        <button
                          className="load-more-btn"
                          onClick={loadMoreBigKeys}
                          disabled={bigKeyScanning}
                        >
                          {bigKeyScanning ? (
                            <>
                              <RefreshCw size={14} className="spin" />
                              {settings.language === 'zh-CN' ? '加载中...' : 'Loading...'}
                            </>
                          ) : (
                            <>
                              {settings.language === 'zh-CN' ? '加载更多' : 'Load More'}
                            </>
                          )}
                        </button>
                      )}
                      {!bigKeyHasMore && (
                        <span className="no-more-hint">
                          {settings.language === 'zh-CN' ? '已加载全部' : 'All loaded'}
                        </span>
                      )}
                    </div>
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
    </Modal>
  );
}

export default ServerInfoModal;
