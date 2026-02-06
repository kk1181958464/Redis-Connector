import { useState, useEffect, useCallback, useRef } from 'react';
import { Database, RefreshCw, Download, Trash2, Search, Square, Copy, Check } from 'lucide-react';
import { FixedSizeList as VirtualList } from 'react-window';
import { useSettings } from '../contexts/SettingsContext';
import { useToast } from './Toast';
import Modal from './Modal';
import ConfirmModal from './ConfirmModal';
import './BigKeyPanel.css';

interface BigKeyInfo {
  key: string;
  type: string;
  size: number;      // 字节
  elements: number;  // 元素数量
  ttl: number;
}

interface ScanProgress {
  scanned: number;
  total: number;     // 估算
  found: number;
  isScanning: boolean;
}

interface TypeDistribution {
  type: string;
  count: number;
  totalSize: number;
  color: string;
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

interface BigKeyPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onExecute: (command: string) => Promise<any>;
  onPipeline?: (commands: string[]) => Promise<any>;
}

function BigKeyPanel({ isOpen, onClose, onExecute, onPipeline }: BigKeyPanelProps) {
  const { settings } = useSettings();
  const { showToast } = useToast();
  const [bigKeys, setBigKeys] = useState<BigKeyInfo[]>([]);
  const [progress, setProgress] = useState<ScanProgress>({ scanned: 0, total: 0, found: 0, isScanning: false });
  const [thresholdValue, setThresholdValue] = useState('1');
  const [thresholdUnit, setThresholdUnit] = useState<'B' | 'KB' | 'MB'>('KB');
  const [pattern, setPattern] = useState('*');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<'size' | 'elements'>('size');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const scanAbortRef = useRef(false);
  const [totalMemory, setTotalMemory] = useState(0);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // 计算实际阈值（字节）
  const threshold = (() => {
    const value = parseFloat(thresholdValue) || 0;
    switch (thresholdUnit) {
      case 'B': return value;
      case 'KB': return value * 1024;
      case 'MB': return value * 1024 * 1024;
      default: return value;
    }
  })();

  // 复制 Key
  const handleCopyKey = useCallback(async (key: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(key);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
      showToast(settings.language === 'zh-CN' ? '已复制' : 'Copied', 'success');
    } catch {
      showToast(settings.language === 'zh-CN' ? '复制失败' : 'Copy failed', 'error');
    }
  }, [showToast, settings.language]);

  // 获取 key 的元素数量
  const getElementCount = async (key: string, type: string): Promise<number> => {
    try {
      let cmd = '';
      switch (type) {
        case 'string': cmd = `STRLEN "${key}"`; break;
        case 'list': cmd = `LLEN "${key}"`; break;
        case 'set': cmd = `SCARD "${key}"`; break;
        case 'zset': cmd = `ZCARD "${key}"`; break;
        case 'hash': cmd = `HLEN "${key}"`; break;
        case 'stream': cmd = `XLEN "${key}"`; break;
        default: return 0;
      }
      const result = await onExecute(cmd);
      return result?.success ? (result.data || 0) : 0;
    } catch {
      return 0;
    }
  };

  // 扫描大 Key
  const startScan = useCallback(async () => {
    scanAbortRef.current = false;
    setBigKeys([]);
    setSelectedKeys(new Set());
    setProgress({ scanned: 0, total: 0, found: 0, isScanning: true });

    try {
      // 获取总 key 数量估算
      const dbsizeResult = await onExecute('DBSIZE');
      const estimatedTotal = dbsizeResult?.success ? dbsizeResult.data : 0;
      setProgress(p => ({ ...p, total: estimatedTotal }));

      let cursor = '0';
      const foundKeys: BigKeyInfo[] = [];
      let scannedCount = 0;

      do {
        if (scanAbortRef.current) break;

        // SCAN 扫描
        const scanCmd = pattern === '*'
          ? `SCAN ${cursor} COUNT 200`
          : `SCAN ${cursor} MATCH "${pattern}" COUNT 200`;
        const scanResult = await onExecute(scanCmd);

        if (!scanResult?.success || !Array.isArray(scanResult.data)) break;

        cursor = String(scanResult.data[0]);
        const keys = scanResult.data[1] as string[];
        scannedCount += keys.length;

        if (keys.length === 0) {
          setProgress(p => ({ ...p, scanned: scannedCount }));
          continue;
        }

        // 使用 Pipeline 批量获取内存占用
        if (onPipeline && keys.length > 0) {
          const memCommands = keys.map(k => `MEMORY USAGE "${k}"`);
          const memResponse = await onPipeline(memCommands);
          const memResults = memResponse?.success ? memResponse.results : [];

          // 筛选出大 Key 的索引
          const bigKeyIndices: number[] = [];
          for (let i = 0; i < keys.length; i++) {
            const memResult = memResults?.[i];
            if (memResult?.success && memResult.data >= threshold) {
              bigKeyIndices.push(i);
            }
          }

          if (bigKeyIndices.length > 0) {
            // 批量获取类型和 TTL
            const typeCommands = bigKeyIndices.map(i => `TYPE "${keys[i]}"`);
            const ttlCommands = bigKeyIndices.map(i => `TTL "${keys[i]}"`);

            const [typeResponse, ttlResponse] = await Promise.all([
              onPipeline(typeCommands),
              onPipeline(ttlCommands)
            ]);

            const typeResults = typeResponse?.success ? typeResponse.results : [];
            const ttlResults = ttlResponse?.success ? ttlResponse.results : [];

            // 根据类型批量获取元素数量
            const lenCommands: string[] = [];
            const lenKeyMap: { idx: number; type: string }[] = [];

            for (let j = 0; j < bigKeyIndices.length; j++) {
              const type = typeResults?.[j]?.data || 'unknown';
              const key = keys[bigKeyIndices[j]];
              let cmd = '';

              switch (type) {
                case 'string': cmd = `STRLEN "${key}"`; break;
                case 'list': cmd = `LLEN "${key}"`; break;
                case 'set': cmd = `SCARD "${key}"`; break;
                case 'zset': cmd = `ZCARD "${key}"`; break;
                case 'hash': cmd = `HLEN "${key}"`; break;
                case 'stream': cmd = `XLEN "${key}"`; break;
              }

              if (cmd) {
                lenCommands.push(cmd);
                lenKeyMap.push({ idx: j, type });
              } else {
                // 无法获取元素数量的类型
                foundKeys.push({
                  key,
                  type,
                  size: memResults[bigKeyIndices[j]].data,
                  elements: 0,
                  ttl: ttlResults?.[j]?.data ?? -1
                });
              }
            }

            if (lenCommands.length > 0) {
              const lenResponse = await onPipeline(lenCommands);
              const lenResults = lenResponse?.success ? lenResponse.results : [];

              for (let k = 0; k < lenKeyMap.length; k++) {
                const { idx, type } = lenKeyMap[k];
                const origIdx = bigKeyIndices[idx];
                foundKeys.push({
                  key: keys[origIdx],
                  type,
                  size: memResults[origIdx].data,
                  elements: lenResults?.[k]?.success ? lenResults[k].data : 0,
                  ttl: ttlResults?.[idx]?.data ?? -1
                });
              }
            }

            setBigKeys([...foundKeys]);
          }
        } else {
          // 降级：逐个执行（无 Pipeline）
          for (const key of keys) {
            if (scanAbortRef.current) break;

            try {
              const memResult = await onExecute(`MEMORY USAGE "${key}"`);
              const size = memResult?.success ? (memResult.data || 0) : 0;

              if (size >= threshold) {
                const typeResult = await onExecute(`TYPE "${key}"`);
                const type = typeResult?.success ? typeResult.data : 'unknown';
                const elements = await getElementCount(key, type);
                const ttlResult = await onExecute(`TTL "${key}"`);
                const ttl = ttlResult?.success ? ttlResult.data : -1;

                foundKeys.push({ key, type, size, elements, ttl });
                setBigKeys([...foundKeys]);
              }
            } catch (e) {
              console.error(`Error processing key ${key}:`, e);
            }
          }
        }

        setProgress(p => ({
          ...p,
          scanned: scannedCount,
          found: foundKeys.length,
        }));

        // 小延迟避免阻塞 UI
        await new Promise(r => setTimeout(r, 5));

      } while (cursor !== '0');

      setProgress(p => ({ ...p, isScanning: false }));
      showToast(
        settings.language === 'zh-CN'
          ? `扫描完成，发现 ${foundKeys.length} 个大 Key`
          : `Scan complete, found ${foundKeys.length} big keys`,
        'success'
      );
    } catch (error) {
      console.error('Scan failed:', error);
      setProgress(p => ({ ...p, isScanning: false }));
      showToast(settings.language === 'zh-CN' ? '扫描失败' : 'Scan failed', 'error');
    }
  }, [onExecute, onPipeline, pattern, threshold, showToast, settings.language, getElementCount]);

  // 停止扫描
  const stopScan = useCallback(() => {
    scanAbortRef.current = true;
    setProgress(p => ({ ...p, isScanning: false }));
  }, []);

  // 删除选中的 Key
  const handleDelete = useCallback(async () => {
    if (selectedKeys.size === 0) return;

    try {
      const keysToDelete = Array.from(selectedKeys);

      if (onPipeline) {
        const commands = keysToDelete.map(k => `DEL "${k}"`);
        await onPipeline(commands);
      } else {
        for (const key of keysToDelete) {
          await onExecute(`DEL "${key}"`);
        }
      }

      setBigKeys(prev => prev.filter(k => !selectedKeys.has(k.key)));
      setSelectedKeys(new Set());
      setShowDeleteConfirm(false);
      showToast(
        settings.language === 'zh-CN'
          ? `已删除 ${keysToDelete.length} 个 Key`
          : `Deleted ${keysToDelete.length} keys`,
        'success'
      );
    } catch (error) {
      showToast(settings.language === 'zh-CN' ? '删除失败' : 'Delete failed', 'error');
    }
  }, [selectedKeys, onExecute, onPipeline, showToast, settings.language]);

  // 导出报告
  const handleExport = useCallback(() => {
    const report = {
      exportTime: new Date().toISOString(),
      threshold: formatSize(threshold),
      pattern,
      totalFound: bigKeys.length,
      totalSize: formatSize(bigKeys.reduce((sum, k) => sum + k.size, 0)),
      keys: bigKeys.map(k => ({
        key: k.key,
        type: k.type,
        size: formatSize(k.size),
        sizeBytes: k.size,
        elements: k.elements,
        ttl: k.ttl,
      })),
    };

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bigkeys-report-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [bigKeys, threshold, pattern]);

  // 计算类型分布
  const typeDistribution: TypeDistribution[] = (() => {
    const dist: Record<string, { count: number; totalSize: number }> = {};
    bigKeys.forEach(k => {
      if (!dist[k.type]) {
        dist[k.type] = { count: 0, totalSize: 0 };
      }
      dist[k.type].count++;
      dist[k.type].totalSize += k.size;
    });
    return Object.entries(dist)
      .map(([type, data]) => ({
        type,
        ...data,
        color: TYPE_COLORS[type] || TYPE_COLORS.other,
      }))
      .sort((a, b) => b.totalSize - a.totalSize);
  })();

  // 排序
  const sortedKeys = [...bigKeys].sort((a, b) => {
    const aVal = sortBy === 'size' ? a.size : a.elements;
    const bVal = sortBy === 'size' ? b.size : b.elements;
    return sortOrder === 'desc' ? bVal - aVal : aVal - bVal;
  });

  // 格式化大小
  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  };

  // 全选/取消全选
  const toggleSelectAll = () => {
    if (selectedKeys.size === bigKeys.length) {
      setSelectedKeys(new Set());
    } else {
      setSelectedKeys(new Set(bigKeys.map(k => k.key)));
    }
  };

  // 切换选择
  const toggleSelect = (key: string) => {
    const newSet = new Set(selectedKeys);
    if (newSet.has(key)) {
      newSet.delete(key);
    } else {
      newSet.add(key);
    }
    setSelectedKeys(newSet);
  };

  // 计算总内存
  useEffect(() => {
    setTotalMemory(bigKeys.reduce((sum, k) => sum + k.size, 0));
  }, [bigKeys]);

  // 关闭时停止扫描
  useEffect(() => {
    if (!isOpen) {
      scanAbortRef.current = true;
    }
  }, [isOpen]);

  const maxTypeSize = typeDistribution.length > 0 ? typeDistribution[0].totalSize : 1;

  // 虚拟列表行渲染
  const RowRenderer = ({ index, style }: { index: number; style: React.CSSProperties }) => {
    const item = sortedKeys[index];
    return (
      <div
        style={style}
        className={`table-row ${selectedKeys.has(item.key) ? 'selected' : ''}`}
        onClick={() => toggleSelect(item.key)}
      >
        <div className="col-checkbox" onClick={e => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selectedKeys.has(item.key)}
            onChange={() => toggleSelect(item.key)}
          />
        </div>
        <div className="col-key">
          <code title={item.key}>{item.key}</code>
          <button
            className={`copy-key-btn ${copiedKey === item.key ? 'copied' : ''}`}
            onClick={(e) => handleCopyKey(item.key, e)}
            title={settings.language === 'zh-CN' ? '复制 Key' : 'Copy Key'}
          >
            {copiedKey === item.key ? <Check size={12} /> : <Copy size={12} />}
          </button>
        </div>
        <div className="col-type">
          <span className="type-badge" style={{ backgroundColor: TYPE_COLORS[item.type] || TYPE_COLORS.other }}>
            {item.type}
          </span>
        </div>
        <div className="col-size">{formatSize(item.size)}</div>
        <div className="col-elements">{item.elements.toLocaleString()}</div>
        <div className="col-ttl">
          {item.ttl === -1 ? '∞' : item.ttl === -2 ? '-' : `${item.ttl}s`}
        </div>
      </div>
    );
  };

  // 列表容器引用
  const listContainerRef = useRef<HTMLDivElement>(null);
  const [listHeight, setListHeight] = useState(300);

  useEffect(() => {
    const updateHeight = () => {
      if (listContainerRef.current) {
        setListHeight(listContainerRef.current.clientHeight);
      }
    };
    updateHeight();
    window.addEventListener('resize', updateHeight);
    return () => window.removeEventListener('resize', updateHeight);
  }, []);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={<><Database size={18} /> {settings.language === 'zh-CN' ? '大 Key 分析' : 'Big Key Analysis'}</>}
      width={900}
      height={700}
      minWidth={600}
      minHeight={500}
      className="bigkey-modal"
      storageKey="bigkey-panel"
    >
      <div className="bigkey-content">
        {/* 工具栏 */}
        <div className="bigkey-toolbar">
          <div className="toolbar-left">
            <label className="threshold-label">
              {settings.language === 'zh-CN' ? '阈值:' : 'Threshold:'}
            </label>
            <input
              type="number"
              value={thresholdValue}
              onChange={e => setThresholdValue(e.target.value)}
              className="threshold-input"
              min="0"
              step="1"
              disabled={progress.isScanning}
            />
            <select
              value={thresholdUnit}
              onChange={e => setThresholdUnit(e.target.value as 'B' | 'KB' | 'MB')}
              className="threshold-unit"
              disabled={progress.isScanning}
            >
              <option value="B">B</option>
              <option value="KB">KB</option>
              <option value="MB">MB</option>
            </select>

            <label className="pattern-label">
              Pattern:
            </label>
            <input
              type="text"
              value={pattern}
              onChange={e => setPattern(e.target.value)}
              className="pattern-input"
              placeholder="*"
              disabled={progress.isScanning}
            />
          </div>

          <div className="toolbar-right">
            {/* 进度信息 */}
            {(progress.isScanning || progress.scanned > 0) && (
              <div className="toolbar-progress">
                <span className="progress-label">{settings.language === 'zh-CN' ? '扫描:' : 'Scan:'}</span>
                <span className="progress-text">
                  {progress.scanned.toLocaleString()} / {progress.total.toLocaleString()}
                </span>
                <div className="mini-progress-bar">
                  <div
                    className="mini-progress-fill"
                    style={{ width: progress.total > 0 ? `${(progress.scanned / progress.total) * 100}%` : '0%' }}
                  />
                </div>
              </div>
            )}
            {progress.isScanning ? (
              <button className="scan-btn stop" onClick={stopScan}>
                <Square size={14} />
                {settings.language === 'zh-CN' ? '停止' : 'Stop'}
              </button>
            ) : (
              <button className="scan-btn" onClick={startScan}>
                <Search size={14} />
                {settings.language === 'zh-CN' ? '开始扫描' : 'Start Scan'}
              </button>
            )}
          </div>
        </div>

        {/* 统计信息 */}
        <div className="bigkey-stats">
          <div className="stats-summary">
            <div className="summary-item">
              <span className="summary-label">{settings.language === 'zh-CN' ? '发现' : 'Found'}</span>
              <span className="summary-value">{progress.found}</span>
              <span className="summary-unit">{settings.language === 'zh-CN' ? '个大 Key' : 'big keys'}</span>
            </div>
            <div className="summary-item">
              <span className="summary-label">{settings.language === 'zh-CN' ? '总大小' : 'Total Size'}</span>
              <span className="summary-value">{formatSize(totalMemory)}</span>
            </div>
          </div>

          {/* 类型分布 */}
          <div className="type-distribution">
            <h4>{settings.language === 'zh-CN' ? '类型分布' : 'Type Distribution'}</h4>
            <div className="type-bars">
              {typeDistribution.map(item => (
                <div key={item.type} className="type-bar-item">
                  <div className="type-label">
                    <span className="type-dot" style={{ backgroundColor: item.color }} />
                    <span>{item.type}</span>
                  </div>
                  <div className="type-bar-track">
                    <div
                      className="type-bar-fill"
                      style={{
                        width: `${(item.totalSize / maxTypeSize) * 100}%`,
                        backgroundColor: item.color,
                      }}
                    />
                  </div>
                  <div className="type-value">
                    {formatSize(item.totalSize)}
                    <small>({item.count})</small>
                  </div>
                </div>
              ))}
              {typeDistribution.length === 0 && (
                <div className="empty-distribution">
                  {settings.language === 'zh-CN' ? '暂无数据' : 'No data'}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 大 Key 列表 */}
        <div className="bigkey-list">
          <div className="list-header">
            <div className="list-title">
              <h4>{settings.language === 'zh-CN' ? '大 Key 列表' : 'Big Key List'}</h4>
              <span className="list-count">{bigKeys.length} {settings.language === 'zh-CN' ? '条' : 'items'}</span>
            </div>
            <div className="list-actions">
              <select
                value={`${sortBy}-${sortOrder}`}
                onChange={e => {
                  const [by, order] = e.target.value.split('-');
                  setSortBy(by as 'size' | 'elements');
                  setSortOrder(order as 'asc' | 'desc');
                }}
                className="sort-select"
              >
                <option value="size-desc">{settings.language === 'zh-CN' ? '大小 ↓' : 'Size ↓'}</option>
                <option value="size-asc">{settings.language === 'zh-CN' ? '大小 ↑' : 'Size ↑'}</option>
                <option value="elements-desc">{settings.language === 'zh-CN' ? '元素数 ↓' : 'Elements ↓'}</option>
                <option value="elements-asc">{settings.language === 'zh-CN' ? '元素数 ↑' : 'Elements ↑'}</option>
              </select>
              <button
                className="action-btn"
                onClick={handleExport}
                disabled={bigKeys.length === 0}
                title={settings.language === 'zh-CN' ? '导出' : 'Export'}
              >
                <Download size={14} />
              </button>
              <button
                className="action-btn danger"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={selectedKeys.size === 0}
                title={settings.language === 'zh-CN' ? '删除选中' : 'Delete Selected'}
              >
                <Trash2 size={14} />
                {selectedKeys.size > 0 && <span className="delete-count">{selectedKeys.size}</span>}
              </button>
            </div>
          </div>

          <div className="list-table">
            <div className="table-header">
              <div className="col-checkbox">
                <input
                  type="checkbox"
                  checked={bigKeys.length > 0 && selectedKeys.size === bigKeys.length}
                  onChange={toggleSelectAll}
                />
              </div>
              <div className="col-key">Key</div>
              <div className="col-type">{settings.language === 'zh-CN' ? '类型' : 'Type'}</div>
              <div className="col-size">{settings.language === 'zh-CN' ? '大小' : 'Size'}</div>
              <div className="col-elements">{settings.language === 'zh-CN' ? '元素数' : 'Elements'}</div>
              <div className="col-ttl">TTL</div>
            </div>
            <div className="table-body" ref={listContainerRef}>
              {sortedKeys.length > 0 ? (
                <VirtualList
                  height={listHeight}
                  itemCount={sortedKeys.length}
                  itemSize={44}
                  width="100%"
                >
                  {RowRenderer}
                </VirtualList>
              ) : !progress.isScanning ? (
                <div className="empty-list">
                  {settings.language === 'zh-CN'
                    ? '点击"开始扫描"查找大 Key'
                    : 'Click "Start Scan" to find big keys'}
                </div>
              ) : (
                <div className="scanning-hint">
                  <RefreshCw size={20} className="spin" />
                  <span>{settings.language === 'zh-CN' ? '正在扫描...' : 'Scanning...'}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 删除确认弹窗 */}
      <ConfirmModal
        isOpen={showDeleteConfirm}
        onCancel={() => setShowDeleteConfirm(false)}
        onConfirm={handleDelete}
        title={settings.language === 'zh-CN' ? '确认删除' : 'Confirm Delete'}
        message={
          settings.language === 'zh-CN'
            ? `确定要删除选中的 ${selectedKeys.size} 个 Key 吗？此操作不可恢复。`
            : `Are you sure you want to delete ${selectedKeys.size} selected keys? This action cannot be undone.`
        }
        confirmText={settings.language === 'zh-CN' ? '删除' : 'Delete'}
        type="danger"
      />
    </Modal>
  );
}

export default BigKeyPanel;
