import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Trash2, Star, ChevronUp } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import { debounce } from '../utils';
import JsonTreeView from './JsonTreeView';
import './CommandConsole.css';

// Redis 命令列表
const REDIS_COMMANDS = [
  // String
  'GET', 'SET', 'SETNX', 'SETEX', 'PSETEX', 'MGET', 'MSET', 'MSETNX', 'INCR', 'INCRBY', 'INCRBYFLOAT',
  'DECR', 'DECRBY', 'APPEND', 'STRLEN', 'GETRANGE', 'SETRANGE', 'GETSET', 'GETDEL', 'GETEX',
  // Hash
  'HGET', 'HSET', 'HSETNX', 'HMGET', 'HMSET', 'HINCRBY', 'HINCRBYFLOAT', 'HDEL', 'HEXISTS',
  'HLEN', 'HKEYS', 'HVALS', 'HGETALL', 'HSCAN', 'HSTRLEN', 'HRANDFIELD',
  // List
  'LPUSH', 'RPUSH', 'LPUSHX', 'RPUSHX', 'LPOP', 'RPOP', 'LRANGE', 'LINDEX', 'LSET', 'LLEN',
  'LINSERT', 'LREM', 'LTRIM', 'BLPOP', 'BRPOP', 'LPOS', 'LMOVE', 'BLMOVE',
  // Set
  'SADD', 'SREM', 'SMEMBERS', 'SISMEMBER', 'SMISMEMBER', 'SCARD', 'SPOP', 'SRANDMEMBER',
  'SMOVE', 'SDIFF', 'SDIFFSTORE', 'SINTER', 'SINTERSTORE', 'SUNION', 'SUNIONSTORE', 'SSCAN',
  // Sorted Set
  'ZADD', 'ZREM', 'ZSCORE', 'ZRANK', 'ZREVRANK', 'ZRANGE', 'ZREVRANGE', 'ZRANGEBYSCORE',
  'ZREVRANGEBYSCORE', 'ZRANGEBYLEX', 'ZREVRANGEBYLEX', 'ZCARD', 'ZCOUNT', 'ZLEXCOUNT',
  'ZINCRBY', 'ZUNIONSTORE', 'ZINTERSTORE', 'ZSCAN', 'ZPOPMIN', 'ZPOPMAX', 'BZPOPMIN', 'BZPOPMAX',
  'ZRANDMEMBER', 'ZMSCORE',
  // Keys
  'DEL', 'EXISTS', 'EXPIRE', 'EXPIREAT', 'PEXPIRE', 'PEXPIREAT', 'TTL', 'PTTL', 'PERSIST',
  'KEYS', 'SCAN', 'TYPE', 'RENAME', 'RENAMENX', 'RANDOMKEY', 'DBSIZE', 'TOUCH', 'UNLINK',
  'COPY', 'DUMP', 'RESTORE', 'OBJECT', 'MEMORY',
  // Server
  'INFO', 'PING', 'ECHO', 'SELECT', 'FLUSHDB', 'FLUSHALL', 'SAVE', 'BGSAVE', 'BGREWRITEAOF',
  'LASTSAVE', 'DBSIZE', 'TIME', 'CONFIG', 'CLIENT', 'SLOWLOG', 'DEBUG', 'COMMAND', 'MONITOR',
  // Pub/Sub
  'SUBSCRIBE', 'UNSUBSCRIBE', 'PUBLISH', 'PSUBSCRIBE', 'PUNSUBSCRIBE', 'PUBSUB',
  // Transaction
  'MULTI', 'EXEC', 'DISCARD', 'WATCH', 'UNWATCH',
  // Script
  'EVAL', 'EVALSHA', 'SCRIPT',
  // Cluster
  'CLUSTER', 'READONLY', 'READWRITE',
  // Stream
  'XADD', 'XREAD', 'XRANGE', 'XREVRANGE', 'XLEN', 'XINFO', 'XTRIM', 'XDEL', 'XGROUP',
  'XREADGROUP', 'XACK', 'XCLAIM', 'XPENDING', 'XAUTOCLAIM', 'XSETID',
];

// 收藏命令存储 key
const FAVORITES_STORAGE_KEY = 'command-favorites';

// 加载收藏命令
function loadFavorites(): string[] {
  try {
    const saved = localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.error('Failed to load favorites:', e);
  }
  return [];
}

// 保存收藏命令（内部实现）
function _saveFavorites(favorites: string[]) {
  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
  } catch (e) {
    console.error('Failed to save favorites:', e);
  }
}

// 防抖版本的收藏保存（300ms 延迟）
const saveFavorites = debounce(_saveFavorites, 300);

interface HistoryEntry {
  command: string;
  result: any;
  duration: number;
  timestamp: Date;
}

interface CommandConsoleProps {
  history: HistoryEntry[];
  onExecute: (command: string) => Promise<any>;
  onClear?: () => void;
  disabled: boolean;
}

function CommandConsole({ history, onExecute, onClear, disabled }: CommandConsoleProps) {
  const [input, setInput] = useState('');
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [executing, setExecuting] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [favorites, setFavorites] = useState<string[]>(loadFavorites);
  const [showFavorites, setShowFavorites] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { t, settings } = useSettings();

  // 分页配置（控制台使用较小的分页大小，便于浏览）
  const pageSize = 20;
  const totalPages = Math.ceil(history.length / pageSize);

  // 当前页显示的历史记录（倒序显示，最新的在最后）
  const paginatedHistory = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    return history.slice(startIndex, endIndex);
  }, [history, currentPage, pageSize]);

  // 当历史记录变化时，自动跳转到最后一页（显示最新记录）
  useEffect(() => {
    const newTotalPages = Math.ceil(history.length / pageSize);
    if (newTotalPages > 0 && currentPage !== newTotalPages) {
      setCurrentPage(newTotalPages);
    }
  }, [history.length, pageSize]);

  // 保存收藏
  useEffect(() => {
    saveFavorites(favorites);
  }, [favorites]);

  // 添加/移除收藏
  const toggleFavorite = useCallback((command: string) => {
    setFavorites(prev => {
      if (prev.includes(command)) {
        return prev.filter(c => c !== command);
      } else {
        return [...prev, command];
      }
    });
  }, []);

  // 执行收藏的命令
  const executeFavorite = useCallback(async (command: string) => {
    if (disabled || executing) return;
    setExecuting(true);
    await onExecute(command);
    setExecuting(false);
    inputRef.current?.focus();
  }, [disabled, executing, onExecute]);

  // 计算建议列表
  const suggestions = useMemo(() => {
    if (!input.trim()) return [];
    const firstWord = input.trim().split(/\s+/)[0].toUpperCase();
    if (input.includes(' ')) return []; // 已输入参数，不再提示
    return REDIS_COMMANDS.filter(cmd => cmd.startsWith(firstWord)).slice(0, 8);
  }, [input]);

  // 显示/隐藏建议
  useEffect(() => {
    setShowSuggestions(suggestions.length > 0 && input.trim().length > 0);
    setSelectedSuggestion(0);
  }, [suggestions, input]);

  // 应用建议
  const applySuggestion = useCallback((suggestion: string) => {
    setInput(suggestion + ' ');
    setShowSuggestions(false);
    inputRef.current?.focus();
  }, []);

  // 自动滚动到底部（仅在最后一页时）
  useEffect(() => {
    if (outputRef.current && currentPage === totalPages) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [history, currentPage, totalPages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || disabled || executing) return;

    setExecuting(true);
    setHistoryIndex(-1);

    await onExecute(input.trim());

    setInput('');
    setExecuting(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // 建议列表导航
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedSuggestion(prev => (prev + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedSuggestion(prev => (prev - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        if (suggestions[selectedSuggestion]) {
          e.preventDefault();
          applySuggestion(suggestions[selectedSuggestion]);
          return;
        }
      }
      if (e.key === 'Escape') {
        setShowSuggestions(false);
        return;
      }
    }

    // 历史命令导航
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const commands = history.map(h => h.command);
      if (historyIndex < commands.length - 1) {
        const newIndex = historyIndex + 1;
        setHistoryIndex(newIndex);
        setInput(commands[commands.length - 1 - newIndex]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        const commands = history.map(h => h.command);
        setInput(commands[commands.length - 1 - newIndex]);
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setInput('');
      }
    }
  };

  // 检测字符串是否包含不可打印字符（二进制数据）
  const isBinaryString = (str: string): boolean => {
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      // 允许：可打印 ASCII (32-126)、换行(10)、回车(13)、制表符(9)、中文等 Unicode (> 127 且非控制字符)
      if (code < 32 && code !== 10 && code !== 13 && code !== 9) {
        return true; // 控制字符
      }
      if (code >= 127 && code <= 159) {
        return true; // 扩展 ASCII 控制字符
      }
    }
    return false;
  };

  // 将二进制字符串转换为十六进制显示
  const toHexString = (str: string): string => {
    const hexParts: string[] = [];
    for (let i = 0; i < str.length; i++) {
      const hex = str.charCodeAt(i).toString(16).padStart(2, '0');
      hexParts.push(hex);
    }
    return hexParts.join(' ');
  };

  // 格式化字符串值，自动检测二进制
  const formatStringValue = (str: string): string => {
    if (isBinaryString(str)) {
      return `(binary) ${toHexString(str)}`;
    }
    return `"${str}"`;
  };

  // 检测结果是否适合用 JsonTreeView 展示
  const isJsonViewable = (result: any): boolean => {
    if (result === null || result === undefined) return false;
    if (result.error) return false;
    if (typeof result === 'string' || typeof result === 'number' || typeof result === 'boolean') return false;
    if (Array.isArray(result) && result.length > 0) return true;
    if (typeof result === 'object' && Object.keys(result).length > 0) return true;
    return false;
  };

  const formatResult = (result: any): string => {
    if (result === null) return '(nil)';
    if (result === undefined) return '(undefined)';
    if (typeof result === 'string') return formatStringValue(result);
    if (typeof result === 'number') return `(integer) ${result}`;
    if (result.error) return `(error) ${result.error}`;
    if (Array.isArray(result)) {
      if (result.length === 0) return '(empty array)';
      return result.map((item, i) => `${i + 1}) ${formatResult(item)}`).join('\n');
    }
    return JSON.stringify(result, null, 2);
  };

  return (
    <div className="command-console">
      <div className="console-header">
        <h3>{t('console.execute')}</h3>
        <div className="console-header-right">
          <span className="hint">↑↓ | Enter</span>
          <button
            className={`favorites-toggle ${showFavorites ? 'active' : ''}`}
            onClick={() => setShowFavorites(!showFavorites)}
            title={settings.language === 'zh-CN' ? '收藏命令' : 'Favorites'}
          >
            <Star size={14} />
            {favorites.length > 0 && <span className="favorites-count">{favorites.length}</span>}
          </button>
          {onClear && history.length > 0 && (
            <button
              className="clear-btn"
              onClick={onClear}
              title={settings.language === 'zh-CN' ? '清除记录' : 'Clear History'}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {/* 收藏命令列表 */}
      {showFavorites && (
        <div className="favorites-panel">
          <div className="favorites-header">
            <span>{settings.language === 'zh-CN' ? '收藏的命令' : 'Favorite Commands'}</span>
            <button onClick={() => setShowFavorites(false)}>
              <ChevronUp size={14} />
            </button>
          </div>
          {favorites.length === 0 ? (
            <div className="favorites-empty">
              {settings.language === 'zh-CN' ? '暂无收藏，点击命令旁的 ☆ 添加' : 'No favorites. Click ☆ next to a command to add.'}
            </div>
          ) : (
            <div className="favorites-list">
              {favorites.map((cmd, i) => (
                <div key={i} className="favorite-item">
                  <span className="favorite-command" onClick={() => executeFavorite(cmd)}>{cmd}</span>
                  <button
                    className="favorite-remove"
                    onClick={() => toggleFavorite(cmd)}
                    title={settings.language === 'zh-CN' ? '取消收藏' : 'Remove'}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="console-output" ref={outputRef}>
        {paginatedHistory.map((entry, index) => (
          <div key={`${currentPage}-${index}`} className="output-entry">
            <div className="output-command">
              <span className="prompt">&gt;</span>
              <span className="command-text">{entry.command}</span>
              <button
                className={`favorite-btn ${favorites.includes(entry.command) ? 'active' : ''}`}
                onClick={() => toggleFavorite(entry.command)}
                title={favorites.includes(entry.command)
                  ? (settings.language === 'zh-CN' ? '取消收藏' : 'Remove from favorites')
                  : (settings.language === 'zh-CN' ? '添加收藏' : 'Add to favorites')}
              >
                <Star size={12} />
              </button>
              <span className="duration">{entry.duration}ms</span>
            </div>
            {isJsonViewable(entry.result) ? (
              <div className="output-result json-result">
                <JsonTreeView data={entry.result} defaultExpanded={false} maxDepth={5} />
              </div>
            ) : (
              <pre className={`output-result ${entry.result?.error ? 'error' : ''}`}>
                {formatResult(entry.result)}
              </pre>
            )}
          </div>
        ))}
        {executing && (
          <div className="output-entry">
            <div className="output-command">
              <span className="prompt">&gt;</span>
              <span className="command-text">{input}</span>
              <span className="executing">...</span>
            </div>
          </div>
        )}
      </div>

      {/* 分页控件 */}
      {totalPages > 1 && (
        <div className="console-pagination">
          <button
            className="pagination-btn"
            onClick={() => setCurrentPage(1)}
            disabled={currentPage === 1}
            title={settings.language === 'zh-CN' ? '第一页' : 'First page'}
          >
            «
          </button>
          <button
            className="pagination-btn"
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            title={settings.language === 'zh-CN' ? '上一页' : 'Previous page'}
          >
            ‹
          </button>
          <span className="pagination-info">
            {currentPage} / {totalPages}
            <span className="pagination-total">
              ({history.length} {settings.language === 'zh-CN' ? '条记录' : 'records'})
            </span>
          </span>
          <button
            className="pagination-btn"
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            title={settings.language === 'zh-CN' ? '下一页' : 'Next page'}
          >
            ›
          </button>
          <button
            className="pagination-btn"
            onClick={() => setCurrentPage(totalPages)}
            disabled={currentPage === totalPages}
            title={settings.language === 'zh-CN' ? '最后一页' : 'Last page'}
          >
            »
          </button>
        </div>
      )}

      <form className="console-input" onSubmit={handleSubmit}>
        <span className="prompt">&gt;</span>
        <div className="input-wrapper">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
            placeholder={disabled ? t('noConnection.title') : t('console.placeholder')}
            disabled={disabled || executing}
            autoFocus
          />
          {showSuggestions && suggestions.length > 0 && (
            <div className="suggestions-list">
              {suggestions.map((suggestion, index) => (
                <div
                  key={suggestion}
                  className={`suggestion-item ${index === selectedSuggestion ? 'selected' : ''}`}
                  onClick={() => applySuggestion(suggestion)}
                  onMouseEnter={() => setSelectedSuggestion(index)}
                >
                  {suggestion}
                </div>
              ))}
            </div>
          )}
        </div>
      </form>
    </div>
  );
}

export default React.memo(CommandConsole);
