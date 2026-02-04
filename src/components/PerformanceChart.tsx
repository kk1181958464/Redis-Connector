import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Activity, RefreshCw, Pause, Play } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import './PerformanceChart.css';

interface PerformanceChartProps {
  isOpen: boolean;
  onClose: () => void;
  onExecute: (command: string) => Promise<any>;
}

interface MetricPoint {
  timestamp: number;
  value: number;
}

interface Metrics {
  ops: MetricPoint[];           // 每秒操作数
  memory: MetricPoint[];        // 内存使用
  clients: MetricPoint[];       // 连接数
  cpu: MetricPoint[];           // CPU 使用率
  hitRate: MetricPoint[];       // 缓存命中率
  networkIn: MetricPoint[];     // 网络输入
  networkOut: MetricPoint[];    // 网络输出
}

const MAX_POINTS = 60; // 保留最近 60 个数据点

function PerformanceChart({ isOpen, onClose, onExecute }: PerformanceChartProps) {
  const { settings } = useSettings();
  const [metrics, setMetrics] = useState<Metrics>({
    ops: [],
    memory: [],
    clients: [],
    cpu: [],
    hitRate: [],
    networkIn: [],
    networkOut: [],
  });
  const [isPaused, setIsPaused] = useState(false);
  const [interval, setIntervalValue] = useState(1000); // 刷新间隔
  const [activeMetric, setActiveMetric] = useState<keyof Metrics>('ops');
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const prevStatsRef = useRef<any>(null);

  // 解析 INFO 命令结果
  const parseInfo = (infoStr: string): Record<string, string> => {
    const result: Record<string, string> = {};
    const lines = infoStr.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const colonIndex = trimmed.indexOf(':');
      if (colonIndex > 0) {
        const key = trimmed.slice(0, colonIndex);
        const value = trimmed.slice(colonIndex + 1);
        result[key] = value;
      }
    }
    return result;
  };

  // 获取性能数据
  const fetchMetrics = useCallback(async () => {
    try {
      const result = await onExecute('INFO');
      if (!result?.success || !result.data) return;

      const info = parseInfo(result.data);
      const now = Date.now();

      // 计算每秒操作数（需要与上次数据对比）
      const totalCommands = parseInt(info.total_commands_processed || '0', 10);
      let opsPerSec = 0;
      if (prevStatsRef.current) {
        const timeDiff = (now - prevStatsRef.current.timestamp) / 1000;
        const cmdDiff = totalCommands - prevStatsRef.current.totalCommands;
        opsPerSec = Math.round(cmdDiff / timeDiff);
      }

      // 计算缓存命中率
      const hits = parseInt(info.keyspace_hits || '0', 10);
      const misses = parseInt(info.keyspace_misses || '0', 10);
      const hitRate = hits + misses > 0 ? (hits / (hits + misses)) * 100 : 0;

      // 网络流量
      const networkIn = parseInt(info.total_net_input_bytes || '0', 10);
      const networkOut = parseInt(info.total_net_output_bytes || '0', 10);
      let netInPerSec = 0;
      let netOutPerSec = 0;
      if (prevStatsRef.current) {
        const timeDiff = (now - prevStatsRef.current.timestamp) / 1000;
        netInPerSec = Math.round((networkIn - prevStatsRef.current.networkIn) / timeDiff);
        netOutPerSec = Math.round((networkOut - prevStatsRef.current.networkOut) / timeDiff);
      }

      // 保存当前数据用于下次计算
      prevStatsRef.current = {
        timestamp: now,
        totalCommands,
        networkIn,
        networkOut,
      };

      // 更新指标
      setMetrics(prev => {
        const addPoint = (arr: MetricPoint[], value: number): MetricPoint[] => {
          const newArr = [...arr, { timestamp: now, value }];
          return newArr.slice(-MAX_POINTS);
        };

        return {
          ops: addPoint(prev.ops, opsPerSec),
          memory: addPoint(prev.memory, parseInt(info.used_memory || '0', 10) / (1024 * 1024)), // MB
          clients: addPoint(prev.clients, parseInt(info.connected_clients || '0', 10)),
          cpu: addPoint(prev.cpu, parseFloat(info.used_cpu_sys || '0') + parseFloat(info.used_cpu_user || '0')),
          hitRate: addPoint(prev.hitRate, hitRate),
          networkIn: addPoint(prev.networkIn, netInPerSec / 1024), // KB/s
          networkOut: addPoint(prev.networkOut, netOutPerSec / 1024), // KB/s
        };
      });
    } catch (err) {
      console.error('Failed to fetch metrics:', err);
    }
  }, [onExecute]);

  // 启动/停止定时器
  useEffect(() => {
    if (isOpen && !isPaused) {
      fetchMetrics(); // 立即获取一次
      intervalRef.current = setInterval(fetchMetrics, interval);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isOpen, isPaused, interval, fetchMetrics]);

  // 关闭时重置
  useEffect(() => {
    if (!isOpen) {
      setMetrics({
        ops: [],
        memory: [],
        clients: [],
        cpu: [],
        hitRate: [],
        networkIn: [],
        networkOut: [],
      });
      prevStatsRef.current = null;
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const metricConfigs: Record<keyof Metrics, { label: string; unit: string; color: string }> = {
    ops: { label: settings.language === 'zh-CN' ? '操作数/秒' : 'Ops/sec', unit: '', color: '#3b82f6' },
    memory: { label: settings.language === 'zh-CN' ? '内存使用' : 'Memory', unit: 'MB', color: '#8b5cf6' },
    clients: { label: settings.language === 'zh-CN' ? '连接数' : 'Clients', unit: '', color: '#22c55e' },
    cpu: { label: 'CPU', unit: 's', color: '#f59e0b' },
    hitRate: { label: settings.language === 'zh-CN' ? '命中率' : 'Hit Rate', unit: '%', color: '#06b6d4' },
    networkIn: { label: settings.language === 'zh-CN' ? '网络入' : 'Net In', unit: 'KB/s', color: '#ec4899' },
    networkOut: { label: settings.language === 'zh-CN' ? '网络出' : 'Net Out', unit: 'KB/s', color: '#f97316' },
  };

  const currentMetric = metricConfigs[activeMetric];
  const currentData = metrics[activeMetric];

  // 计算图表数据
  const maxValue = Math.max(...currentData.map(p => p.value), 1);
  const latestValue = currentData.length > 0 ? currentData[currentData.length - 1].value : 0;

  // 生成 SVG 路径
  const generatePath = (data: MetricPoint[], width: number, height: number): string => {
    if (data.length < 2) return '';
    const max = Math.max(...data.map(p => p.value), 1);
    const points = data.map((point, i) => {
      const x = (i / (MAX_POINTS - 1)) * width;
      const y = height - (point.value / max) * height;
      return `${x},${y}`;
    });
    return `M ${points.join(' L ')}`;
  };

  // 生成填充区域路径
  const generateAreaPath = (data: MetricPoint[], width: number, height: number): string => {
    if (data.length < 2) return '';
    const max = Math.max(...data.map(p => p.value), 1);
    const points = data.map((point, i) => {
      const x = (i / (MAX_POINTS - 1)) * width;
      const y = height - (point.value / max) * height;
      return `${x},${y}`;
    });
    return `M 0,${height} L ${points.join(' L ')} L ${width},${height} Z`;
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="performance-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>
            <Activity size={20} />
            {settings.language === 'zh-CN' ? '性能监控' : 'Performance Monitor'}
          </h2>
          <div className="header-actions">
            <select
              value={interval}
              onChange={e => setIntervalValue(Number(e.target.value))}
              className="interval-select"
            >
              <option value={500}>500ms</option>
              <option value={1000}>1s</option>
              <option value={2000}>2s</option>
              <option value={5000}>5s</option>
            </select>
            <button
              className={`control-btn ${isPaused ? 'paused' : ''}`}
              onClick={() => setIsPaused(!isPaused)}
              title={isPaused ? 'Resume' : 'Pause'}
            >
              {isPaused ? <Play size={16} /> : <Pause size={16} />}
            </button>
            <button className="close-btn" onClick={onClose}>
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="modal-body">
          {/* 指标选择器 */}
          <div className="metric-tabs">
            {(Object.keys(metricConfigs) as (keyof Metrics)[]).map(key => (
              <button
                key={key}
                className={`metric-tab ${activeMetric === key ? 'active' : ''}`}
                onClick={() => setActiveMetric(key)}
                style={{ '--tab-color': metricConfigs[key].color } as React.CSSProperties}
              >
                <span className="metric-label">{metricConfigs[key].label}</span>
                <span className="metric-value">
                  {metrics[key].length > 0
                    ? metrics[key][metrics[key].length - 1].value.toFixed(key === 'hitRate' ? 1 : 0)
                    : '-'}
                  <small>{metricConfigs[key].unit}</small>
                </span>
              </button>
            ))}
          </div>

          {/* 图表区域 */}
          <div className="chart-container">
            <div className="chart-header">
              <span className="chart-title">{currentMetric.label}</span>
              <span className="chart-value" style={{ color: currentMetric.color }}>
                {latestValue.toFixed(activeMetric === 'hitRate' ? 1 : 0)} {currentMetric.unit}
              </span>
            </div>
            <div className="chart-wrapper">
              <svg viewBox="0 0 600 200" preserveAspectRatio="none" className="chart-svg">
                {/* 网格线 */}
                <g className="grid-lines">
                  {[0, 1, 2, 3, 4].map(i => (
                    <line
                      key={i}
                      x1="0"
                      y1={i * 50}
                      x2="600"
                      y2={i * 50}
                      stroke="var(--border)"
                      strokeDasharray="4,4"
                    />
                  ))}
                </g>
                {/* 填充区域 */}
                <path
                  d={generateAreaPath(currentData, 600, 200)}
                  fill={currentMetric.color}
                  fillOpacity="0.1"
                />
                {/* 线条 */}
                <path
                  d={generatePath(currentData, 600, 200)}
                  fill="none"
                  stroke={currentMetric.color}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {/* Y 轴标签 */}
              <div className="y-axis-labels">
                <span>{maxValue.toFixed(0)}</span>
                <span>{(maxValue / 2).toFixed(0)}</span>
                <span>0</span>
              </div>
            </div>
            <div className="chart-footer">
              <span>{settings.language === 'zh-CN' ? '最近 60 秒' : 'Last 60 seconds'}</span>
              {isPaused && (
                <span className="paused-indicator">
                  {settings.language === 'zh-CN' ? '已暂停' : 'Paused'}
                </span>
              )}
            </div>
          </div>

          {/* 快速统计 */}
          <div className="quick-stats">
            <div className="stat-item">
              <span className="stat-label">{settings.language === 'zh-CN' ? '最大值' : 'Max'}</span>
              <span className="stat-value">
                {currentData.length > 0 ? Math.max(...currentData.map(p => p.value)).toFixed(0) : '-'}
              </span>
            </div>
            <div className="stat-item">
              <span className="stat-label">{settings.language === 'zh-CN' ? '最小值' : 'Min'}</span>
              <span className="stat-value">
                {currentData.length > 0 ? Math.min(...currentData.map(p => p.value)).toFixed(0) : '-'}
              </span>
            </div>
            <div className="stat-item">
              <span className="stat-label">{settings.language === 'zh-CN' ? '平均值' : 'Avg'}</span>
              <span className="stat-value">
                {currentData.length > 0
                  ? (currentData.reduce((sum, p) => sum + p.value, 0) / currentData.length).toFixed(0)
                  : '-'}
              </span>
            </div>
            <div className="stat-item">
              <span className="stat-label">{settings.language === 'zh-CN' ? '数据点' : 'Points'}</span>
              <span className="stat-value">{currentData.length}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PerformanceChart;
