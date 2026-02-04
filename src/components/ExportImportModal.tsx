import { useState, useCallback } from 'react';
import { X, Download, Upload, FileJson, Terminal, FileSpreadsheet, AlertTriangle } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import './ExportImportModal.css';

type ExportFormat = 'json' | 'redis' | 'csv';
type ModalMode = 'export' | 'import';
type ConflictStrategy = 'skip' | 'overwrite' | 'rename';

interface KeyInfo {
  key: string;
  type: string;
  ttl: number;
}

interface ExportImportModalProps {
  isOpen: boolean;
  mode: ModalMode;
  onClose: () => void;
  onExecute: (command: string) => Promise<any>;
  keys: KeyInfo[];
  onSuccess: () => void;
}

interface ExportedKey {
  key: string;
  type: string;
  ttl: number;
  value: any;
}

function ExportImportModal({ isOpen, mode, onClose, onExecute, keys, onSuccess }: ExportImportModalProps) {
  const { settings } = useSettings();
  const [format, setFormat] = useState<ExportFormat>('json');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [importData, setImportData] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [conflictStrategy, setConflictStrategy] = useState<ConflictStrategy>('skip');
  const [importStats, setImportStats] = useState<{ imported: number; skipped: number; renamed: number } | null>(null);

  // 获取 Key 的值
  const getKeyValue = async (key: string, type: string): Promise<any> => {
    let result;
    switch (type) {
      case 'string':
        result = await onExecute(`GET "${key}"`);
        return result?.data;
      case 'hash':
        result = await onExecute(`HGETALL "${key}"`);
        if (result?.data && Array.isArray(result.data)) {
          const obj: Record<string, string> = {};
          for (let i = 0; i < result.data.length; i += 2) {
            obj[result.data[i]] = result.data[i + 1];
          }
          return obj;
        }
        return result?.data;
      case 'list':
        result = await onExecute(`LRANGE "${key}" 0 -1`);
        return result?.data;
      case 'set':
        result = await onExecute(`SMEMBERS "${key}"`);
        return result?.data;
      case 'zset':
        result = await onExecute(`ZRANGE "${key}" 0 -1 WITHSCORES`);
        if (result?.data && Array.isArray(result.data)) {
          const pairs: { member: string; score: number }[] = [];
          for (let i = 0; i < result.data.length; i += 2) {
            pairs.push({ member: result.data[i], score: parseFloat(result.data[i + 1]) });
          }
          return pairs;
        }
        return result?.data;
      default:
        return null;
    }
  };

  // 导出为 JSON
  const exportAsJson = async () => {
    setLoading(true);
    setProgress(0);
    setError(null);

    try {
      const exportedKeys: ExportedKey[] = [];
      for (let i = 0; i < keys.length; i++) {
        const { key, type, ttl } = keys[i];
        const value = await getKeyValue(key, type);
        exportedKeys.push({ key, type, ttl, value });
        setProgress(Math.round(((i + 1) / keys.length) * 100));
      }

      const jsonStr = JSON.stringify(exportedKeys, null, 2);
      downloadFile(jsonStr, 'redis-export.json', 'application/json');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  // 导出为 Redis 命令
  const exportAsRedis = async () => {
    setLoading(true);
    setProgress(0);
    setError(null);

    try {
      const commands: string[] = [];
      for (let i = 0; i < keys.length; i++) {
        const { key, type, ttl } = keys[i];
        const value = await getKeyValue(key, type);

        // 生成 Redis 命令
        switch (type) {
          case 'string':
            commands.push(`SET "${key}" "${String(value).replace(/"/g, '\\"')}"`);
            break;
          case 'hash':
            if (value && typeof value === 'object') {
              for (const [field, val] of Object.entries(value)) {
                commands.push(`HSET "${key}" "${field}" "${String(val).replace(/"/g, '\\"')}"`);
              }
            }
            break;
          case 'list':
            if (Array.isArray(value)) {
              for (const item of value) {
                commands.push(`RPUSH "${key}" "${String(item).replace(/"/g, '\\"')}"`);
              }
            }
            break;
          case 'set':
            if (Array.isArray(value)) {
              for (const item of value) {
                commands.push(`SADD "${key}" "${String(item).replace(/"/g, '\\"')}"`);
              }
            }
            break;
          case 'zset':
            if (Array.isArray(value)) {
              for (const item of value) {
                commands.push(`ZADD "${key}" ${item.score} "${String(item.member).replace(/"/g, '\\"')}"`);
              }
            }
            break;
        }

        // TTL 命令
        if (ttl > 0) {
          commands.push(`EXPIRE "${key}" ${ttl}`);
        }

        setProgress(Math.round(((i + 1) / keys.length) * 100));
      }

      downloadFile(commands.join('\n'), 'redis-export.txt', 'text/plain');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  // CSV 转义函数
  const escapeCsvValue = (value: string): string => {
    if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  };

  // 导出为 CSV
  const exportAsCsv = async () => {
    setLoading(true);
    setProgress(0);
    setError(null);

    try {
      const rows: string[] = [];
      // CSV 头部
      rows.push('Key,Type,TTL,Value');

      for (let i = 0; i < keys.length; i++) {
        const { key, type, ttl } = keys[i];
        const value = await getKeyValue(key, type);

        // 将值转换为字符串
        let valueStr: string;
        if (type === 'string') {
          valueStr = String(value ?? '');
        } else if (type === 'hash' && typeof value === 'object') {
          valueStr = JSON.stringify(value);
        } else if (Array.isArray(value)) {
          valueStr = JSON.stringify(value);
        } else {
          valueStr = String(value ?? '');
        }

        // 构建 CSV 行
        const row = [
          escapeCsvValue(key),
          escapeCsvValue(type),
          String(ttl),
          escapeCsvValue(valueStr)
        ].join(',');

        rows.push(row);
        setProgress(Math.round(((i + 1) / keys.length) * 100));
      }

      // 添加 BOM 以支持 Excel 正确识别 UTF-8
      const bom = '\uFEFF';
      downloadFile(bom + rows.join('\n'), 'redis-export.csv', 'text/csv;charset=utf-8');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  // 下载文件
  const downloadFile = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // 导出
  const handleExport = () => {
    if (format === 'json') {
      exportAsJson();
    } else if (format === 'csv') {
      exportAsCsv();
    } else {
      exportAsRedis();
    }
  };

  // 检查 Key 是否存在
  const checkKeyExists = async (key: string): Promise<boolean> => {
    const result = await onExecute(`EXISTS "${key}"`);
    return result?.success && result.data === 1;
  };

  // 生成唯一的 Key 名称（用于重命名策略）
  const generateUniqueKey = async (baseKey: string): Promise<string> => {
    let suffix = 1;
    let newKey = `${baseKey}_imported_${suffix}`;
    while (await checkKeyExists(newKey)) {
      suffix++;
      newKey = `${baseKey}_imported_${suffix}`;
      if (suffix > 100) break; // 防止无限循环
    }
    return newKey;
  };

  // 导入单个 Key
  const importSingleKey = async (key: string, type: string, ttl: number, value: any): Promise<void> => {
    switch (type) {
      case 'string':
        await onExecute(`SET "${key}" "${String(value).replace(/"/g, '\\"')}"`);
        break;
      case 'hash':
        if (value && typeof value === 'object') {
          await onExecute(`DEL "${key}"`);
          for (const [field, val] of Object.entries(value)) {
            await onExecute(`HSET "${key}" "${field}" "${String(val).replace(/"/g, '\\"')}"`);
          }
        }
        break;
      case 'list':
        if (Array.isArray(value)) {
          await onExecute(`DEL "${key}"`);
          for (const item of value) {
            await onExecute(`RPUSH "${key}" "${String(item).replace(/"/g, '\\"')}"`);
          }
        }
        break;
      case 'set':
        if (Array.isArray(value)) {
          await onExecute(`DEL "${key}"`);
          for (const item of value) {
            await onExecute(`SADD "${key}" "${String(item).replace(/"/g, '\\"')}"`);
          }
        }
        break;
      case 'zset':
        if (Array.isArray(value)) {
          await onExecute(`DEL "${key}"`);
          for (const item of value) {
            const score = item.score ?? 0;
            const member = item.member ?? item;
            await onExecute(`ZADD "${key}" ${score} "${String(member).replace(/"/g, '\\"')}"`);
          }
        }
        break;
    }

    // 设置 TTL
    if (ttl > 0) {
      await onExecute(`EXPIRE "${key}" ${ttl}`);
    }
  };

  // 导入
  const handleImport = async () => {
    if (!importData.trim()) {
      setError(settings.language === 'zh-CN' ? '请输入导入数据' : 'Please enter import data');
      return;
    }

    setLoading(true);
    setProgress(0);
    setError(null);
    setImportStats(null);

    const stats = { imported: 0, skipped: 0, renamed: 0 };

    try {
      if (format === 'json') {
        // JSON 格式导入
        const data: ExportedKey[] = JSON.parse(importData);

        for (let i = 0; i < data.length; i++) {
          const { key, type, ttl, value } = data[i];
          const exists = await checkKeyExists(key);

          if (exists) {
            switch (conflictStrategy) {
              case 'skip':
                stats.skipped++;
                break;
              case 'overwrite':
                await importSingleKey(key, type, ttl, value);
                stats.imported++;
                break;
              case 'rename':
                const newKey = await generateUniqueKey(key);
                await importSingleKey(newKey, type, ttl, value);
                stats.renamed++;
                stats.imported++;
                break;
            }
          } else {
            await importSingleKey(key, type, ttl, value);
            stats.imported++;
          }

          setProgress(Math.round(((i + 1) / data.length) * 100));
        }
      } else {
        // Redis 命令格式导入（无法检测冲突，直接执行）
        const commands = importData.split('\n').filter(cmd => cmd.trim());
        for (let i = 0; i < commands.length; i++) {
          await onExecute(commands[i].trim());
          stats.imported++;
          setProgress(Math.round(((i + 1) / commands.length) * 100));
        }
      }

      setImportStats(stats);
      onSuccess();

      // 延迟关闭以显示统计信息
      setTimeout(() => {
        onClose();
        setImportStats(null);
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  // 文件选择
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      setImportData(event.target?.result as string || '');
    };
    reader.readAsText(file);
  }, []);

  if (!isOpen) return null;

  const isExport = mode === 'export';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="export-import-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>
            {isExport
              ? (settings.language === 'zh-CN' ? '导出 Keys' : 'Export Keys')
              : (settings.language === 'zh-CN' ? '导入 Keys' : 'Import Keys')}
          </h2>
          <button className="close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="form-error">{error}</div>}

          {/* 格式选择 */}
          <div className="form-group">
            <label>{settings.language === 'zh-CN' ? '格式' : 'Format'}</label>
            <div className="format-options">
              <button
                type="button"
                className={`format-option ${format === 'json' ? 'active' : ''}`}
                onClick={() => setFormat('json')}
              >
                <FileJson size={18} />
                <span>JSON</span>
              </button>
              {isExport && (
                <button
                  type="button"
                  className={`format-option ${format === 'csv' ? 'active' : ''}`}
                  onClick={() => setFormat('csv')}
                >
                  <FileSpreadsheet size={18} />
                  <span>CSV</span>
                </button>
              )}
              <button
                type="button"
                className={`format-option ${format === 'redis' ? 'active' : ''}`}
                onClick={() => setFormat('redis')}
              >
                <Terminal size={18} />
                <span>Redis Commands</span>
              </button>
            </div>
          </div>

          {isExport ? (
            <>
              <div className="export-info">
                <p>
                  {settings.language === 'zh-CN'
                    ? `将导出当前列表中的 ${keys.length} 个 Key`
                    : `Will export ${keys.length} keys from current list`}
                </p>
              </div>
            </>
          ) : (
            <>
              {/* 冲突处理策略（仅 JSON 格式） */}
              {format === 'json' && (
                <div className="form-group">
                  <label>
                    <AlertTriangle size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                    {settings.language === 'zh-CN' ? 'Key 冲突处理' : 'Conflict Resolution'}
                  </label>
                  <div className="conflict-options">
                    <label className="radio-option">
                      <input
                        type="radio"
                        name="conflict"
                        value="skip"
                        checked={conflictStrategy === 'skip'}
                        onChange={() => setConflictStrategy('skip')}
                      />
                      <span className="radio-label">
                        {settings.language === 'zh-CN' ? '跳过已存在' : 'Skip existing'}
                      </span>
                      <span className="radio-desc">
                        {settings.language === 'zh-CN' ? '保留原有数据' : 'Keep original data'}
                      </span>
                    </label>
                    <label className="radio-option">
                      <input
                        type="radio"
                        name="conflict"
                        value="overwrite"
                        checked={conflictStrategy === 'overwrite'}
                        onChange={() => setConflictStrategy('overwrite')}
                      />
                      <span className="radio-label">
                        {settings.language === 'zh-CN' ? '覆盖已存在' : 'Overwrite existing'}
                      </span>
                      <span className="radio-desc">
                        {settings.language === 'zh-CN' ? '用导入数据替换' : 'Replace with imported data'}
                      </span>
                    </label>
                    <label className="radio-option">
                      <input
                        type="radio"
                        name="conflict"
                        value="rename"
                        checked={conflictStrategy === 'rename'}
                        onChange={() => setConflictStrategy('rename')}
                      />
                      <span className="radio-label">
                        {settings.language === 'zh-CN' ? '重命名导入' : 'Rename imported'}
                      </span>
                      <span className="radio-desc">
                        {settings.language === 'zh-CN' ? '添加后缀 _imported_N' : 'Add suffix _imported_N'}
                      </span>
                    </label>
                  </div>
                </div>
              )}

              <div className="form-group">
                <label>{settings.language === 'zh-CN' ? '选择文件' : 'Select File'}</label>
                <input
                  type="file"
                  accept={format === 'json' ? '.json' : '.txt'}
                  onChange={handleFileSelect}
                  className="file-input"
                />
              </div>
              <div className="form-group">
                <label>{settings.language === 'zh-CN' ? '或粘贴数据' : 'Or Paste Data'}</label>
                <textarea
                  value={importData}
                  onChange={e => setImportData(e.target.value)}
                  placeholder={format === 'json'
                    ? '[{"key": "...", "type": "string", "ttl": -1, "value": "..."}]'
                    : 'SET key value\nHSET hash field value\n...'}
                  rows={8}
                />
              </div>
            </>
          )}

          {/* 导入统计 */}
          {importStats && (
            <div className="import-stats">
              <div className="stats-title">
                {settings.language === 'zh-CN' ? '导入完成' : 'Import Complete'}
              </div>
              <div className="stats-items">
                <div className="stats-item success">
                  <span className="stats-value">{importStats.imported}</span>
                  <span className="stats-label">{settings.language === 'zh-CN' ? '已导入' : 'Imported'}</span>
                </div>
                {importStats.skipped > 0 && (
                  <div className="stats-item warning">
                    <span className="stats-value">{importStats.skipped}</span>
                    <span className="stats-label">{settings.language === 'zh-CN' ? '已跳过' : 'Skipped'}</span>
                  </div>
                )}
                {importStats.renamed > 0 && (
                  <div className="stats-item info">
                    <span className="stats-value">{importStats.renamed}</span>
                    <span className="stats-label">{settings.language === 'zh-CN' ? '已重命名' : 'Renamed'}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 进度条 */}
          {loading && (
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
              <span className="progress-text">{progress}%</span>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="cancel-btn" onClick={onClose} disabled={loading}>
            {settings.language === 'zh-CN' ? '取消' : 'Cancel'}
          </button>
          <button
            className="submit-btn"
            onClick={isExport ? handleExport : handleImport}
            disabled={loading || (!isExport && !importData.trim())}
          >
            {loading
              ? (settings.language === 'zh-CN' ? '处理中...' : 'Processing...')
              : isExport
                ? (settings.language === 'zh-CN' ? '导出' : 'Export')
                : (settings.language === 'zh-CN' ? '导入' : 'Import')}
            {isExport ? <Download size={16} /> : <Upload size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ExportImportModal;
