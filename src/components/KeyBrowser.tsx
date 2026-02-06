import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { FixedSizeList as VirtualList } from 'react-window';
import {
  FileText, List, Target, BarChart3, Hash, Waves, HelpCircle,
  Trash2, Pencil, FolderTree, ListOrdered, RefreshCw, FolderOpen,
  ChevronRight, ChevronDown, Clock, Hourglass, XCircle, Calendar, Plus, Copy, Check,
  Download, Upload, Server, Files, Radio, Activity, Database, HardDrive, Code
} from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import { useToast } from './Toast';
import ConfirmModal from './ConfirmModal';
import NewKeyModal from './NewKeyModal';
import ExportImportModal from './ExportImportModal';
import ServerInfoModal from './ServerInfoModal';
import Modal from './Modal';
import PubSubPanel from './PubSubPanel';
import PerformanceChart from './PerformanceChart';
import SlowLogPanel from './SlowLogPanel';
import BigKeyPanel from './BigKeyPanel';
import MemoryAnalyzer from './MemoryAnalyzer';
import LuaEditor from './LuaEditor';
import './KeyBrowser.css';

interface KeyBrowserProps {
  connectionId: string;
  onExecute: (command: string) => Promise<any>;
  onPipeline?: (commands: string[]) => Promise<any>;
  refreshTrigger?: number;
}

interface KeyInfo {
  key: string;
  type: string;
  ttl: number;
}

// 树形节点结构
interface TreeNode {
  name: string;
  fullPath: string;
  children: Map<string, TreeNode>;
  keys: KeyInfo[];
  isExpanded: boolean;
  totalCount?: number; // 缓存的总 key 数量（包括子节点），避免重复计算
}

// 视图模式
type ViewMode = 'tree' | 'list';

function KeyBrowser({ connectionId, onExecute, onPipeline, refreshTrigger }: KeyBrowserProps) {
  const [keys, setKeys] = useState<KeyInfo[]>([]);
  // 初始状态为 true，组件挂载时立即显示加载状态
  const [loading, setLoading] = useState(true);
  const [searchPattern, setSearchPattern] = useState('*');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [keyValue, setKeyValue] = useState<any>(null);
  const [keyLoading, setKeyLoading] = useState(false);

  // 当前数据库
  const [currentDb, setCurrentDb] = useState(0);

  // 视图模式
  const [viewMode, setViewMode] = useState<ViewMode>('tree');
  // 展开的节点路径集合
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  // 类型过滤
  const [typeFilter, setTypeFilter] = useState<string>('all');
  // 排序方式
  const [sortBy, setSortBy] = useState<'name' | 'type' | 'ttl'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [sortAnimating, setSortAnimating] = useState(false); // 排序动画状态

  // SCAN 游标状态
  const [hasMore, setHasMore] = useState(true);
  const [totalScanned, setTotalScanned] = useState(0);
  const cursorRef = useRef('0');

  // 可拖拽分隔条
  const [listWidth, setListWidth] = useState(300);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 编辑模式状态
  const [isEditing, setIsEditing] = useState(false);
  const [editKeyName, setEditKeyName] = useState('');
  const [editTTL, setEditTTL] = useState<string>('');
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  // 删除确认弹窗状态
  const [deleteKeyConfirm, setDeleteKeyConfirm] = useState<string | null>(null);
  const [deleteAllConfirm, setDeleteAllConfirm] = useState(false);

  // 复制 Key 弹窗状态
  const [copyKeySource, setCopyKeySource] = useState<string | null>(null);
  const [copyKeyTarget, setCopyKeyTarget] = useState('');

  // 新建 Key 弹窗状态
  const [showNewKeyModal, setShowNewKeyModal] = useState(false);

  // 导出/导入弹窗状态
  const [showExportModal, setShowExportModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);

  // 服务器信息弹窗状态
  const [showServerInfo, setShowServerInfo] = useState(false);

  // Pub/Sub 面板状态
  const [showPubSub, setShowPubSub] = useState(false);

  // 性能监控面板状态
  const [showPerformance, setShowPerformance] = useState(false);

  // 慢查询分析面板状态
  const [showSlowLog, setShowSlowLog] = useState(false);

  // 大 Key 分析面板状态
  const [showBigKey, setShowBigKey] = useState(false);

  // 内存分析面板状态
  const [showMemory, setShowMemory] = useState(false);

  // Lua 编辑器面板状态
  const [showLuaEditor, setShowLuaEditor] = useState(false);

  // 批量设置 TTL 弹窗状态
  const [showBatchTTL, setShowBatchTTL] = useState(false);
  const [batchTTLValue, setBatchTTLValue] = useState('');

  // 复制状态
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedValue, setCopiedValue] = useState(false);

  // 防止重复执行
  const isScanning = useRef(false);

  const { settings, t } = useSettings();
  const { showToast } = useToast();
  const keysPerPage = settings.data.keysPerPage;

  // 构建树形结构（优化版：构建时计算 totalCount）
  const buildTree = useCallback((keyInfos: KeyInfo[]): TreeNode => {
    const root: TreeNode = {
      name: '',
      fullPath: '',
      children: new Map(),
      keys: [],
      isExpanded: true,
    };

    for (const keyInfo of keyInfos) {
      const parts = keyInfo.key.split(':');
      let current = root;

      // 遍历路径部分（除了最后一个）
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        const pathSoFar = parts.slice(0, i + 1).join(':');

        if (!current.children.has(part)) {
          current.children.set(part, {
            name: part,
            fullPath: pathSoFar,
            children: new Map(),
            keys: [],
            isExpanded: expandedPaths.has(pathSoFar),
          });
        }
        current = current.children.get(part)!;
      }

      // 将 key 添加到当前节点
      current.keys.push(keyInfo);
    }

    // 递归计算并缓存每个节点的 totalCount（一次性计算，避免渲染时重复递归）
    const calculateTotalCount = (node: TreeNode): number => {
      let count = node.keys.length;
      for (const child of node.children.values()) {
        count += calculateTotalCount(child);
      }
      node.totalCount = count;
      return count;
    };
    calculateTotalCount(root);

    return root;
  }, [expandedPaths]);

  // 计算树形数据
  // 排序后的 keys（类型过滤已在服务端完成）
  const filteredKeys = useMemo(() => {
    let result = keys;

    // 注意：类型过滤已在 scanKeys 中完成，这里不再重复过滤
    // 只进行排序
    result = [...result].sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case 'name':
          cmp = a.key.localeCompare(b.key);
          break;
        case 'type':
          cmp = a.type.localeCompare(b.type);
          break;
        case 'ttl':
          // -1 表示永不过期，排在最后
          const ttlA = a.ttl === -1 ? Infinity : a.ttl;
          const ttlB = b.ttl === -1 ? Infinity : b.ttl;
          cmp = ttlA - ttlB;
          break;
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [keys, sortBy, sortOrder]);

  // 计算树形数据（使用过滤后的 keys）
  const treeData = useMemo(() => buildTree(filteredKeys), [filteredKeys, buildTree]);

  // 计算节点的总 key 数量（使用缓存值，O(1) 操作）
  const countKeys = useCallback((node: TreeNode): number => {
    // 优先使用缓存的 totalCount，避免递归计算
    if (node.totalCount !== undefined) {
      return node.totalCount;
    }
    // 兜底：如果没有缓存，递归计算
    let count = node.keys.length;
    for (const child of node.children.values()) {
      count += countKeys(child);
    }
    return count;
  }, []);

  // 切换节点展开状态
  const toggleExpand = useCallback((path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  // 使用 SCAN 命令扫描 keys（增量加载）
  // 当设置了类型过滤时，在服务端过滤，只返回匹配类型的 keys
  const scanKeys = useCallback(async (reset: boolean = true, filterType?: string) => {
    if (isScanning.current) return;
    isScanning.current = true;

    setLoading(true);

    // 用于累积结果（非 reset 模式需要保留之前的数据）
    let existingKeys: KeyInfo[] = [];

    if (reset) {
      setKeys([]);
      cursorRef.current = '0';
      setHasMore(true);
      setTotalScanned(0);
      setSelectedKey(null);
      setKeyValue(null);
      setExpandedPaths(new Set());
    } else {
      // 非 reset 模式，获取当前已有的 keys
      existingKeys = [...(await new Promise<KeyInfo[]>(resolve => {
        setKeys(prev => {
          resolve(prev);
          return prev;
        });
      }))];
    }

    // 使用传入的 filterType 或当前的 typeFilter
    const activeFilter = filterType ?? typeFilter;

    try {
      // 如果有类型过滤，需要多次 SCAN 直到获取足够数量的匹配 keys
      let allKeys: KeyInfo[] = reset ? [] : existingKeys;
      let cursor = cursorRef.current;
      let iterations = 0;
      const maxIterations = 50; // 防止无限循环
      const startCount = allKeys.length;

      do {
        const scanResult = await onExecute(
          `SCAN ${cursor} MATCH ${searchPattern} COUNT ${keysPerPage}`
        );

        if (!scanResult?.success || !Array.isArray(scanResult.data)) {
          break;
        }

        const [newCursor, scannedKeys] = scanResult.data;
        cursor = newCursor;

        if (Array.isArray(scannedKeys) && scannedKeys.length > 0) {
          if (onPipeline) {
            // 第一步：只获取类型
            const typeCommands = scannedKeys.map(key => `TYPE "${key}"`);
            const typeResults = await onPipeline(typeCommands);

            if (typeResults?.success && Array.isArray(typeResults.results)) {
              // 过滤出匹配类型的 keys
              const matchedKeys: string[] = [];
              const matchedTypes: string[] = [];

              for (let i = 0; i < scannedKeys.length; i++) {
                const keyType = typeResults.results[i]?.success ? typeResults.results[i].data : 'unknown';
                // 如果没有类型过滤，或者类型匹配
                if (activeFilter === 'all' || keyType === activeFilter) {
                  matchedKeys.push(scannedKeys[i]);
                  matchedTypes.push(keyType);
                }
              }

              // 第二步：只对匹配的 keys 获取 TTL
              if (matchedKeys.length > 0) {
                const ttlCommands = matchedKeys.map(key => `TTL "${key}"`);
                const ttlResults = await onPipeline(ttlCommands);

                if (ttlResults?.success && Array.isArray(ttlResults.results)) {
                  for (let i = 0; i < matchedKeys.length; i++) {
                    allKeys.push({
                      key: matchedKeys[i],
                      type: matchedTypes[i],
                      ttl: ttlResults.results[i]?.success ? ttlResults.results[i].data : -1,
                    });
                  }
                  // 实时更新 UI
                  setKeys([...allKeys]);
                  setTotalScanned(allKeys.length);
                }
              }
            }
          } else {
            // 非 pipeline 模式
            for (const key of scannedKeys) {
              const typeResult = await onExecute(`TYPE "${key}"`);
              const keyType = typeResult?.data || 'unknown';

              // 如果没有类型过滤，或者类型匹配
              if (activeFilter === 'all' || keyType === activeFilter) {
                const ttlResult = await onExecute(`TTL "${key}"`);
                allKeys.push({
                  key,
                  type: keyType,
                  ttl: ttlResult?.data ?? -1,
                });
                // 实时更新 UI
                setKeys([...allKeys]);
                setTotalScanned(allKeys.length);
              }
            }
          }
        }

        iterations++;

        // 如果没有类型过滤，一次 SCAN 就够了
        // 如果有类型过滤，继续 SCAN 直到获取足够数量或遍历完成
        if (activeFilter === 'all') {
          break;
        }

        // 如果已经获取了足够数量的新匹配 keys，停止
        if (allKeys.length - startCount >= keysPerPage) {
          break;
        }

      } while (cursor !== '0' && iterations < maxIterations);

      cursorRef.current = cursor;
      setHasMore(cursor !== '0');

      // 最终确保状态同步
      setKeys([...allKeys]);
      setTotalScanned(allKeys.length);
    } finally {
      setLoading(false);
      isScanning.current = false;
    }
  }, [searchPattern, keysPerPage, onExecute, onPipeline, typeFilter]);

  // 加载更多
  const loadMore = useCallback(() => {
    if (!loading && hasMore) {
      scanKeys(false);
    }
  }, [loading, hasMore, scanKeys]);

  // 加载全部（支持类型过滤）
  const loadAll = useCallback(async () => {
    if (loading || !hasMore) return;

    // 循环加载直到没有更多数据
    while (cursorRef.current !== '0' || keys.length === 0) {
      if (isScanning.current) {
        await new Promise(resolve => setTimeout(resolve, 100));
        continue;
      }
      await scanKeys(false, typeFilter);
      // 检查是否已加载完毕
      if (cursorRef.current === '0') break;
    }
  }, [loading, hasMore, scanKeys, keys.length, typeFilter]);

  // 连接变化或刷新触发时重新扫描
  useEffect(() => {
    // 使用 flag 防止 Strict Mode 下的重复执行
    let cancelled = false;

    const doScan = async () => {
      if (cancelled || isScanning.current) return;
      cursorRef.current = '0';
      isScanning.current = false;
      await scanKeys(true);
    };

    doScan();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, refreshTrigger]);

  // 获取 key 的值
  const loadKeyValue = useCallback(async (key: string, type: string) => {
    setKeyLoading(true);
    setSelectedKey(key);

    try {
      let result;
      let memoryResult;

      // 获取内存占用
      memoryResult = await onExecute(`MEMORY USAGE "${key}"`);
      const memory = memoryResult?.success ? memoryResult.data : null;

      switch (type) {
        case 'string':
          result = await onExecute(`GET "${key}"`);
          setKeyValue({ type, value: result?.data, memory });
          break;
        case 'list':
          result = await onExecute(`LRANGE "${key}" 0 99`);
          setKeyValue({ type, value: result?.data, memory });
          break;
        case 'set':
          result = await onExecute(`SMEMBERS "${key}"`);
          setKeyValue({ type, value: result?.data, memory });
          break;
        case 'zset':
          result = await onExecute(`ZRANGE "${key}" 0 99 WITHSCORES`);
          setKeyValue({ type, value: result?.data, memory });
          break;
        case 'hash':
          result = await onExecute(`HGETALL "${key}"`);
          setKeyValue({ type, value: result?.data, memory });
          break;
        case 'stream':
          // 获取 stream 信息和最近的消息
          const infoResult = await onExecute(`XINFO STREAM "${key}"`);
          const messagesResult = await onExecute(`XRANGE "${key}" - + COUNT 100`);
          const groupsResult = await onExecute(`XINFO GROUPS "${key}"`);
          setKeyValue({
            type,
            value: {
              info: infoResult?.data,
              messages: messagesResult?.data,
              groups: groupsResult?.data,
            },
            memory
          });
          break;
        default:
          setKeyValue({ type, value: '(unsupported type)', memory });
      }
    } finally {
      setKeyLoading(false);
    }
  }, [onExecute]);

  // 格式化内存大小
  const formatMemorySize = useCallback((bytes: number | null): string => {
    if (bytes === null || bytes === undefined) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }, []);

  // 判断是否为时间戳（10位数字，范围在 2000-2100 年之间）
  const isTimestamp = useCallback((score: string | number): boolean => {
    const num = typeof score === 'string' ? parseInt(score, 10) : score;
    // 2000-01-01 = 946684800, 2100-01-01 = 4102444800
    return !isNaN(num) && num >= 946684800 && num <= 4102444800;
  }, []);

  // 格式化时间戳为可读时间
  const formatTimestamp = useCallback((timestamp: number): string => {
    const date = new Date(timestamp * 1000);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }, []);

  // 计算过期时间（基于 TTL）
  const getExpireTime = useCallback((ttl: number): string => {
    if (ttl === -1) return '永不过期';
    if (ttl === -2) return '已过期';
    if (ttl <= 0) return '-';

    const expireDate = new Date(Date.now() + ttl * 1000);
    const year = expireDate.getFullYear();
    const month = String(expireDate.getMonth() + 1).padStart(2, '0');
    const day = String(expireDate.getDate()).padStart(2, '0');
    const hours = String(expireDate.getHours()).padStart(2, '0');
    const minutes = String(expireDate.getMinutes()).padStart(2, '0');
    const seconds = String(expireDate.getSeconds()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }, []);

  // 获取当前选中 key 的 TTL
  const selectedKeyTTL = useMemo(() => {
    if (!selectedKey) return -1;
    const keyInfo = keys.find(k => k.key === selectedKey);
    return keyInfo?.ttl ?? -1;
  }, [selectedKey, keys]);

  // 获取 ZSet 中最近的时间戳（用于显示在头部）
  const getZSetNextTime = useMemo((): { timestamp: number; formatted: string } | null => {
    if (!keyValue || keyValue.type !== 'zset' || !Array.isArray(keyValue.value)) {
      return null;
    }

    const scores: number[] = [];
    for (let i = 1; i < keyValue.value.length; i += 2) {
      const score = parseInt(keyValue.value[i], 10);
      if (isTimestamp(score)) {
        scores.push(score);
      }
    }

    if (scores.length === 0) return null;

    // 找最小的时间戳（最近要执行的）
    const minScore = Math.min(...scores);
    return {
      timestamp: minScore,
      formatted: formatTimestamp(minScore)
    };
  }, [keyValue, isTimestamp, formatTimestamp]);

  // 计算显示的过期信息
  const expireDisplay = useMemo(() => {
    // 如果 Key 有 TTL，优先显示 TTL
    if (selectedKeyTTL > 0) {
      return {
        type: 'ttl' as const,
        label: getExpireTime(selectedKeyTTL),
        icon: <Clock size={14} />,
        sublabel: `(TTL: ${selectedKeyTTL}s)`,
        className: ''
      };
    }

    // 如果是 ZSet 且有时间戳 score，显示最近的执行时间
    if (getZSetNextTime) {
      const now = Math.floor(Date.now() / 1000);
      const diff = getZSetNextTime.timestamp - now;
      const isPast = diff < 0;

      return {
        type: 'zset-score' as const,
        label: getZSetNextTime.formatted,
        icon: <Calendar size={14} />,
        sublabel: isPast ? '(已过期)' : `(${diff}s 后)`,
        className: isPast ? 'expired' : ''
      };
    }

    // 永不过期
    if (selectedKeyTTL === -1) {
      return {
        type: 'permanent' as const,
        label: '永不过期',
        icon: <Hourglass size={14} />,
        sublabel: '',
        className: 'permanent'
      };
    }

    // 已过期
    if (selectedKeyTTL === -2) {
      return {
        type: 'expired' as const,
        label: '已过期',
        icon: <XCircle size={14} />,
        sublabel: '',
        className: 'expired'
      };
    }

    return {
      type: 'unknown' as const,
      label: '-',
      icon: null,
      sublabel: '',
      className: ''
    };
  }, [selectedKeyTTL, getZSetNextTime, getExpireTime]);

  // 删除 key
  const deleteKey = useCallback(async (key: string) => {
    setDeleteKeyConfirm(key);
  }, []);

  // 确认删除单个 key
  const confirmDeleteKey = useCallback(async () => {
    if (!deleteKeyConfirm) return;
    const key = deleteKeyConfirm;
    setDeleteKeyConfirm(null);

    const result = await onExecute(`DEL "${key}"`);
    if (result?.success) {
      setKeys(prev => prev.filter(k => k.key !== key));
      setTotalScanned(prev => prev - 1);
      if (selectedKey === key) {
        setSelectedKey(null);
        setKeyValue(null);
      }
      showToast(settings.language === 'zh-CN' ? `已删除 ${key}` : `Deleted ${key}`, 'success');
    } else {
      showToast(settings.language === 'zh-CN' ? '删除失败' : 'Delete failed', 'error');
    }
  }, [deleteKeyConfirm, onExecute, selectedKey, showToast, settings.language]);

  // 批量删除所有已加载的 keys
  const deleteAllKeys = useCallback(async () => {
    if (keys.length === 0) return;
    setDeleteAllConfirm(true);
  }, [keys.length]);

  // 确认批量删除
  const confirmDeleteAllKeys = useCallback(async () => {
    setDeleteAllConfirm(false);
    setLoading(true);
    try {
      const count = keys.length;
      if (onPipeline) {
        // 使用 pipeline 批量删除
        const commands = keys.map(k => `DEL "${k.key}"`);
        await onPipeline(commands);
      } else {
        // 逐个删除
        for (const k of keys) {
          await onExecute(`DEL "${k.key}"`);
        }
      }

      // 清空本地状态
      setKeys([]);
      setTotalScanned(0);
      setSelectedKey(null);
      setKeyValue(null);
      showToast(settings.language === 'zh-CN' ? `已删除 ${count} 个 Key` : `Deleted ${count} keys`, 'success');
    } catch (err) {
      showToast(settings.language === 'zh-CN' ? '批量删除失败' : 'Batch delete failed', 'error');
    } finally {
      setLoading(false);
    }
  }, [keys, onExecute, onPipeline, showToast, settings.language]);

  // 批量设置 TTL
  const confirmBatchTTL = useCallback(async () => {
    const ttl = parseInt(batchTTLValue, 10);
    if (isNaN(ttl) || keys.length === 0) return;

    setShowBatchTTL(false);
    setLoading(true);

    try {
      const count = keys.length;
      if (onPipeline) {
        const commands = keys.map(k =>
          ttl === -1 ? `PERSIST "${k.key}"` : `EXPIRE "${k.key}" ${ttl}`
        );
        await onPipeline(commands);
      } else {
        for (const k of keys) {
          if (ttl === -1) {
            await onExecute(`PERSIST "${k.key}"`);
          } else {
            await onExecute(`EXPIRE "${k.key}" ${ttl}`);
          }
        }
      }

      // 更新本地 TTL 状态
      setKeys(prev => prev.map(k => ({ ...k, ttl: ttl === -1 ? -1 : ttl })));
      showToast(
        settings.language === 'zh-CN'
          ? `已为 ${count} 个 Key 设置 TTL`
          : `Set TTL for ${count} keys`,
        'success'
      );
    } catch (err) {
      showToast(settings.language === 'zh-CN' ? '批量设置 TTL 失败' : 'Batch set TTL failed', 'error');
    } finally {
      setLoading(false);
      setBatchTTLValue('');
    }
  }, [batchTTLValue, keys, onExecute, onPipeline, showToast, settings.language]);

  // 打开复制 Key 弹窗
  const openCopyKeyModal = useCallback((key: string) => {
    setCopyKeySource(key);
    setCopyKeyTarget(key + '_copy');
  }, []);

  // 确认复制 Key
  const confirmCopyKey = useCallback(async () => {
    if (!copyKeySource || !copyKeyTarget.trim()) return;

    const source = copyKeySource;
    const target = copyKeyTarget.trim();
    setCopyKeySource(null);
    setCopyKeyTarget('');

    // 检查目标 key 是否已存在
    const existsResult = await onExecute(`EXISTS "${target}"`);
    if (existsResult?.success && existsResult.data === 1) {
      // 目标已存在，可以选择覆盖或取消
      // 这里简单处理：先删除再复制
      await onExecute(`DEL "${target}"`);
    }

    // 使用 COPY 命令（Redis 6.2+）或 DUMP/RESTORE
    const copyResult = await onExecute(`COPY "${source}" "${target}"`);

    if (!copyResult?.success || copyResult.data === 0) {
      // COPY 命令失败，尝试 DUMP/RESTORE 方式
      const dumpResult = await onExecute(`DUMP "${source}"`);
      if (dumpResult?.success && dumpResult.data) {
        // DUMP 返回的是二进制数据，需要特殊处理
        // 由于 RESTORE 需要原始二进制，这里使用另一种方式
        // 根据类型复制
        const typeResult = await onExecute(`TYPE "${source}"`);
        const keyType = typeResult?.data;
        const ttlResult = await onExecute(`TTL "${source}"`);
        const ttl = ttlResult?.data ?? -1;

        if (keyType === 'string') {
          const valueResult = await onExecute(`GET "${source}"`);
          if (valueResult?.success) {
            await onExecute(`SET "${target}" "${String(valueResult.data).replace(/"/g, '\\"')}"`);
          }
        } else if (keyType === 'hash') {
          const valueResult = await onExecute(`HGETALL "${source}"`);
          if (valueResult?.success && Array.isArray(valueResult.data)) {
            const args = valueResult.data.map((v: string) => `"${String(v).replace(/"/g, '\\"')}"`).join(' ');
            await onExecute(`HSET "${target}" ${args}`);
          }
        } else if (keyType === 'list') {
          const valueResult = await onExecute(`LRANGE "${source}" 0 -1`);
          if (valueResult?.success && Array.isArray(valueResult.data)) {
            for (const item of valueResult.data) {
              await onExecute(`RPUSH "${target}" "${String(item).replace(/"/g, '\\"')}"`);
            }
          }
        } else if (keyType === 'set') {
          const valueResult = await onExecute(`SMEMBERS "${source}"`);
          if (valueResult?.success && Array.isArray(valueResult.data)) {
            const args = valueResult.data.map((v: string) => `"${String(v).replace(/"/g, '\\"')}"`).join(' ');
            await onExecute(`SADD "${target}" ${args}`);
          }
        } else if (keyType === 'zset') {
          const valueResult = await onExecute(`ZRANGE "${source}" 0 -1 WITHSCORES`);
          if (valueResult?.success && Array.isArray(valueResult.data)) {
            for (let i = 0; i < valueResult.data.length; i += 2) {
              const member = valueResult.data[i];
              const score = valueResult.data[i + 1];
              await onExecute(`ZADD "${target}" ${score} "${String(member).replace(/"/g, '\\"')}"`);
            }
          }
        }

        // 设置 TTL
        if (ttl > 0) {
          await onExecute(`EXPIRE "${target}" ${ttl}`);
        }
      }
    }

    // 刷新 key 列表
    cursorRef.current = '0';
    isScanning.current = false;
    scanKeys(true);
    showToast(settings.language === 'zh-CN' ? `已复制到 ${target}` : `Copied to ${target}`, 'success');
  }, [copyKeySource, copyKeyTarget, onExecute, scanKeys, showToast, settings.language]);

  // 进入编辑模式
  const enterEditMode = useCallback(() => {
    if (!selectedKey || !keyValue) return;
    setEditKeyName(selectedKey);

    // 获取当前 key 的 TTL
    const currentKeyInfo = keys.find(k => k.key === selectedKey);
    setEditTTL(currentKeyInfo?.ttl === -1 ? '' : String(currentKeyInfo?.ttl ?? ''));

    // 格式化值用于编辑
    const { type, value } = keyValue;
    if (type === 'string') {
      setEditValue(value ?? '');
    } else if (type === 'hash' && Array.isArray(value)) {
      // 转换为 JSON 对象格式
      const obj: Record<string, string> = {};
      for (let i = 0; i < value.length; i += 2) {
        obj[value[i]] = value[i + 1];
      }
      setEditValue(JSON.stringify(obj, null, 2));
    } else if (type === 'list' || type === 'set') {
      setEditValue(JSON.stringify(value, null, 2));
    } else if (type === 'zset' && Array.isArray(value)) {
      // 转换为 {member: score} 格式
      const pairs: { member: string; score: number }[] = [];
      for (let i = 0; i < value.length; i += 2) {
        pairs.push({ member: value[i], score: parseFloat(value[i + 1]) });
      }
      setEditValue(JSON.stringify(pairs, null, 2));
    } else {
      setEditValue(JSON.stringify(value, null, 2));
    }

    setIsEditing(true);
  }, [selectedKey, keyValue, keys]);

  // 取消编辑
  const cancelEdit = useCallback(() => {
    setIsEditing(false);
    setEditKeyName('');
    setEditTTL('');
    setEditValue('');
  }, []);

  // 保存编辑
  const saveEdit = useCallback(async () => {
    if (!selectedKey || !keyValue) return;
    setSaving(true);

    try {
      const { type } = keyValue;
      const oldKey = selectedKey;
      const newKey = editKeyName.trim();

      // 1. 如果 key 名称改变，先重命名
      if (newKey !== oldKey) {
        const renameResult = await onExecute(`RENAME "${oldKey}" "${newKey}"`);
        if (!renameResult?.success) {
          alert(`重命名失败: ${renameResult?.error || 'Unknown error'}`);
          setSaving(false);
          return;
        }
        // 更新本地 keys 列表
        setKeys(prev => prev.map(k => k.key === oldKey ? { ...k, key: newKey } : k));
        setSelectedKey(newKey);
      }

      // 2. 更新值
      const targetKey = newKey;

      if (type === 'string') {
        await onExecute(`SET "${targetKey}" "${editValue.replace(/"/g, '\\"')}"`);
      } else if (type === 'hash') {
        try {
          const hashObj = JSON.parse(editValue);
          // 先删除旧的 hash
          await onExecute(`DEL "${targetKey}"`);
          // 重新设置
          for (const [field, val] of Object.entries(hashObj)) {
            await onExecute(`HSET "${targetKey}" "${field}" "${String(val).replace(/"/g, '\\"')}"`);
          }
        } catch (e) {
          alert('Hash 值格式错误，请使用 JSON 对象格式');
          setSaving(false);
          return;
        }
      } else if (type === 'list') {
        try {
          const listArr = JSON.parse(editValue);
          if (!Array.isArray(listArr)) throw new Error('Not array');
          await onExecute(`DEL "${targetKey}"`);
          for (const item of listArr) {
            await onExecute(`RPUSH "${targetKey}" "${String(item).replace(/"/g, '\\"')}"`);
          }
        } catch (e) {
          alert('List 值格式错误，请使用 JSON 数组格式');
          setSaving(false);
          return;
        }
      } else if (type === 'set') {
        try {
          const setArr = JSON.parse(editValue);
          if (!Array.isArray(setArr)) throw new Error('Not array');
          await onExecute(`DEL "${targetKey}"`);
          for (const item of setArr) {
            await onExecute(`SADD "${targetKey}" "${String(item).replace(/"/g, '\\"')}"`);
          }
        } catch (e) {
          alert('Set 值格式错误，请使用 JSON 数组格式');
          setSaving(false);
          return;
        }
      } else if (type === 'zset') {
        try {
          const zsetArr = JSON.parse(editValue);
          if (!Array.isArray(zsetArr)) throw new Error('Not array');
          await onExecute(`DEL "${targetKey}"`);
          for (const item of zsetArr) {
            const score = item.score ?? 0;
            const member = item.member ?? item;
            await onExecute(`ZADD "${targetKey}" ${score} "${String(member).replace(/"/g, '\\"')}"`);
          }
        } catch (e) {
          alert('ZSet 值格式错误，请使用 [{member, score}] 格式');
          setSaving(false);
          return;
        }
      }

      // 3. 设置 TTL
      const ttlValue = editTTL.trim();
      if (ttlValue === '' || ttlValue === '-1') {
        // 移除过期时间
        await onExecute(`PERSIST "${targetKey}"`);
      } else {
        const ttlNum = parseInt(ttlValue, 10);
        if (!isNaN(ttlNum) && ttlNum > 0) {
          await onExecute(`EXPIRE "${targetKey}" ${ttlNum}`);
        }
      }

      // 4. 更新本地 TTL
      const newTTL = ttlValue === '' ? -1 : parseInt(ttlValue, 10);
      setKeys(prev => prev.map(k => k.key === targetKey ? { ...k, ttl: newTTL } : k));

      // 5. 重新加载值
      await loadKeyValue(targetKey, type);

      setIsEditing(false);
    } catch (e) {
      alert(`保存失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }, [selectedKey, keyValue, editKeyName, editTTL, editValue, onExecute, loadKeyValue]);

  // PHP 序列化格式解析器
  const tryParsePHPSerialize = (str: string): { isPHP: boolean; data: any } => {
    if (typeof str !== 'string') return { isPHP: false, data: str };
    const trimmed = str.trim();

    // 检测 PHP 序列化格式特征
    if (!/^[aOsibdN]:/.test(trimmed)) {
      return { isPHP: false, data: str };
    }

    try {
      // 将字符串转为字节数组以正确处理多字节字符
      const encoder = new TextEncoder();
      const bytes = encoder.encode(trimmed);
      let pos = 0;

      const readChar = (): string => {
        const char = String.fromCharCode(bytes[pos]);
        pos++;
        return char;
      };

      const readUntil = (char: string): string => {
        let result = '';
        while (pos < bytes.length && String.fromCharCode(bytes[pos]) !== char) {
          result += String.fromCharCode(bytes[pos]);
          pos++;
        }
        return result;
      };

      const parseValue = (): any => {
        const type = readChar();
        readChar(); // skip ':'

        switch (type) {
          case 'N': // null
            readChar(); // skip ';'
            return null;

          case 'b': // boolean
            const boolVal = readChar() === '1';
            readChar(); // skip ';'
            return boolVal;

          case 'i': // integer
          case 'd': { // double
            const numStr = readUntil(';');
            readChar(); // skip ';'
            return type === 'i' ? parseInt(numStr, 10) : parseFloat(numStr);
          }

          case 's': { // string - 长度是字节数
            const lenStr = readUntil(':');
            const len = parseInt(lenStr, 10);
            readChar(); // skip ':'
            readChar(); // skip '"'

            // 读取指定字节数
            const strBytes = bytes.slice(pos, pos + len);
            const decoder = new TextDecoder('utf-8');
            const strVal = decoder.decode(strBytes);
            pos += len;

            readChar(); // skip '"'
            readChar(); // skip ';'
            return strVal;
          }

          case 'a': { // array
            const countStr = readUntil(':');
            const count = parseInt(countStr, 10);
            readChar(); // skip ':'
            readChar(); // skip '{'

            const result: any = {};
            let isSequential = true;

            for (let i = 0; i < count; i++) {
              const key = parseValue();
              const value = parseValue();
              result[key] = value;
              if (key !== i) isSequential = false;
            }

            readChar(); // skip '}'

            // 如果是连续数字索引，返回数组
            if (isSequential && count > 0) {
              return Object.values(result);
            }
            return result;
          }

          case 'O': { // object
            const classLenStr = readUntil(':');
            const classLen = parseInt(classLenStr, 10);
            readChar(); // skip ':'
            readChar(); // skip '"'

            const classBytes = bytes.slice(pos, pos + classLen);
            const decoder = new TextDecoder('utf-8');
            const className = decoder.decode(classBytes);
            pos += classLen;

            readChar(); // skip '"'
            readChar(); // skip ':'

            const propsCountStr = readUntil(':');
            const propsCount = parseInt(propsCountStr, 10);
            readChar(); // skip ':'
            readChar(); // skip '{'

            const obj: any = { __class__: className };
            for (let i = 0; i < propsCount; i++) {
              const key = parseValue();
              const value = parseValue();
              obj[key] = value;
            }
            readChar(); // skip '}'
            return obj;
          }

          default:
            throw new Error(`Unknown type: ${type}`);
        }
      };

      const result = parseValue();
      return { isPHP: true, data: result };
    } catch (e) {
      return { isPHP: false, data: str };
    }
  };

  // 尝试解析 JSON
  const tryParseJSON = (str: string): { isJSON: boolean; data: any } => {
    if (typeof str !== 'string') return { isJSON: false, data: str };
    const trimmed = str.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        return { isJSON: true, data: JSON.parse(trimmed) };
      } catch {
        return { isJSON: false, data: str };
      }
    }
    return { isJSON: false, data: str };
  };

  // 尝试解析结构化数据（JSON 或 PHP 序列化）
  const tryParseStructured = (str: string): { format: 'json' | 'php' | 'plain'; data: any } => {
    const jsonResult = tryParseJSON(str);
    if (jsonResult.isJSON) {
      return { format: 'json', data: jsonResult.data };
    }
    const phpResult = tryParsePHPSerialize(str);
    if (phpResult.isPHP) {
      return { format: 'php', data: phpResult.data };
    }
    return { format: 'plain', data: str };
  };

  // 检测是否为二进制数据（包含不可打印字符）
  const isBinaryData = (str: string): boolean => {
    if (typeof str !== 'string' || str.length === 0) return false;
    // 统计不可打印字符的比例
    let nonPrintable = 0;
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      // 不可打印字符：控制字符（除了换行、回车、制表符）和高位字符
      if ((code < 32 && code !== 9 && code !== 10 && code !== 13) ||
          (code >= 127 && code <= 159) ||
          code === 65533) { // 替换字符 �
        nonPrintable++;
      }
    }
    // 如果超过 20% 是不可打印字符，认为是二进制数据
    return nonPrintable / str.length > 0.2;
  };

  // 将字符串转换为十六进制显示
  const toHexDisplay = (str: string): string => {
    const bytes: number[] = [];
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      if (code <= 0xFF) {
        bytes.push(code);
      } else {
        // 处理多字节字符
        const encoded = new TextEncoder().encode(str[i]);
        encoded.forEach(b => bytes.push(b));
      }
    }
    return bytes.map(b => b.toString(16).padStart(2, '0')).join(' ');
  };

  // 格式化值显示（处理二进制数据）
  const formatDisplayValue = (str: string): { isBinary: boolean; display: string; hex?: string } => {
    if (isBinaryData(str)) {
      const hex = toHexDisplay(str);
      // 截取前 100 字节显示
      const truncatedHex = hex.length > 300 ? hex.substring(0, 300) + '...' : hex;
      return { isBinary: true, display: `[Binary: ${str.length} bytes]`, hex: truncatedHex };
    }
    return { isBinary: false, display: str };
  };

  // 渲染格式化的值
  const renderFormattedValue = () => {
    if (!keyValue) return null;
    const { type, value } = keyValue;

    if (value === null || value === undefined) {
      return <span className="value-nil">(nil)</span>;
    }

    switch (type) {
      case 'string': {
        const binaryInfo = formatDisplayValue(value);
        if (binaryInfo.isBinary) {
          return (
            <div className="value-binary">
              <div className="format-badge binary">BINARY</div>
              <div className="binary-info">{binaryInfo.display}</div>
              <code className="binary-hex-block">{binaryInfo.hex}</code>
            </div>
          );
        }
        const { format, data } = tryParseStructured(value);
        if (format !== 'plain') {
          return (
            <div className="value-json">
              <div className={`format-badge ${format}`}>{format.toUpperCase()}</div>
              <pre>{JSON.stringify(data, null, 2)}</pre>
            </div>
          );
        }
        return <pre className="value-string">{value}</pre>;
      }

      case 'list':
        return (
          <div className="value-list">
            <table className="value-table">
              <thead>
                <tr>
                  <th style={{ width: '60px' }}>Index</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {Array.isArray(value) && value.map((item, i) => {
                  const binaryInfo = formatDisplayValue(item);
                  if (binaryInfo.isBinary) {
                    return (
                      <tr key={i}>
                        <td className="index-cell">{i}</td>
                        <td className="value-cell">
                          <span className="binary-value">
                            <span className="binary-label">{binaryInfo.display}</span>
                            <code className="binary-hex">{binaryInfo.hex}</code>
                          </span>
                        </td>
                      </tr>
                    );
                  }
                  const { format, data } = tryParseStructured(item);
                  return (
                    <tr key={i}>
                      <td className="index-cell">{i}</td>
                      <td className="value-cell">
                        {format !== 'plain' ? (
                          <pre className="inline-json">{JSON.stringify(data, null, 2)}</pre>
                        ) : (
                          <span>{item}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );

      case 'set':
        return (
          <div className="value-set">
            <table className="value-table">
              <thead>
                <tr>
                  <th style={{ width: '60px' }}>#</th>
                  <th>Member</th>
                </tr>
              </thead>
              <tbody>
                {Array.isArray(value) && value.map((item, i) => {
                  const binaryInfo = formatDisplayValue(item);
                  if (binaryInfo.isBinary) {
                    return (
                      <tr key={i}>
                        <td className="index-cell">{i + 1}</td>
                        <td className="value-cell">
                          <span className="binary-value">
                            <span className="binary-label">{binaryInfo.display}</span>
                            <code className="binary-hex">{binaryInfo.hex}</code>
                          </span>
                        </td>
                      </tr>
                    );
                  }
                  const { format, data } = tryParseStructured(item);
                  return (
                    <tr key={i}>
                      <td className="index-cell">{i + 1}</td>
                      <td className="value-cell">
                        {format !== 'plain' ? (
                          <pre className="inline-json">{JSON.stringify(data, null, 2)}</pre>
                        ) : (
                          <span>{item}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );

      case 'zset': {
        const pairs: { member: string; score: string }[] = [];
        if (Array.isArray(value)) {
          for (let i = 0; i < value.length; i += 2) {
            pairs.push({ member: value[i], score: value[i + 1] });
          }
        }

        return (
          <div className="value-zset">
            <table className="value-table">
              <thead>
                <tr>
                  <th style={{ width: '180px' }}>Score</th>
                  <th>Member</th>
                </tr>
              </thead>
              <tbody>
                {pairs.map((pair, i) => {
                  const binaryInfo = formatDisplayValue(pair.member);
                  const scoreNum = parseInt(pair.score, 10);
                  const showTimestamp = isTimestamp(scoreNum);
                  return (
                    <tr key={i}>
                      <td className="score-cell">
                        {showTimestamp ? (
                          <span className="score-timestamp">
                            <span className="timestamp-date">{formatTimestamp(scoreNum)}</span>
                            <span className="timestamp-raw">({pair.score})</span>
                          </span>
                        ) : (
                          pair.score
                        )}
                      </td>
                      <td className="value-cell">
                        {binaryInfo.isBinary ? (
                          <span className="binary-value">
                            <span className="binary-label">{binaryInfo.display}</span>
                            <code className="binary-hex">{binaryInfo.hex}</code>
                          </span>
                        ) : (() => {
                          const { format, data } = tryParseStructured(pair.member);
                          return format !== 'plain' ? (
                            <pre className="inline-json">{JSON.stringify(data, null, 2)}</pre>
                          ) : (
                            <span>{pair.member}</span>
                          );
                        })()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      }

      case 'hash': {
        const entries: { field: string; value: string }[] = [];
        if (Array.isArray(value)) {
          for (let i = 0; i < value.length; i += 2) {
            entries.push({ field: value[i], value: value[i + 1] });
          }
        }
        return (
          <div className="value-hash">
            <table className="value-table">
              <thead>
                <tr>
                  <th style={{ width: '150px' }}>Field</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, i) => {
                  const fieldBinaryInfo = formatDisplayValue(entry.field);
                  const valueBinaryInfo = formatDisplayValue(entry.value);
                  return (
                    <tr key={i}>
                      <td className="field-cell">
                        {fieldBinaryInfo.isBinary ? (
                          <span className="binary-value">
                            <span className="binary-label">{fieldBinaryInfo.display}</span>
                            <code className="binary-hex">{fieldBinaryInfo.hex}</code>
                          </span>
                        ) : (
                          entry.field
                        )}
                      </td>
                      <td className="value-cell">
                        {valueBinaryInfo.isBinary ? (
                          <span className="binary-value">
                            <span className="binary-label">{valueBinaryInfo.display}</span>
                            <code className="binary-hex">{valueBinaryInfo.hex}</code>
                          </span>
                        ) : (() => {
                          const { format, data } = tryParseStructured(entry.value);
                          return format !== 'plain' ? (
                            <pre className="inline-json">{JSON.stringify(data, null, 2)}</pre>
                          ) : (
                            <span>{entry.value}</span>
                          );
                        })()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      }

      case 'stream': {
        const { info, messages, groups } = value || {};

        // 解析 XINFO STREAM 返回的数组格式
        const parseStreamInfo = (infoArr: any[]): Record<string, any> => {
          if (!Array.isArray(infoArr)) return {};
          const result: Record<string, any> = {};
          for (let i = 0; i < infoArr.length; i += 2) {
            result[infoArr[i]] = infoArr[i + 1];
          }
          return result;
        };

        const streamInfo = parseStreamInfo(info);

        // 解析消息
        const parseMessages = (msgs: any[]): Array<{ id: string; fields: Record<string, string> }> => {
          if (!Array.isArray(msgs)) return [];
          return msgs.map((msg: any) => {
            const [id, fieldsArr] = msg;
            const fields: Record<string, string> = {};
            if (Array.isArray(fieldsArr)) {
              for (let i = 0; i < fieldsArr.length; i += 2) {
                fields[fieldsArr[i]] = fieldsArr[i + 1];
              }
            }
            return { id, fields };
          });
        };

        const parsedMessages = parseMessages(messages);

        // 解析消费者组
        const parseGroups = (grps: any[]): Array<{ name: string; consumers: number; pending: number; lastId: string }> => {
          if (!Array.isArray(grps)) return [];
          return grps.map((grp: any) => {
            const g = parseStreamInfo(grp);
            return {
              name: g.name || '',
              consumers: g.consumers || 0,
              pending: g.pending || 0,
              lastId: g['last-delivered-id'] || '-',
            };
          });
        };

        const parsedGroups = parseGroups(groups);

        return (
          <div className="value-stream">
            {/* Stream 信息 */}
            <div className="stream-info">
              <h4>{settings.language === 'zh-CN' ? 'Stream 信息' : 'Stream Info'}</h4>
              <div className="stream-stats">
                <div className="stat-item">
                  <span className="stat-label">{settings.language === 'zh-CN' ? '消息数' : 'Length'}</span>
                  <span className="stat-value">{streamInfo.length || 0}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">{settings.language === 'zh-CN' ? '消费者组' : 'Groups'}</span>
                  <span className="stat-value">{streamInfo.groups || 0}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">{settings.language === 'zh-CN' ? '第一条ID' : 'First ID'}</span>
                  <span className="stat-value">{streamInfo['first-entry']?.[0] || '-'}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">{settings.language === 'zh-CN' ? '最后一条ID' : 'Last ID'}</span>
                  <span className="stat-value">{streamInfo['last-entry']?.[0] || '-'}</span>
                </div>
              </div>
            </div>

            {/* 消费者组 */}
            {parsedGroups.length > 0 && (
              <div className="stream-groups">
                <h4>{settings.language === 'zh-CN' ? '消费者组' : 'Consumer Groups'}</h4>
                <table className="value-table">
                  <thead>
                    <tr>
                      <th>{settings.language === 'zh-CN' ? '组名' : 'Name'}</th>
                      <th>{settings.language === 'zh-CN' ? '消费者数' : 'Consumers'}</th>
                      <th>{settings.language === 'zh-CN' ? '待处理' : 'Pending'}</th>
                      <th>{settings.language === 'zh-CN' ? '最后投递ID' : 'Last Delivered'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedGroups.map((group, i) => (
                      <tr key={i}>
                        <td>{group.name}</td>
                        <td>{group.consumers}</td>
                        <td>{group.pending}</td>
                        <td className="mono">{group.lastId}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* 消息列表 */}
            <div className="stream-messages">
              <h4>{settings.language === 'zh-CN' ? `消息 (最近 ${parsedMessages.length} 条)` : `Messages (Latest ${parsedMessages.length})`}</h4>
              <table className="value-table">
                <thead>
                  <tr>
                    <th style={{ width: '180px' }}>ID</th>
                    <th>{settings.language === 'zh-CN' ? '字段' : 'Fields'}</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedMessages.map((msg, i) => (
                    <tr key={i}>
                      <td className="mono">{msg.id}</td>
                      <td>
                        <pre className="inline-json">{JSON.stringify(msg.fields, null, 2)}</pre>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      }

      default:
        return <pre>{JSON.stringify(value, null, 2)}</pre>;
    }
  };

  // 获取类型图标
  const getTypeIcon = (type: string): React.ReactNode => {
    const icons: Record<string, React.ReactNode> = {
      string: <FileText size={14} />,
      list: <List size={14} />,
      set: <Target size={14} />,
      zset: <BarChart3 size={14} />,
      hash: <Hash size={14} />,
      stream: <Waves size={14} />,
    };
    return icons[type] || <HelpCircle size={14} />;
  };

  // 拖拽处理
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging || !containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const newWidth = e.clientX - containerRect.left;
      setListWidth(Math.max(200, Math.min(600, newWidth)));
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // 手动触发扫描
  const handleScan = useCallback(() => {
    cursorRef.current = '0';
    isScanning.current = false;
    scanKeys(true);
  }, [scanKeys]);

  // 完整搜索（扫描全库直到找完所有匹配的 key，支持类型过滤）
  const handleFullSearch = useCallback(async () => {
    if (isScanning.current) return;

    // 重置状态
    cursorRef.current = '0';
    setKeys([]);
    setHasMore(true);
    setTotalScanned(0);
    setSelectedKey(null);
    setKeyValue(null);
    setExpandedPaths(new Set());
    setLoading(true);

    try {
      let allKeys: KeyInfo[] = [];
      let cursor = '0';

      do {
        const scanResult = await onExecute(
          `SCAN ${cursor} MATCH ${searchPattern} COUNT ${keysPerPage}`
        );

        if (scanResult?.success && Array.isArray(scanResult.data)) {
          const [newCursor, scannedKeys] = scanResult.data;
          cursor = newCursor;

          if (Array.isArray(scannedKeys) && scannedKeys.length > 0) {
            if (onPipeline) {
              // 第一步：获取所有 key 的类型
              const typeCommands = scannedKeys.map(key => `TYPE "${key}"`);
              const typeResults = await onPipeline(typeCommands);

              if (typeResults?.success && Array.isArray(typeResults.results)) {
                // 过滤出匹配类型的 keys
                const matchedKeys: string[] = [];
                const matchedTypes: string[] = [];

                for (let i = 0; i < scannedKeys.length; i++) {
                  const keyType = typeResults.results[i]?.success ? typeResults.results[i].data : 'unknown';
                  // 如果没有类型过滤，或者类型匹配
                  if (typeFilter === 'all' || keyType === typeFilter) {
                    matchedKeys.push(scannedKeys[i]);
                    matchedTypes.push(keyType);
                  }
                }

                // 第二步：只对匹配的 keys 获取 TTL
                if (matchedKeys.length > 0) {
                  const ttlCommands = matchedKeys.map(key => `TTL "${key}"`);
                  const ttlResults = await onPipeline(ttlCommands);

                  if (ttlResults?.success && Array.isArray(ttlResults.results)) {
                    for (let i = 0; i < matchedKeys.length; i++) {
                      allKeys.push({
                        key: matchedKeys[i],
                        type: matchedTypes[i],
                        ttl: ttlResults.results[i]?.success ? ttlResults.results[i].data : -1,
                      });
                    }
                  }
                }
              }
            } else {
              // 非 pipeline 模式
              for (const key of scannedKeys) {
                const typeResult = await onExecute(`TYPE "${key}"`);
                const keyType = typeResult?.data || 'unknown';

                // 如果没有类型过滤，或者类型匹配
                if (typeFilter === 'all' || keyType === typeFilter) {
                  const ttlResult = await onExecute(`TTL "${key}"`);
                  allKeys.push({
                    key,
                    type: keyType,
                    ttl: ttlResult?.data ?? -1,
                  });
                }
              }
            }

            // 实时更新 UI
            setKeys([...allKeys]);
            setTotalScanned(allKeys.length);
          }
        } else {
          break;
        }
      } while (cursor !== '0');

      cursorRef.current = '0';
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, [searchPattern, keysPerPage, onExecute, onPipeline, typeFilter]);

  // 切换数据库
  const handleDbChange = useCallback(async (db: number) => {
    const result = await onExecute(`SELECT ${db}`);
    if (result?.success) {
      setCurrentDb(db);
      // 切换后重新扫描
      cursorRef.current = '0';
      isScanning.current = false;
      setKeys([]);
      setSelectedKey(null);
      setKeyValue(null);
      setExpandedPaths(new Set());
      setTimeout(() => scanKeys(true), 100);
    }
  }, [onExecute, scanKeys]);

  // 复制到剪贴板
  const copyToClipboard = useCallback(async (text: string, type: 'key' | 'value') => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === 'key') {
        setCopiedKey(true);
        setTimeout(() => setCopiedKey(false), 2000);
      } else {
        setCopiedValue(true);
        setTimeout(() => setCopiedValue(false), 2000);
      }
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, []);

  // 获取可复制的值字符串
  const getValueString = useCallback(() => {
    if (!keyValue) return '';
    const { type, value } = keyValue;
    if (type === 'string') {
      return value ?? '';
    }
    return JSON.stringify(value, null, 2);
  }, [keyValue]);

  // 渲染树形节点
  const renderTreeNode = (node: TreeNode, depth: number = 0): React.ReactNode => {
    const sortedChildren = Array.from(node.children.entries()).sort((a, b) =>
      sortOrder === 'asc' ? a[0].localeCompare(b[0]) : b[0].localeCompare(a[0])
    );

    // 根据用户选择的排序方式排序 keys
    const sortedKeys = [...node.keys].sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case 'name':
          cmp = a.key.localeCompare(b.key);
          break;
        case 'type':
          cmp = a.type.localeCompare(b.type);
          break;
        case 'ttl':
          const ttlA = a.ttl === -1 ? Infinity : a.ttl;
          const ttlB = b.ttl === -1 ? Infinity : b.ttl;
          cmp = ttlA - ttlB;
          break;
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });

    return (
      <>
        {/* 渲染子文件夹 */}
        {sortedChildren.map(([name, child]) => {
          const childCount = countKeys(child);
          const childExpanded = expandedPaths.has(child.fullPath);

          return (
            <div key={child.fullPath} className="tree-node">
              <div
                className="tree-folder"
                style={{ paddingLeft: depth * 16 + 8 }}
                onClick={() => toggleExpand(child.fullPath)}
              >
                <span className="tree-toggle">{childExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
                <span className="tree-folder-icon"><FolderOpen size={14} /></span>
                <span className="tree-folder-name">{name}</span>
                <span className="tree-folder-count">({childCount})</span>
              </div>
              {childExpanded && renderTreeNode(child, depth + 1)}
            </div>
          );
        })}

        {/* 渲染当前节点的 keys */}
        {sortedKeys.map(({ key, type }) => {
          // 获取 key 的最后一部分作为显示名
          const parts = key.split(':');
          const displayName = parts[parts.length - 1] || key;

          return (
            <div
              key={key}
              className={`tree-key ${selectedKey === key ? 'selected' : ''}`}
              style={{ paddingLeft: depth * 16 + 8 }}
              onClick={() => loadKeyValue(key, type)}
            >
              <span className="tree-key-icon">{getTypeIcon(type)}</span>
              <span className="tree-key-name" title={key}>{displayName}</span>
              <button
                className="delete-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteKey(key);
                }}
                title={t('keyBrowser.delete')}
              >
                <Trash2 size={14} />
              </button>
            </div>
          );
        })}
      </>
    );
  };

  // 列表项高度（用于虚拟滚动）
  const LIST_ITEM_HEIGHT = 44;

  // 虚拟滚动列表项渲染器
  const ListItemRenderer = useCallback(({ index, style }: { index: number; style: React.CSSProperties }) => {
    const { key, type, ttl } = filteredKeys[index];
    return (
      <div
        style={style}
        className={`key-item ${selectedKey === key ? 'selected' : ''}`}
        onClick={() => loadKeyValue(key, type)}
      >
        <span className="key-icon">{getTypeIcon(type)}</span>
        <div className="key-info">
          <span className="key-name" title={key}>{key}</span>
          <span className="key-meta">
            {type} | TTL: {ttl === -1 ? '∞' : ttl === -2 ? 'N/A' : `${ttl}s`}
          </span>
        </div>
        <button
          className="delete-btn"
          onClick={(e) => {
            e.stopPropagation();
            deleteKey(key);
          }}
          title={t('keyBrowser.delete')}
        >
          🗑️
        </button>
      </div>
    );
  }, [filteredKeys, selectedKey, loadKeyValue, getTypeIcon, deleteKey, t]);

  // 列表容器引用（用于获取高度）
  const listContainerRef = useRef<HTMLDivElement>(null);
  const [listHeight, setListHeight] = useState(400);

  // 监听容器高度变化
  useEffect(() => {
    const updateHeight = () => {
      if (listContainerRef.current) {
        const rect = listContainerRef.current.getBoundingClientRect();
        setListHeight(rect.height || 400);
      }
    };

    updateHeight();
    window.addEventListener('resize', updateHeight);
    return () => window.removeEventListener('resize', updateHeight);
  }, []);

  // 渲染列表视图（虚拟滚动优化版）
  const renderListView = () => (
    <div
      ref={listContainerRef}
      className={`list-view-content ${sortAnimating ? 'sort-animating' : ''}`}
      style={{ flex: 1, minHeight: 0 }}
    >
      {filteredKeys.length > 0 ? (
        <VirtualList
          height={listHeight}
          width="100%"
          itemCount={filteredKeys.length}
          itemSize={LIST_ITEM_HEIGHT}
          overscanCount={5}
        >
          {ListItemRenderer}
        </VirtualList>
      ) : (
        <div className="empty-list">
          {t('keyBrowser.noKeys') || '没有找到 keys'}
        </div>
      )}
    </div>
  );

  return (
    <div className="key-browser">
      <div className="browser-header">
        <div className="header-left">
          <h3>{t('keyBrowser.title')}</h3>
          <select
            className="db-selector"
            value={currentDb}
            onChange={e => handleDbChange(Number(e.target.value))}
            disabled={loading}
          >
            {Array.from({ length: 16 }, (_, i) => (
              <option key={i} value={i}>DB{i}</option>
            ))}
          </select>
          <button
            className="server-info-btn"
            onClick={() => setShowServerInfo(true)}
            title={settings.language === 'zh-CN' ? '服务器信息' : 'Server Info'}
          >
            <Server size={14} />
          </button>
          <button
            className="server-info-btn"
            onClick={() => setShowPerformance(true)}
            title={settings.language === 'zh-CN' ? '性能监控' : 'Performance Monitor'}
          >
            <Activity size={14} />
          </button>
          <button
            className="server-info-btn"
            onClick={() => setShowPubSub(true)}
            title="Pub/Sub"
          >
            <Radio size={14} />
          </button>
          <button
            className="server-info-btn"
            onClick={() => setShowSlowLog(true)}
            title={settings.language === 'zh-CN' ? '慢查询分析' : 'Slow Log'}
          >
            <Clock size={14} />
          </button>
          <button
            className="server-info-btn"
            onClick={() => setShowBigKey(true)}
            title={settings.language === 'zh-CN' ? '大 Key 分析' : 'Big Key Analysis'}
          >
            <Database size={14} />
          </button>
          <button
            className="server-info-btn"
            onClick={() => setShowMemory(true)}
            title={settings.language === 'zh-CN' ? '内存分析' : 'Memory Analysis'}
          >
            <HardDrive size={14} />
          </button>
          <button
            className="server-info-btn"
            onClick={() => setShowLuaEditor(true)}
            title={settings.language === 'zh-CN' ? 'Lua 编辑器' : 'Lua Editor'}
          >
            <Code size={14} />
          </button>
        </div>
        <div className="search-bar">
          <input
            type="text"
            value={searchPattern}
            onChange={e => setSearchPattern(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleScan()}
            placeholder={t('keyBrowser.search')}
          />
          <button
            className="primary"
            onClick={handleScan}
            disabled={loading}
            title={settings.language === 'zh-CN'
              ? `每次扫描 ${keysPerPage} 条数据`
              : `Scan ${keysPerPage} items per batch`}
          >
            {loading ? t('keyBrowser.scanning') : t('keyBrowser.scan')}
          </button>
          <button
            className="secondary"
            onClick={handleFullSearch}
            disabled={loading}
            title={settings.language === 'zh-CN'
              ? '扫描全库所有匹配的 Key'
              : 'Scan all matching keys in database'}
          >
            {t('keyBrowser.fullSearch')}
          </button>
        </div>
      </div>

      <div className="browser-body" ref={containerRef}>
        <div className="key-list" style={{ width: listWidth }}>
          <div className="list-header">
            {/* 第一行：Keys 标题和数量 */}
            <div className="list-header-row title-row">
              <span className="list-title">Keys</span>
              <span className="key-count">
                {typeFilter === 'all' ? totalScanned : filteredKeys.length}
                {typeFilter === 'all' && hasMore ? '+' : ''}
              </span>
            </div>
            {/* 第二行：选择器 */}
            <div className="list-header-row selectors-row">
              {/* 类型过滤 */}
              <select
                className="type-filter"
                value={typeFilter}
                onChange={e => {
                  const newFilter = e.target.value;
                  setTypeFilter(newFilter);
                  // 类型过滤变化时，重新扫描
                  cursorRef.current = '0';
                  isScanning.current = false;
                  setKeys([]);
                  setSelectedKey(null);
                  setKeyValue(null);
                  setExpandedPaths(new Set());
                  setTimeout(() => scanKeys(true, newFilter), 0);
                }}
                title={settings.language === 'zh-CN' ? '按类型过滤' : 'Filter by type'}
                disabled={loading}
              >
                <option value="all">{settings.language === 'zh-CN' ? '全部类型' : 'All Types'}</option>
                <option value="string">String</option>
                <option value="hash">Hash</option>
                <option value="list">List</option>
                <option value="set">Set</option>
                <option value="zset">ZSet</option>
                <option value="stream">Stream</option>
              </select>
              {/* 排序 */}
              <select
                className="sort-select"
                value={`${sortBy}-${sortOrder}`}
                onChange={e => {
                  const [by, order] = e.target.value.split('-') as ['name' | 'type' | 'ttl', 'asc' | 'desc'];
                  setSortBy(by);
                  setSortOrder(order);
                  // 触发排序动画
                  setSortAnimating(true);
                  setTimeout(() => setSortAnimating(false), 300);
                }}
                title={settings.language === 'zh-CN' ? '排序方式' : 'Sort by'}
              >
                <option value="name-asc">{settings.language === 'zh-CN' ? '名称 ↑' : 'Name ↑'}</option>
                <option value="name-desc">{settings.language === 'zh-CN' ? '名称 ↓' : 'Name ↓'}</option>
                <option value="type-asc">{settings.language === 'zh-CN' ? '类型 ↑' : 'Type ↑'}</option>
                <option value="type-desc">{settings.language === 'zh-CN' ? '类型 ↓' : 'Type ↓'}</option>
                <option value="ttl-asc">{settings.language === 'zh-CN' ? 'TTL ↑' : 'TTL ↑'}</option>
                <option value="ttl-desc">{settings.language === 'zh-CN' ? 'TTL ↓' : 'TTL ↓'}</option>
              </select>
            </div>
            {/* 第三行：功能按钮 */}
            <div className="list-header-row actions-row">
              {/* 新建 Key 按钮 */}
              <button
                className="primary add-key-btn"
                onClick={() => setShowNewKeyModal(true)}
                title={settings.language === 'zh-CN' ? '新建 Key' : 'New Key'}
              >
                <Plus size={14} />
              </button>
              {/* 导入按钮 */}
              <button
                className="secondary"
                onClick={() => setShowImportModal(true)}
                title={settings.language === 'zh-CN' ? '导入' : 'Import'}
              >
                <Upload size={14} />
              </button>
              {/* 导出按钮 */}
              {keys.length > 0 && (
                <button
                  className="secondary"
                  onClick={() => setShowExportModal(true)}
                  title={settings.language === 'zh-CN' ? '导出' : 'Export'}
                >
                  <Download size={14} />
                </button>
              )}
              {/* 视图切换按钮 */}
              <button
                className={`view-toggle ${viewMode === 'tree' ? 'active' : ''}`}
                onClick={() => setViewMode('tree')}
                title="树形视图"
              >
                <FolderTree size={14} />
              </button>
              <button
                className={`view-toggle ${viewMode === 'list' ? 'active' : ''}`}
                onClick={() => setViewMode('list')}
                title="列表视图"
              >
                <ListOrdered size={14} />
              </button>
              <button className="secondary" onClick={handleScan} disabled={loading}>
                <RefreshCw size={14} />
              </button>
              {/* 批量设置 TTL 按钮 */}
              {keys.length > 0 && (
                <button
                  className="secondary batch-ttl-btn"
                  onClick={() => setShowBatchTTL(true)}
                  disabled={loading}
                  title={settings.language === 'zh-CN' ? '批量设置 TTL' : 'Batch Set TTL'}
                >
                  <Clock size={14} />
                </button>
              )}
              {/* 批量删除按钮 */}
              {keys.length > 0 && (
                <button
                  className="danger delete-all-btn"
                  onClick={deleteAllKeys}
                  disabled={loading}
                  title={t('keyBrowser.deleteAll')}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
          <div className="list-content">
            {keys.length === 0 ? (
              <div className={`empty-keys ${loading ? 'loading' : ''}`}>
                {loading && <div className="loading-spinner" />}
                <span>{loading ? t('keyBrowser.scanning') : t('keyBrowser.noKeys')}</span>
              </div>
            ) : viewMode === 'tree' ? (
              <div className="tree-view">
                {renderTreeNode(treeData)}
              </div>
            ) : (
              renderListView()
            )}
          </div>

          {/* 加载更多 / 加载全部按钮 */}
          {hasMore && keys.length > 0 && (
            <div className="load-more">
              <div className="load-buttons">
                <button
                  className="load-more-btn"
                  onClick={loadMore}
                  disabled={loading}
                  title={settings.language === 'zh-CN'
                    ? `每次加载 ${keysPerPage} 条数据`
                    : `Load ${keysPerPage} items per batch`}
                >
                  {loading ? t('keyBrowser.scanning') : t('keyBrowser.loadMore') || '加载更多'}
                </button>
                <button
                  className="load-all-btn"
                  onClick={loadAll}
                  disabled={loading}
                  title={settings.language === 'zh-CN'
                    ? '加载所有剩余数据'
                    : 'Load all remaining items'}
                >
                  {t('keyBrowser.loadAll') || '加载全部'}
                </button>
              </div>
            </div>
          )}

          {/* 已加载完毕提示 */}
          {!hasMore && keys.length > 0 && (
            <div className="load-complete">
              {t('keyBrowser.total')} {totalScanned} {t('keyBrowser.items')}
            </div>
          )}
        </div>

        {/* 可拖拽分隔条 */}
        <div
          className={`resizer ${isDragging ? 'dragging' : ''}`}
          onMouseDown={handleMouseDown}
        />

        <div className="key-detail">
          {selectedKey ? (
            <>
              <div className="detail-header">
                {/* 第一行：Key 名称 */}
                <div className="detail-header-row key-row">
                  {isEditing ? (
                    <input
                      type="text"
                      className="edit-key-input"
                      value={editKeyName}
                      onChange={(e) => setEditKeyName(e.target.value)}
                      placeholder="Key 名称"
                    />
                  ) : (
                    <span className="detail-key">{selectedKey}</span>
                  )}
                </div>
                {/* 第二行：类型、内存、TTL 信息 */}
                {!isEditing && (
                  <div className="detail-header-row meta-row">
                    <span className="detail-type">{keyValue?.type}</span>
                    {keyValue?.memory !== null && keyValue?.memory !== undefined && (
                      <span className="detail-memory" title={settings.language === 'zh-CN' ? '内存占用' : 'Memory Usage'}>
                        💾 {formatMemorySize(keyValue.memory)}
                      </span>
                    )}
                    <span className={`detail-expire ${expireDisplay.className}`}>
                      {expireDisplay.icon} {expireDisplay.label}
                      {expireDisplay.sublabel && <span className="ttl-seconds">{expireDisplay.sublabel}</span>}
                    </span>
                  </div>
                )}
                {/* 第三行：功能按钮 */}
                {!isEditing && (
                  <div className="detail-header-row actions-row">
                    <button
                      className={`detail-action-btn ${copiedKey ? 'copied' : ''}`}
                      onClick={() => copyToClipboard(selectedKey, 'key')}
                      title={settings.language === 'zh-CN' ? '复制 Key 名称' : 'Copy Key Name'}
                    >
                      {copiedKey ? <Check size={14} /> : <Copy size={14} />}
                      <span>{settings.language === 'zh-CN' ? '复制 Key' : 'Copy Key'}</span>
                    </button>
                    <button
                      className={`detail-action-btn ${copiedValue ? 'copied' : ''}`}
                      onClick={() => copyToClipboard(getValueString(), 'value')}
                      title={settings.language === 'zh-CN' ? '复制值' : 'Copy Value'}
                    >
                      {copiedValue ? <Check size={14} /> : <Copy size={14} />}
                      <span>{settings.language === 'zh-CN' ? '复制值' : 'Copy Value'}</span>
                    </button>
                    <button
                      className="detail-action-btn"
                      onClick={enterEditMode}
                      title={settings.language === 'zh-CN' ? '编辑' : 'Edit'}
                    >
                      <Pencil size={14} />
                      <span>{settings.language === 'zh-CN' ? '编辑' : 'Edit'}</span>
                    </button>
                    <button
                      className="detail-action-btn"
                      onClick={() => openCopyKeyModal(selectedKey!)}
                      title={settings.language === 'zh-CN' ? '复制 Key' : 'Duplicate Key'}
                    >
                      <Files size={14} />
                      <span>{settings.language === 'zh-CN' ? '复制为' : 'Duplicate'}</span>
                    </button>
                  </div>
                )}
              </div>

              {isEditing && (
                <div className="edit-ttl-row">
                  <label>TTL (秒):</label>
                  <input
                    type="text"
                    className="edit-ttl-input"
                    value={editTTL}
                    onChange={(e) => setEditTTL(e.target.value)}
                    placeholder="留空表示永不过期"
                  />
                  <span className="ttl-hint">-1 或留空 = 永不过期</span>
                </div>
              )}

              <div className="detail-content">
                {keyLoading ? (
                  <div className="loading">{t('keyBrowser.loading')}</div>
                ) : isEditing ? (
                  <div className="edit-value-container">
                    <textarea
                      className="edit-value-textarea"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      placeholder={
                        keyValue?.type === 'string' ? '输入字符串值' :
                        keyValue?.type === 'hash' ? '输入 JSON 对象，如 {"field": "value"}' :
                        keyValue?.type === 'list' || keyValue?.type === 'set' ? '输入 JSON 数组，如 ["item1", "item2"]' :
                        keyValue?.type === 'zset' ? '输入 [{member: "xxx", score: 1}] 格式' :
                        '输入值'
                      }
                    />
                    <div className="edit-hint">
                      {keyValue?.type === 'string' && '直接输入字符串内容'}
                      {keyValue?.type === 'hash' && 'JSON 对象格式: {"field1": "value1", "field2": "value2"}'}
                      {keyValue?.type === 'list' && 'JSON 数组格式: ["item1", "item2", "item3"]'}
                      {keyValue?.type === 'set' && 'JSON 数组格式: ["member1", "member2"]'}
                      {keyValue?.type === 'zset' && '数组格式: [{"member": "xxx", "score": 1}, ...]'}
                    </div>
                  </div>
                ) : (
                  renderFormattedValue()
                )}
              </div>

              {isEditing && (
                <div className="edit-actions">
                  <button className="cancel-btn" onClick={cancelEdit} disabled={saving}>
                    取消
                  </button>
                  <button className="save-btn" onClick={saveEdit} disabled={saving}>
                    {saving ? '保存中...' : '保存'}
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="no-selection">
              <p>{t('keyBrowser.selectKey')}</p>
            </div>
          )}
        </div>
      </div>

      {/* 删除单个 Key 确认弹窗 */}
      <ConfirmModal
        isOpen={deleteKeyConfirm !== null}
        title={settings.language === 'zh-CN' ? '删除 Key' : 'Delete Key'}
        message={settings.language === 'zh-CN'
          ? `确定要删除「${deleteKeyConfirm}」吗？此操作不可恢复。`
          : `Are you sure you want to delete "${deleteKeyConfirm}"? This action cannot be undone.`}
        confirmText={t('keyBrowser.delete')}
        cancelText={t('common.cancel')}
        type="danger"
        onConfirm={confirmDeleteKey}
        onCancel={() => setDeleteKeyConfirm(null)}
      />

      {/* 批量删除确认弹窗 */}
      <ConfirmModal
        isOpen={deleteAllConfirm}
        title={settings.language === 'zh-CN' ? '批量删除' : 'Batch Delete'}
        message={settings.language === 'zh-CN'
          ? `确定要删除当前列表中的 ${keys.length} 个 Key 吗？此操作不可恢复！`
          : `Are you sure you want to delete ${keys.length} keys from the current list? This action cannot be undone!`}
        confirmText={t('keyBrowser.delete')}
        cancelText={t('common.cancel')}
        type="danger"
        onConfirm={confirmDeleteAllKeys}
        onCancel={() => setDeleteAllConfirm(false)}
      />

      {/* 复制 Key 弹窗 */}
      <Modal
        isOpen={!!copyKeySource}
        onClose={() => setCopyKeySource(null)}
        title={settings.language === 'zh-CN' ? '复制 Key' : 'Duplicate Key'}
        width={450}
        minWidth={350}
        minHeight={200}
        className="copy-key-modal"
        storageKey="copy-key"
      >
        <div className="modal-body-inner">
          <div className="form-group">
            <label>{settings.language === 'zh-CN' ? '源 Key' : 'Source Key'}</label>
            <input type="text" value={copyKeySource || ''} disabled />
          </div>
          <div className="form-group">
            <label>{settings.language === 'zh-CN' ? '目标 Key' : 'Target Key'}</label>
            <input
              type="text"
              value={copyKeyTarget}
              onChange={e => setCopyKeyTarget(e.target.value)}
              placeholder={settings.language === 'zh-CN' ? '输入新的 Key 名称' : 'Enter new key name'}
              autoFocus
            />
          </div>
        </div>
        <div className="modal-footer">
          <button className="secondary" onClick={() => setCopyKeySource(null)}>
            {t('common.cancel')}
          </button>
          <button
            className="primary"
            onClick={confirmCopyKey}
            disabled={!copyKeyTarget.trim() || copyKeyTarget === copyKeySource}
          >
            {settings.language === 'zh-CN' ? '复制' : 'Duplicate'}
          </button>
        </div>
      </Modal>

      {/* 批量设置 TTL 弹窗 */}
      <Modal
        isOpen={showBatchTTL}
        onClose={() => setShowBatchTTL(false)}
        title={settings.language === 'zh-CN' ? '批量设置 TTL' : 'Batch Set TTL'}
        width={450}
        minWidth={350}
        minHeight={200}
        className="batch-ttl-modal"
        storageKey="batch-ttl"
      >
        <div className="modal-body-inner">
          <div className="form-group">
            <label>{settings.language === 'zh-CN' ? '影响范围' : 'Affected Keys'}</label>
            <input type="text" value={`${filteredKeys.length} keys`} disabled />
          </div>
          <div className="form-group">
            <label>{settings.language === 'zh-CN' ? 'TTL (秒)' : 'TTL (seconds)'}</label>
            <input
              type="number"
              value={batchTTLValue}
              onChange={e => setBatchTTLValue(e.target.value)}
              placeholder={settings.language === 'zh-CN' ? '输入秒数，-1 表示永不过期' : 'Seconds, -1 for no expiry'}
              autoFocus
            />
            <p className="form-hint">
              {settings.language === 'zh-CN'
                ? '输入 -1 移除过期时间（永不过期）'
                : 'Enter -1 to remove expiry (persist)'}
            </p>
          </div>
        </div>
        <div className="modal-footer">
          <button className="secondary" onClick={() => setShowBatchTTL(false)}>
            {t('common.cancel')}
          </button>
          <button
            className="primary"
            onClick={confirmBatchTTL}
            disabled={!batchTTLValue.trim() || isNaN(parseInt(batchTTLValue, 10))}
          >
            {settings.language === 'zh-CN' ? '确定' : 'Apply'}
          </button>
        </div>
      </Modal>

      {/* 新建 Key 弹窗 */}
      <NewKeyModal
        isOpen={showNewKeyModal}
        onClose={() => setShowNewKeyModal(false)}
        onExecute={onExecute}
        onSuccess={handleScan}
      />

      {/* 导出弹窗 */}
      <ExportImportModal
        isOpen={showExportModal}
        mode="export"
        onClose={() => setShowExportModal(false)}
        onExecute={onExecute}
        keys={keys}
        onSuccess={handleScan}
      />

      {/* 导入弹窗 */}
      <ExportImportModal
        isOpen={showImportModal}
        mode="import"
        onClose={() => setShowImportModal(false)}
        onExecute={onExecute}
        keys={keys}
        onSuccess={handleScan}
      />

      {/* 服务器信息弹窗 */}
      <ServerInfoModal
        isOpen={showServerInfo}
        onClose={() => setShowServerInfo(false)}
        onExecute={onExecute}
      />

      {/* Pub/Sub 面板 */}
      <PubSubPanel
        isOpen={showPubSub}
        onClose={() => setShowPubSub(false)}
        onExecute={onExecute}
        connectionId={connectionId}
      />

      {/* 性能监控面板 */}
      <PerformanceChart
        isOpen={showPerformance}
        onClose={() => setShowPerformance(false)}
        onExecute={onExecute}
      />

      {/* 慢查询分析面板 */}
      <SlowLogPanel
        isOpen={showSlowLog}
        onClose={() => setShowSlowLog(false)}
        onExecute={onExecute}
      />

      {/* 大 Key 分析面板 */}
      <BigKeyPanel
        isOpen={showBigKey}
        onClose={() => setShowBigKey(false)}
        onExecute={onExecute}
        onPipeline={onPipeline}
      />

      {/* 内存分析面板 */}
      <MemoryAnalyzer
        isOpen={showMemory}
        onClose={() => setShowMemory(false)}
        onExecute={onExecute}
        onPipeline={onPipeline}
      />

      {/* Lua 编辑器 */}
      <LuaEditor
        isOpen={showLuaEditor}
        onClose={() => setShowLuaEditor(false)}
        onExecute={onExecute}
      />
    </div>
  );
}

export default React.memo(KeyBrowser);
