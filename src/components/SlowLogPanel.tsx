import { useState, useEffect, useCallback, useRef } from 'react';
import { FixedSizeList as List } from 'react-window';
import { Clock, RefreshCw, Download, Trash2, Filter } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import { useToast } from './Toast';
import Modal from './Modal';
import './SlowLogPanel.css';

interface SlowLogEntry {
  id: number;
  timestamp: number;
  duration: number; // 微秒
  command: string[];
  clientAddr?: string;
  clientName?: string;
}

interface SlowLogStats {
  totalCount: number;
  avgDuration: number;
  maxDuration: number;
  minDuration: number;
  commandBreakdown: Record<string, { count: number; totalDuration: number }>;
  timeDistribution: { range: string; count: number; color: string }[];
}

interface SlowLogPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onExecute: (command: string) => Promise<any>;
}

const TIME_RANGES = [
  { range: '0-10ms', min: 0, max: 10000, color: '#22c55e' },
  { range: '10-50ms', min: 10000, max: 50000, color: '#84cc16' },
  { range: '50-100ms', min: 50000, max: 100000, color: '#f59e0b' },
  { range: '100-500ms', min: 100000, max: 500000, color: '#f97316' },
  { range: '>500ms', min: 500000, max: Infinity, color: '#ef4444' },
];

function SlowLogPanel({ isOpen, onClose, onExecute }: SlowLogPanelProps) {
  const { settings } = useSettings();
  const { showToast } = useToast();
  const [entries, setEntries] = useState<SlowLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [thresholdValue, setThresholdValue] = useState('10');
  const [thresholdUnit, setThresholdUnit] = useState<'μs' | 'ms' | 's'>('ms');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(5000);
  const [slowlogThreshold, setSlowlogThreshold] = useState<number | null>(null);
  const [listHeight, setListHeight] = useState(200);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const listContainerRef = useRef<HTMLDivElement>(null);

  // 计算实际阈值（微秒）
  const threshold = (() => {
    const value = parseFloat(thresholdValue) || 0;
    switch (thresholdUnit) {
      case 'μs': return value;
      case 'ms': return value * 1000;
      case 's': return value * 1000000;
      default: return value;
    }
  })();

  // 解析 SLOWLOG GET 结果
  const parseSlowLogEntries = (data: any[]): SlowLogEntry[] => {
    if (!Array.isArray(data)) return [];
    return data.map((entry: any): SlowLogEntry | null => {
      if (Array.isArray(entry) && entry.length >= 4) {
        return {
          id: entry[0],
          timestamp: entry[1],
          duration: entry[2],
          command: Array.isArray(entry[3]) ? entry[3] : [String(entry[3])],
          clientAddr: entry[4] ?? undefined,
          clientName: entry[5] ?? undefined,
        };
      }
      return null;
    }).filter((e): e is SlowLogEntry => e !== null);
  };

  // 加载慢查询日志
  const loadSlowLog = useCallback(async () => {
    setLoading(true);
    try {
      // 获取慢查询日志
      const result = await onExecute('SLOWLOG GET 500');
      if (result?.success && Array.isArray(result.data)) {
        const parsed = parseSlowLogEntries(result.data);
        setEntries(parsed);
      }

      // 获取当前阈值配置
      const configResult = await onExecute('CONFIG GET slowlog-log-slower-than');
      if (configResult?.success && Array.isArray(configResult.data) && configResult.data.length >= 2) {
        setSlowlogThreshold(parseInt(configResult.data[1], 10));
      }
    } catch (error) {
      console.error('Failed to load slowlog:', error);
      showToast(settings.language === 'zh-CN' ? '加载慢查询失败' : 'Failed to load slowlog', 'error');
    } finally {
      setLoading(false);
    }
  }, [onExecute, showToast, settings.language]);

  // 清空慢查询日志
  const handleReset = useCallback(async () => {
    try {
      const result = await onExecute('SLOWLOG RESET');
      if (result?.success) {
        setEntries([]);
        showToast(settings.language === 'zh-CN' ? '已清空慢查询日志' : 'Slowlog cleared', 'success');
      }
    } catch (error) {
      showToast(settings.language === 'zh-CN' ? '清空失败' : 'Failed to clear', 'error');
    }
  }, [onExecute, showToast, settings.language]);

  // 导出报告
  const handleExport = useCallback(() => {
    const stats = calculateStats(filteredEntries);
    const report = {
      exportTime: new Date().toISOString(),
      threshold: `${threshold / 1000}ms`,
      serverThreshold: slowlogThreshold ? `${slowlogThreshold}μs` : 'unknown',
      stats: {
        totalCount: stats.totalCount,
        avgDuration: `${(stats.avgDuration / 1000).toFixed(2)}ms`,
        maxDuration: `${(stats.maxDuration / 1000).toFixed(2)}ms`,
        minDuration: `${(stats.minDuration / 1000).toFixed(2)}ms`,
      },
      commandBreakdown: Object.entries(stats.commandBreakdown).map(([cmd, data]) => ({
        command: cmd,
        count: data.count,
        avgDuration: `${(data.totalDuration / data.count / 1000).toFixed(2)}ms`,
      })),
      entries: filteredEntries.map(e => ({
        id: e.id,
        time: new Date(e.timestamp * 1000).toISOString(),
        duration: `${(e.duration / 1000).toFixed(2)}ms`,
        command: e.command.join(' '),
      })),
    };

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `slowlog-report-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [entries, threshold, slowlogThreshold]);

  // 自动刷新
  useEffect(() => {
    if (isOpen && autoRefresh) {
      intervalRef.current = setInterval(loadSlowLog, refreshInterval);
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isOpen, autoRefresh, refreshInterval, loadSlowLog]);

  // 打开时加载
  useEffect(() => {
    if (isOpen) {
      loadSlowLog();
    }
  }, [isOpen, loadSlowLog]);

  // 过滤条目
  const filteredEntries = entries.filter(e => e.duration >= threshold);

  // 监听容器高度变化
  useEffect(() => {
    const updateHeight = () => {
      if (listContainerRef.current) {
        const height = listContainerRef.current.clientHeight;
        setListHeight(Math.max(100, height));
      }
    };

    updateHeight();
    window.addEventListener('resize', updateHeight);

    // 使用 ResizeObserver 监听容器大小变化
    const resizeObserver = new ResizeObserver(updateHeight);
    if (listContainerRef.current) {
      resizeObserver.observe(listContainerRef.current);
    }

    return () => {
      window.removeEventListener('resize', updateHeight);
      resizeObserver.disconnect();
    };
  }, [isOpen]);

  // 计算统计数据
  const calculateStats = (data: SlowLogEntry[]): SlowLogStats => {
    if (data.length === 0) {
      return {
        totalCount: 0,
        avgDuration: 0,
        maxDuration: 0,
        minDuration: 0,
        commandBreakdown: {},
        timeDistribution: TIME_RANGES.map(r => ({ ...r, count: 0 })),
      };
    }

    const durations = data.map(e => e.duration);
    const totalDuration = durations.reduce((a, b) => a + b, 0);
    const commandBreakdown: Record<string, { count: number; totalDuration: number }> = {};

    data.forEach(entry => {
      const cmd = entry.command[0]?.toUpperCase() || 'UNKNOWN';
      if (!commandBreakdown[cmd]) {
        commandBreakdown[cmd] = { count: 0, totalDuration: 0 };
      }
      commandBreakdown[cmd].count++;
      commandBreakdown[cmd].totalDuration += entry.duration;
    });

    const timeDistribution = TIME_RANGES.map(range => ({
      ...range,
      count: data.filter(e => e.duration >= range.min && e.duration < range.max).length,
    }));

    return {
      totalCount: data.length,
      avgDuration: totalDuration / data.length,
      maxDuration: Math.max(...durations),
      minDuration: Math.min(...durations),
      commandBreakdown,
      timeDistribution,
    };
  };

  const stats = calculateStats(filteredEntries);

  // 格式化时间
  const formatDuration = (us: number): string => {
    if (us < 1000) return `${us}μs`;
    if (us < 1000000) return `${(us / 1000).toFixed(1)}ms`;
    return `${(us / 1000000).toFixed(2)}s`;
  };

  const formatTimestamp = (ts: number): string => {
    return new Date(ts * 1000).toLocaleString();
  };

  // 命令统计排序
  const sortedCommands = Object.entries(stats.commandBreakdown)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10);

  const maxCommandCount = sortedCommands.length > 0 ? sortedCommands[0][1].count : 1;
  const maxDistCount = Math.max(...stats.timeDistribution.map(d => d.count), 1);

  // 虚拟列表行渲染
  const RowRenderer = ({ index, style }: { index: number; style: React.CSSProperties }) => {
    const entry = filteredEntries[index];
    return (
      <div style={style} className="table-row">
        <div className="col-id">{entry.id}</div>
        <div className="col-time">{formatTimestamp(entry.timestamp)}</div>
        <div className="col-duration">
          <span
            className="duration-badge"
            style={{
              backgroundColor: TIME_RANGES.find(r => entry.duration >= r.min && entry.duration < r.max)?.color || '#888',
            }}
          >
            {formatDuration(entry.duration)}
          </span>
        </div>
        <div className="col-command">
          <code>
            {entry.command.map((arg, i) => {
              const safeArg = typeof arg === 'string' ? arg : String(arg);
              const hasBinary = /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(safeArg);
              if (hasBinary) {
                return <span key={i} className="binary-arg">[binary:{safeArg.length}B]</span>;
              }
              const display = safeArg.length > 50 ? safeArg.substring(0, 50) + '...' : safeArg;
              return <span key={i}>{i > 0 ? ' ' : ''}{display}</span>;
            })}
          </code>
          {entry.clientAddr && (
            <span className="client-addr" title={entry.clientName || ''}>
              {entry.clientAddr}
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={<><Clock size={18} /> {settings.language === 'zh-CN' ? '慢查询分析' : 'Slow Log Analysis'}</>}
      width={900}
      height={700}
      minWidth={600}
      minHeight={500}
      className="slowlog-modal"
      storageKey="slowlog-panel"
    >
      <div className="slowlog-content">
        {/* 工具栏 */}
        <div className="slowlog-toolbar">
          <div className="toolbar-left">
            <label className="threshold-label">
              <Filter size={14} />
              {settings.language === 'zh-CN' ? '阈值:' : 'Threshold:'}
            </label>
            <input
              type="number"
              value={thresholdValue}
              onChange={e => setThresholdValue(e.target.value)}
              className="threshold-input"
              min="0"
              step="1"
              placeholder="0"
            />
            <select
              value={thresholdUnit}
              onChange={e => setThresholdUnit(e.target.value as 'μs' | 'ms' | 's')}
              className="threshold-unit"
            >
              <option value="μs">μs</option>
              <option value="ms">ms</option>
              <option value="s">s</option>
            </select>

            <label className="auto-refresh-label">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={e => setAutoRefresh(e.target.checked)}
              />
              {settings.language === 'zh-CN' ? '自动刷新' : 'Auto Refresh'}
            </label>
            {autoRefresh && (
              <select
                value={refreshInterval}
                onChange={e => setRefreshInterval(Number(e.target.value))}
                className="interval-select"
              >
                <option value={2000}>2s</option>
                <option value={5000}>5s</option>
                <option value={10000}>10s</option>
                <option value={30000}>30s</option>
              </select>
            )}
          </div>

          <div className="toolbar-right">
            <button className="toolbar-btn" onClick={loadSlowLog} disabled={loading} title={settings.language === 'zh-CN' ? '刷新' : 'Refresh'}>
              <RefreshCw size={22} className={loading ? 'spin' : ''} />
            </button>
            <button className="toolbar-btn" onClick={handleExport} disabled={filteredEntries.length === 0} title={settings.language === 'zh-CN' ? '导出' : 'Export'}>
              <Download size={22} />
            </button>
            <button className="toolbar-btn danger" onClick={handleReset} title={settings.language === 'zh-CN' ? '清空' : 'Clear'}>
              <Trash2 size={22} />
            </button>
          </div>
        </div>

        {/* 统计概览 */}
        <div className="slowlog-stats">
          <div className="stats-cards">
            <div className="stat-card">
              <div className="stat-value">{stats.totalCount}</div>
              <div className="stat-label">{settings.language === 'zh-CN' ? '总数' : 'Total'}</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{formatDuration(stats.avgDuration)}</div>
              <div className="stat-label">{settings.language === 'zh-CN' ? '平均耗时' : 'Avg Duration'}</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{formatDuration(stats.maxDuration)}</div>
              <div className="stat-label">{settings.language === 'zh-CN' ? '最大耗时' : 'Max Duration'}</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{slowlogThreshold !== null ? formatDuration(slowlogThreshold) : '-'}</div>
              <div className="stat-label">{settings.language === 'zh-CN' ? '服务器阈值' : 'Server Threshold'}</div>
            </div>
          </div>

          <div className="stats-charts">
            {/* 时间分布 */}
            <div className="chart-section">
              <h4>{settings.language === 'zh-CN' ? '耗时分布' : 'Duration Distribution'}</h4>
              <div className="bar-chart">
                {stats.timeDistribution.map((item, i) => (
                  <div key={i} className="bar-item">
                    <div className="bar-label">{item.range}</div>
                    <div className="bar-track">
                      <div
                        className="bar-fill"
                        style={{
                          width: `${(item.count / maxDistCount) * 100}%`,
                          backgroundColor: item.color,
                        }}
                      />
                    </div>
                    <div className="bar-value">{item.count}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* 命令统计 */}
            <div className="chart-section">
              <h4>{settings.language === 'zh-CN' ? '命令统计 (Top 10)' : 'Command Stats (Top 10)'}</h4>
              <div className="bar-chart">
                {sortedCommands.map(([cmd, data], i) => (
                  <div key={cmd} className="bar-item">
                    <div className="bar-label cmd">{cmd}</div>
                    <div className="bar-track">
                      <div
                        className="bar-fill"
                        style={{
                          width: `${(data.count / maxCommandCount) * 100}%`,
                          backgroundColor: `hsl(${210 + i * 15}, 70%, 50%)`,
                        }}
                      />
                    </div>
                    <div className="bar-value">
                      {data.count}
                      <small>({formatDuration(data.totalDuration / data.count)})</small>
                    </div>
                  </div>
                ))}
                {sortedCommands.length === 0 && (
                  <div className="empty-chart">{settings.language === 'zh-CN' ? '暂无数据' : 'No data'}</div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 慢查询列表 */}
        <div className="slowlog-list">
          <div className="list-header">
            <h4>{settings.language === 'zh-CN' ? '慢查询列表' : 'Slow Log Entries'}</h4>
            <span className="list-count">
              {filteredEntries.length} {settings.language === 'zh-CN' ? '条记录' : 'entries'}
            </span>
          </div>

          <div className="list-table">
            <div className="table-header">
              <div className="col-id">ID</div>
              <div className="col-time">{settings.language === 'zh-CN' ? '时间' : 'Time'}</div>
              <div className="col-duration">{settings.language === 'zh-CN' ? '耗时' : 'Duration'}</div>
              <div className="col-command">{settings.language === 'zh-CN' ? '命令' : 'Command'}</div>
            </div>
            <div className="table-body" ref={listContainerRef}>
              {filteredEntries.length > 0 ? (
                <List
                  height={listHeight}
                  itemCount={filteredEntries.length}
                  itemSize={42}
                  width="100%"
                >
                  {RowRenderer}
                </List>
              ) : (
                <div className="empty-list">
                  {settings.language === 'zh-CN' ? '暂无慢查询记录' : 'No slow log entries'}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default SlowLogPanel;
