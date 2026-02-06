import { useState, useEffect, useCallback, useRef } from 'react';
import { HardDrive, CheckCircle, TrendingUp, TrendingDown, Square, RefreshCw } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import { useToast } from './Toast';
import Modal from './Modal';
import './MemoryAnalyzer.css';

interface MemoryOverview {
  used: number;
  peak: number;
  rss: number;
  fragmentation: number;
  maxmemory: number;
  policy: string;
  luaMemory: number;
  clients: number;
}

interface TypeDistribution {
  type: string;
  count: number;
  memory: number;
  percentage: number;
  color: string;
}

interface PrefixDistribution {
  prefix: string;
  count: number;
  memory: number;
}

interface MemoryAnalyzerProps {
  isOpen: boolean;
  onClose: () => void;
  onExecute: (command: string) => Promise<any>;
  onPipeline?: (commands: string[]) => Promise<any>;
}

const TYPE_COLORS: Record<string, string> = {
  string: '#3b82f6',
  hash: '#8b5cf6',
  list: '#22c55e',
  set: '#f59e0b',
  zset: '#ef4444',
  stream: '#06b6d4',
  other: '#6b7280',
};

// 格式化大小（组件外部定义，避免依赖问题）
const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

function MemoryAnalyzer({ isOpen, onClose, onExecute, onPipeline }: MemoryAnalyzerProps) {
  const { settings } = useSettings();
  const { showToast } = useToast();
  const [overview, setOverview] = useState<MemoryOverview | null>(null);
  const [typeDistribution, setTypeDistribution] = useState<TypeDistribution[]>([]);
  const [prefixDistribution, setPrefixDistribution] = useState<PrefixDistribution[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [sampleSizeValue, setSampleSizeValue] = useState('1000');
  const [analyzeProgress, setAnalyzeProgress] = useState({ sampled: 0, total: 0 });
  const analyzeAbortRef = useRef(false);

  // 计算实际采样数
  const sampleSize = Math.max(100, Math.min(50000, parseInt(sampleSizeValue) || 1000));

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

  // 加载内存概览
  const loadOverview = useCallback(async () => {
    try {
      const result = await onExecute('INFO memory');
      if (result?.success && result.data) {
        const info = parseInfo(result.data);

        const memOverview: MemoryOverview = {
          used: parseInt(info.used_memory || '0', 10),
          peak: parseInt(info.used_memory_peak || '0', 10),
          rss: parseInt(info.used_memory_rss || '0', 10),
          fragmentation: parseFloat(info.mem_fragmentation_ratio || '1'),
          maxmemory: parseInt(info.maxmemory || '0', 10),
          policy: info.maxmemory_policy || 'noeviction',
          luaMemory: parseInt(info.used_memory_lua || '0', 10),
          clients: parseInt(info.used_memory_clients || '0', 10),
        };

        setOverview(memOverview);
      }
    } catch (error) {
      console.error('Failed to load memory info:', error);
      showToast(settings.language === 'zh-CN' ? '加载内存信息失败' : 'Failed to load memory info', 'error');
    }
  }, [onExecute, showToast, settings.language]);

  // 采样分析
  const analyzeDistribution = useCallback(async () => {
    analyzeAbortRef.current = false;
    setAnalyzing(true);
    setTypeDistribution([]);
    setPrefixDistribution([]);
    setAnalyzeProgress({ sampled: 0, total: sampleSize });

    try {
      const typeCounts: Record<string, { count: number; memory: number }> = {};
      const prefixCounts: Record<string, { count: number; memory: number }> = {};
      let cursor = '0';
      let sampled = 0;

      do {
        if (analyzeAbortRef.current) break;

        const scanResult = await onExecute(`SCAN ${cursor} COUNT 200`);
        if (!scanResult?.success || !Array.isArray(scanResult.data)) break;

        cursor = String(scanResult.data[0]);
        const keys = scanResult.data[1] as string[];

        if (keys.length === 0) continue;

        // 限制本批次处理的 key 数量
        const keysToProcess = keys.slice(0, Math.min(keys.length, sampleSize - sampled));

        if (keysToProcess.length === 0) break;

        // 使用 Pipeline 批量获取类型和内存
        if (onPipeline) {
          const typeCommands = keysToProcess.map(k => `TYPE "${k}"`);
          const memCommands = keysToProcess.map(k => `MEMORY USAGE "${k}"`);

          const [typeResponse, memResponse] = await Promise.all([
            onPipeline(typeCommands),
            onPipeline(memCommands)
          ]);

          const typeResults = typeResponse?.success ? typeResponse.results : [];
          const memResults = memResponse?.success ? memResponse.results : [];

          for (let i = 0; i < keysToProcess.length; i++) {
            if (analyzeAbortRef.current) break;

            const key = keysToProcess[i];
            const type = typeResults[i]?.success ? typeResults[i].data : 'unknown';
            const memory = memResults[i]?.success ? (memResults[i].data || 0) : 0;

            // 统计类型
            if (!typeCounts[type]) {
              typeCounts[type] = { count: 0, memory: 0 };
            }
            typeCounts[type].count++;
            typeCounts[type].memory += memory;

            // 统计前缀（取第一个分隔符前的部分）
            const prefix = key.split(/[:\-_./]/)[0] || key;
            const prefixKey = prefix.length > 20 ? prefix.slice(0, 20) + '...' : prefix;
            if (!prefixCounts[prefixKey]) {
              prefixCounts[prefixKey] = { count: 0, memory: 0 };
            }
            prefixCounts[prefixKey].count++;
            prefixCounts[prefixKey].memory += memory;

            sampled++;
          }
        } else {
          // 降级：串行执行（兼容无 Pipeline 的情况）
          for (const key of keysToProcess) {
            if (analyzeAbortRef.current || sampled >= sampleSize) break;

            try {
              const typeResult = await onExecute(`TYPE "${key}"`);
              const type = typeResult?.success ? typeResult.data : 'unknown';

              const memResult = await onExecute(`MEMORY USAGE "${key}"`);
              const memory = memResult?.success ? (memResult.data || 0) : 0;

              if (!typeCounts[type]) {
                typeCounts[type] = { count: 0, memory: 0 };
              }
              typeCounts[type].count++;
              typeCounts[type].memory += memory;

              const prefix = key.split(/[:\-_./]/)[0] || key;
              const prefixKey = prefix.length > 20 ? prefix.slice(0, 20) + '...' : prefix;
              if (!prefixCounts[prefixKey]) {
                prefixCounts[prefixKey] = { count: 0, memory: 0 };
              }
              prefixCounts[prefixKey].count++;
              prefixCounts[prefixKey].memory += memory;

              sampled++;
            } catch (e) {
              console.error(`Error analyzing key ${key}:`, e);
            }
          }
        }

        setAnalyzeProgress({ sampled, total: sampleSize });

        if (sampled >= sampleSize) break;

      } while (cursor !== '0');

      // 计算类型分布
      const totalMemory = Object.values(typeCounts).reduce((sum, t) => sum + t.memory, 0);
      const typeDistribution: TypeDistribution[] = Object.entries(typeCounts)
        .map(([type, data]) => ({
          type,
          count: data.count,
          memory: data.memory,
          percentage: totalMemory > 0 ? (data.memory / totalMemory) * 100 : 0,
          color: TYPE_COLORS[type] || TYPE_COLORS.other,
        }))
        .sort((a, b) => b.memory - a.memory);

      setTypeDistribution(typeDistribution);

      // 计算前缀分布（Top 10）
      const prefixDistribution: PrefixDistribution[] = Object.entries(prefixCounts)
        .map(([prefix, data]) => ({
          prefix,
          count: data.count,
          memory: data.memory,
        }))
        .sort((a, b) => b.memory - a.memory)
        .slice(0, 10);

      setPrefixDistribution(prefixDistribution);

      if (!analyzeAbortRef.current) {
        showToast(
          settings.language === 'zh-CN'
            ? `分析完成，采样 ${sampled} 个 Key`
            : `Analysis complete, sampled ${sampled} keys`,
          'success'
        );
      }
    } catch (error) {
      console.error('Analysis failed:', error);
      showToast(settings.language === 'zh-CN' ? '分析失败' : 'Analysis failed', 'error');
    } finally {
      setAnalyzing(false);
    }
  }, [onExecute, onPipeline, sampleSize, showToast, settings.language]);

  // 停止分析
  const stopAnalyze = useCallback(() => {
    analyzeAbortRef.current = true;
    setAnalyzing(false);
    showToast(settings.language === 'zh-CN' ? '已停止分析' : 'Analysis stopped', 'info');
  }, [showToast, settings.language]);

  // 打开时加载
  useEffect(() => {
    if (isOpen) {
      loadOverview();
    }
  }, [isOpen, loadOverview]);

  // 关闭时停止分析
  useEffect(() => {
    if (!isOpen) {
      analyzeAbortRef.current = true;
    }
  }, [isOpen]);

  const maxPrefixMemory = prefixDistribution.length > 0 ? prefixDistribution[0].memory : 1;

  // 计算使用率
  const usagePercent = overview && overview.maxmemory > 0
    ? (overview.used / overview.maxmemory) * 100
    : 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={<><HardDrive size={18} /> {settings.language === 'zh-CN' ? '内存分析' : 'Memory Analysis'}</>}
      width={900}
      height={700}
      minWidth={600}
      minHeight={500}
      className="memory-modal"
      storageKey="memory-analyzer"
    >
      <div className="memory-content">
        {/* 工具栏 */}
        <div className="memory-toolbar">
          <div className="toolbar-right">
            {analyzing && (
              <div className="toolbar-progress">
                <span className="progress-label">
                  {settings.language === 'zh-CN' ? '进度:' : 'Progress:'}
                </span>
                <div className="mini-progress-bar">
                  <div
                    className="mini-progress-fill"
                    style={{ width: `${(analyzeProgress.sampled / analyzeProgress.total) * 100}%` }}
                  />
                </div>
              </div>
            )}
            <label className="sample-label">
              {settings.language === 'zh-CN' ? '采样数:' : 'Sample:'}
            </label>
            <input
              type="number"
              value={sampleSizeValue}
              onChange={e => setSampleSizeValue(e.target.value)}
              className="sample-input"
              min="100"
              max="50000"
              step="100"
              disabled={analyzing}
              placeholder="1000"
            />
            {analyzing ? (
              <button className="analyze-btn stop" onClick={stopAnalyze}>
                <Square size={14} />
                {settings.language === 'zh-CN' ? '停止' : 'Stop'}
              </button>
            ) : (
              <button className="analyze-btn" onClick={analyzeDistribution}>
                <TrendingUp size={14} />
                {settings.language === 'zh-CN' ? '采样分析' : 'Analyze'}
              </button>
            )}
          </div>
        </div>

        {/* 内存概览 */}
        {overview && (
          <div className="memory-overview">
            <div className="overview-cards">
              <div className="overview-card primary">
                <div className="card-icon">
                  <HardDrive size={24} />
                </div>
                <div className="card-content">
                  <div className="card-value">{formatSize(overview.used)}</div>
                  <div className="card-label">{settings.language === 'zh-CN' ? '已用内存' : 'Used Memory'}</div>
                </div>
                {overview.maxmemory > 0 && (
                  <div className="card-badge">
                    {usagePercent.toFixed(1)}%
                  </div>
                )}
              </div>

              <div className="overview-card">
                <div className="card-content">
                  <div className="card-value">{formatSize(overview.peak)}</div>
                  <div className="card-label">{settings.language === 'zh-CN' ? '峰值内存' : 'Peak Memory'}</div>
                </div>
              </div>

              <div className="overview-card">
                <div className="card-content">
                  <div className="card-value">{overview.fragmentation.toFixed(2)}</div>
                  <div className="card-label">{settings.language === 'zh-CN' ? '碎片率' : 'Fragmentation'}</div>
                </div>
                <div className={`card-status ${overview.fragmentation > 1.5 ? 'warning' : overview.fragmentation < 1 ? 'info' : 'success'}`}>
                  {overview.fragmentation > 1.5 ? (
                    <TrendingUp size={14} />
                  ) : overview.fragmentation < 1 ? (
                    <TrendingDown size={14} />
                  ) : (
                    <CheckCircle size={14} />
                  )}
                </div>
              </div>

              <div className="overview-card">
                <div className="card-content">
                  <div className="card-value">{overview.maxmemory > 0 ? formatSize(overview.maxmemory) : '∞'}</div>
                  <div className="card-label">{settings.language === 'zh-CN' ? '最大内存' : 'Max Memory'}</div>
                </div>
              </div>
            </div>

            {/* 使用率进度条 */}
            {overview.maxmemory > 0 && (
              <div className="usage-bar-container">
                <div className="usage-bar">
                  <div
                    className={`usage-fill ${usagePercent > 90 ? 'danger' : usagePercent > 75 ? 'warning' : ''}`}
                    style={{ width: `${Math.min(usagePercent, 100)}%` }}
                  />
                </div>
                <div className="usage-labels">
                  <span>{formatSize(overview.used)}</span>
                  <span>{overview.policy}</span>
                  <span>{formatSize(overview.maxmemory)}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 分布图表 */}
        <div className="memory-charts">
          {/* 类型分布 */}
          <div className="chart-section">
            <h4>{settings.language === 'zh-CN' ? '类型分布' : 'Type Distribution'}</h4>
            {typeDistribution.length > 0 ? (
              <>
                <div className="pie-chart">
                  <svg viewBox="0 0 100 100">
                    {(() => {
                      let currentAngle = 0;
                      return typeDistribution.map((item) => {
                        const angle = (item.percentage / 100) * 360;
                        const startAngle = currentAngle;
                        currentAngle += angle;

                        const startRad = (startAngle - 90) * Math.PI / 180;
                        const endRad = (currentAngle - 90) * Math.PI / 180;

                        const x1 = 50 + 40 * Math.cos(startRad);
                        const y1 = 50 + 40 * Math.sin(startRad);
                        const x2 = 50 + 40 * Math.cos(endRad);
                        const y2 = 50 + 40 * Math.sin(endRad);

                        const largeArc = angle > 180 ? 1 : 0;

                        return (
                          <path
                            key={item.type}
                            d={`M 50 50 L ${x1} ${y1} A 40 40 0 ${largeArc} 1 ${x2} ${y2} Z`}
                            fill={item.color}
                            stroke="var(--bg-primary)"
                            strokeWidth="1"
                          />
                        );
                      });
                    })()}
                  </svg>
                </div>
                <div className="chart-legend">
                  {typeDistribution.map(item => (
                    <div key={item.type} className="legend-item">
                      <span className="legend-dot" style={{ backgroundColor: item.color }} />
                      <span className="legend-label">{item.type}</span>
                      <span className="legend-value">{formatSize(item.memory)}</span>
                      <span className="legend-percent">{item.percentage.toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="empty-chart">
                {analyzing ? (
                  <>
                    <RefreshCw size={20} className="spin" />
                    <span>{settings.language === 'zh-CN' ? '分析中...' : 'Analyzing...'}</span>
                  </>
                ) : (
                  settings.language === 'zh-CN' ? '点击"采样分析"获取分布数据' : 'Click "Analyze" to get distribution data'
                )}
              </div>
            )}
          </div>

          {/* 前缀分布 */}
          <div className="chart-section">
            <h4>{settings.language === 'zh-CN' ? '前缀分布 (Top 10)' : 'Prefix Distribution (Top 10)'}</h4>
            {prefixDistribution.length > 0 ? (
              <div className="bar-chart">
                {prefixDistribution.map((item, i) => (
                  <div key={item.prefix} className="bar-item">
                    <div className="bar-label">{item.prefix}*</div>
                    <div className="bar-track">
                      <div
                        className="bar-fill"
                        style={{
                          width: `${(item.memory / maxPrefixMemory) * 100}%`,
                          backgroundColor: `hsl(${210 + i * 15}, 70%, 50%)`,
                        }}
                      />
                    </div>
                    <div className="bar-value">
                      {formatSize(item.memory)}
                      <small>({item.count})</small>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-chart">
                {analyzing ? (
                  <>
                    <RefreshCw size={20} className="spin" />
                    <span>{settings.language === 'zh-CN' ? '分析中...' : 'Analyzing...'}</span>
                  </>
                ) : (
                  settings.language === 'zh-CN' ? '点击"采样分析"获取分布数据' : 'Click "Analyze" to get distribution data'
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default MemoryAnalyzer;
