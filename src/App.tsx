import { useState, useCallback, useEffect, useRef } from 'react';
import { Unplug, ChevronRight, ChevronLeft, ChevronDown, Loader2 } from 'lucide-react';
import { SettingsProvider, useSettings } from './contexts/SettingsContext';
import { ToastProvider } from './components/Toast';
import { TitleBar } from './components/TitleBar';
import ConnectionPanel from './components/ConnectionPanel';
import CommandConsole from './components/CommandConsole';
import KeyBrowser from './components/KeyBrowser';
import StatusBar from './components/StatusBar';
import SettingsButton from './components/SettingsButton';
import ShortcutsModal from './components/ShortcutsModal';
import { debounce } from './utils';
import './styles/app.css';

interface Connection {
  id: string;
  name: string;
  host: string;
  port: number;
  password?: string;
  db?: number;
  status: 'connected' | 'connecting' | 'disconnecting' | 'disconnected' | 'error';
  // SSH 配置
  useSSH?: boolean;
  sshHost?: string;
  sshPort?: number;
  sshUsername?: string;
  sshAuthType?: 'password' | 'privateKey';
  sshPassword?: string;
  sshPrivateKey?: string;
  sshPassphrase?: string;
}

// 历史记录最大条数（防止内存无限增长）
const MAX_HISTORY_SIZE = 1000;

// 布局配置存储 key
const LAYOUT_STORAGE_KEY = 'app-layout';

// 命令历史存储 key
const COMMAND_HISTORY_KEY = 'command-history';

// 加载布局配置
function loadLayoutConfig() {
  try {
    const saved = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.error('Failed to load layout config:', e);
  }
  return {
    sidebarWidth: 280,
    sidebarVisible: true,
    consoleHeight: 200,
    consoleVisible: true,
  };
}

// 保存布局配置（内部实现）
function _saveLayoutConfig(config: {
  sidebarWidth: number;
  sidebarVisible: boolean;
  consoleHeight: number;
  consoleVisible: boolean;
}) {
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(config));
  } catch (e) {
    console.error('Failed to save layout config:', e);
  }
}

// 防抖版本的布局保存（500ms 延迟）
const saveLayoutConfig = debounce(_saveLayoutConfig, 500);

// 加载命令历史
function loadCommandHistory(): Array<{ command: string; result: any; duration: number; timestamp: Date }> {
  try {
    const saved = localStorage.getItem(COMMAND_HISTORY_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      // 转换 timestamp 字符串为 Date 对象
      return parsed.map((item: any) => ({
        ...item,
        timestamp: new Date(item.timestamp),
      }));
    }
  } catch (e) {
    console.error('Failed to load command history:', e);
  }
  return [];
}

// 保存命令历史（内部实现）
function _saveCommandHistory(history: Array<{ command: string; result: any; duration: number; timestamp: Date }>) {
  try {
    // 只保存最近的 MAX_HISTORY_SIZE 条
    const toSave = history.slice(-MAX_HISTORY_SIZE);
    localStorage.setItem(COMMAND_HISTORY_KEY, JSON.stringify(toSave));
  } catch (e) {
    console.error('Failed to save command history:', e);
  }
}

// 防抖版本的命令历史保存（1000ms 延迟）
const saveCommandHistory = debounce(_saveCommandHistory, 1000);

function AppContent() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(null);
  const [commandHistory, setCommandHistory] = useState<Array<{ command: string; result: any; duration: number; timestamp: Date }>>(loadCommandHistory);
  const { t } = useSettings();

  // 加载布局配置
  const layoutConfig = loadLayoutConfig();

  // 控制台高度和显示状态
  const [consoleHeight, setConsoleHeight] = useState(layoutConfig.consoleHeight);
  const [consoleVisible, setConsoleVisible] = useState(layoutConfig.consoleVisible);
  const [isConsoleDragging, setIsConsoleDragging] = useState(false);
  const mainContentRef = useRef<HTMLDivElement>(null);

  // 侧边栏宽度和拖拽状态
  const [sidebarWidth, setSidebarWidth] = useState(layoutConfig.sidebarWidth);
  const [isSidebarDragging, setIsSidebarDragging] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(layoutConfig.sidebarVisible);
  const appBodyRef = useRef<HTMLDivElement>(null);

  // KeyBrowser 刷新触发器
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // 已加载连接配置标记
  const [configLoaded, setConfigLoaded] = useState(false);

  // 快捷键帮助面板
  const [showShortcuts, setShowShortcuts] = useState(false);

  const activeConnection = connections.find(c => c.id === activeConnectionId);

  // 加载保存的连接配置
  const loadSavedConnections = useCallback(async () => {
    const result = await window.electronAPI?.config.load();
    if (result?.success && result.configs?.length > 0) {
      // 将保存的配置转换为 Connection 对象（状态为 disconnected）
      const savedConnections: Connection[] = result.configs.map((config: any, index: number) => ({
        id: `saved_${index}_${Date.now()}`,
        name: config.name || `${config.host}:${config.port}`,
        host: config.host,
        port: config.port,
        password: config.password,
        db: config.db,
        status: 'disconnected' as const,
        useSSH: config.useSSH,
        sshHost: config.ssh?.host,
        sshPort: config.ssh?.port,
        sshUsername: config.ssh?.username,
        sshAuthType: config.ssh?.authType,
        sshPassword: config.ssh?.password,
        sshPrivateKey: config.ssh?.privateKey,
        sshPassphrase: config.ssh?.passphrase,
        // TLS 配置
        tls: config.tls,
      }));
      setConnections(savedConnections);
    } else if (result?.success) {
      // 配置为空时清空连接列表
      setConnections([]);
    }
    setConfigLoaded(true);
  }, []);

  // 启动时加载保存的连接配置
  useEffect(() => {
    loadSavedConnections();
  }, [loadSavedConnections]);

  // 保存连接配置（当连接列表变化时）
  useEffect(() => {
    if (!configLoaded) return; // 等待初始加载完成

    const configsToSave = connections.map(conn => ({
      name: conn.name,
      host: conn.host,
      port: conn.port,
      password: conn.password,
      db: conn.db,
      useSSH: conn.useSSH,
      ssh: conn.useSSH ? {
        host: conn.sshHost,
        port: conn.sshPort,
        username: conn.sshUsername,
        authType: conn.sshAuthType,
        password: conn.sshPassword,
        privateKey: conn.sshPrivateKey,
        passphrase: conn.sshPassphrase,
      } : undefined,
    }));
    window.electronAPI?.config.save(configsToSave);
  }, [connections, configLoaded]);

  // 保存布局配置
  useEffect(() => {
    saveLayoutConfig({
      sidebarWidth,
      sidebarVisible,
      consoleHeight,
      consoleVisible,
    });
  }, [sidebarWidth, sidebarVisible, consoleHeight, consoleVisible]);

  // 保存命令历史
  useEffect(() => {
    saveCommandHistory(commandHistory);
  }, [commandHistory]);

  // 监听连接状态变化
  useEffect(() => {
    const unsubscribe = window.electronAPI?.on('redis:status', (connectionId: string, status: string) => {
      setConnections(prev => prev.map(c =>
        c.id === connectionId ? { ...c, status: status as Connection['status'] } : c
      ));
    });

    return () => unsubscribe?.();
  }, []);

  // 连接到 Redis
  const handleConnect = useCallback(async (config: {
    name: string;
    host: string;
    port: number;
    password?: string;
    db?: number;
    useSSH?: boolean;
    ssh?: {
      host: string;
      port: number;
      username: string;
      authType: 'password' | 'privateKey';
      password?: string;
      privateKey?: string;
      passphrase?: string;
    };
    existingId?: string; // 已存在的连接 ID（用于编辑/重连）
  }) => {
    // 如果是已存在的连接，先设置为 connecting 状态
    if (config.existingId) {
      setConnections(prev => prev.map(c =>
        c.id === config.existingId ? { ...c, status: 'connecting' as const } : c
      ));
    }

    const result = await window.electronAPI?.redis.connect(config);

    if (result?.success) {
      const newConnection: Connection = {
        id: result.connectionId,
        name: config.name || `${config.host}:${config.port}`,
        host: config.host,
        port: config.port,
        password: config.password,
        db: config.db,
        status: 'connected',
        useSSH: config.useSSH,
        sshHost: config.ssh?.host,
        sshPort: config.ssh?.port,
        sshUsername: config.ssh?.username,
        sshAuthType: config.ssh?.authType,
        sshPassword: config.ssh?.password,
        sshPrivateKey: config.ssh?.privateKey,
        sshPassphrase: config.ssh?.passphrase,
      };

      if (config.existingId) {
        // 更新已存在的连接（编辑或重连）
        setConnections(prev => prev.map(c =>
          c.id === config.existingId ? newConnection : c
        ));
      } else {
        // 添加新连接
        setConnections(prev => [...prev, newConnection]);
      }
      setActiveConnectionId(result.connectionId);
      return { success: true };
    }

    // 连接失败，重置状态为 disconnected
    if (config.existingId) {
      setConnections(prev => prev.map(c =>
        c.id === config.existingId ? { ...c, status: 'disconnected' as const } : c
      ));
    }

    return { success: false, error: result?.error || t('status.error') };
  }, [t]);

  // 断开连接
  const handleDisconnect = useCallback(async (connectionId: string) => {
    // 先设置为断开中状态
    setConnections(prev => prev.map(c =>
      c.id === connectionId ? { ...c, status: 'disconnecting' as const } : c
    ));

    try {
      await window.electronAPI?.redis.disconnect(connectionId);
    } finally {
      // 断开完成，设置为已断开状态
      setConnections(prev => prev.map(c =>
        c.id === connectionId ? { ...c, status: 'disconnected' as const } : c
      ));
    }

    // 使用函数式更新来避免闭包问题
    setActiveConnectionId(prevActiveId => {
      if (prevActiveId === connectionId) {
        // 需要从最新的 connections 中找其他已连接的
        return null; // 先设为 null，下面再处理
      }
      return prevActiveId;
    });
  }, []);

  // 删除连接
  const handleDeleteConnection = useCallback((connectionId: string) => {
    setConnections(prev => prev.filter(c => c.id !== connectionId));
    if (activeConnectionId === connectionId) {
      setActiveConnectionId(connections.find(c => c.id !== connectionId)?.id || null);
    }
  }, [activeConnectionId, connections]);

  // 刷新连接（重新扫描 keys）
  const handleRefreshConnection = useCallback((connectionId: string) => {
    if (connectionId === activeConnectionId) {
      setRefreshTrigger(prev => prev + 1);
    }
  }, [activeConnectionId]);

  // 执行命令
  const handleExecute = useCallback(async (command: string) => {
    if (!activeConnectionId) return null;

    const result = await window.electronAPI?.redis.execute(activeConnectionId, command);

    const historyEntry = {
      command,
      result: result?.success ? result.data : { error: result?.error },
      duration: result?.duration || 0,
      timestamp: new Date(),
    };

    setCommandHistory(prev => {
      const newHistory = [...prev, historyEntry];
      // 超过上限时移除最旧的记录（LRU 策略）
      if (newHistory.length > MAX_HISTORY_SIZE) {
        return newHistory.slice(-MAX_HISTORY_SIZE);
      }
      return newHistory;
    });
    return result;
  }, [activeConnectionId]);

  // Pipeline 批量执行命令
  const handlePipeline = useCallback(async (commands: string[]) => {
    if (!activeConnectionId) return null;
    return await window.electronAPI?.redis.pipeline(activeConnectionId, commands);
  }, [activeConnectionId]);

  // 为指定连接执行命令（用于详情弹窗）
  const handleExecuteForConnection = useCallback(async (connectionId: string, command: string) => {
    return await window.electronAPI?.redis.execute(connectionId, command);
  }, []);

  // 全局快捷键处理
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 忽略输入框中的快捷键
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      // F1 或 Ctrl/Cmd + ?: 显示快捷键帮助
      if (e.key === 'F1' || ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === '/')) {
        e.preventDefault();
        setShowShortcuts(prev => !prev);
        return;
      }

      // Escape: 关闭弹窗
      if (e.key === 'Escape') {
        if (showShortcuts) {
          setShowShortcuts(false);
          return;
        }
        if (consoleVisible && !isInput) {
          setConsoleVisible(false);
          return;
        }
      }

      // Ctrl/Cmd + R: 刷新 Key 列表
      if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
        e.preventDefault();
        if (activeConnectionId) {
          setRefreshTrigger(prev => prev + 1);
        }
        return;
      }

      // Ctrl/Cmd + `: 切换控制台
      if ((e.ctrlKey || e.metaKey) && e.key === '`') {
        e.preventDefault();
        setConsoleVisible(prev => !prev);
        return;
      }

      // Ctrl/Cmd + B: 切换侧边栏
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        setSidebarVisible(prev => !prev);
        return;
      }

      // Ctrl/Cmd + L: 清空控制台历史
      if ((e.ctrlKey || e.metaKey) && e.key === 'l' && !isInput) {
        e.preventDefault();
        setCommandHistory([]);
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeConnectionId, consoleVisible, showShortcuts]);

  // 控制台拖拽处理
  const handleConsoleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsConsoleDragging(true);
  }, []);

  // 侧边栏拖拽处理
  const handleSidebarMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsSidebarDragging(true);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isConsoleDragging && mainContentRef.current) {
        const containerRect = mainContentRef.current.getBoundingClientRect();
        const newHeight = containerRect.bottom - e.clientY;
        // 最大高度为 main-content 区域高度减去一点余量（给 resizer 留空间）
        const maxHeight = containerRect.height - 50;
        setConsoleHeight(Math.max(100, Math.min(maxHeight, newHeight)));
      }
      if (isSidebarDragging && appBodyRef.current) {
        const containerRect = appBodyRef.current.getBoundingClientRect();
        const newWidth = e.clientX - containerRect.left;
        setSidebarWidth(Math.max(200, Math.min(500, newWidth)));
      }
    };

    const handleMouseUp = () => {
      setIsConsoleDragging(false);
      setIsSidebarDragging(false);
    };

    if (isConsoleDragging || isSidebarDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isConsoleDragging, isSidebarDragging]);

  // 切换控制台显示
  const toggleConsole = () => {
    setConsoleVisible(prev => !prev);
  };

  // 切换侧边栏显示
  const toggleSidebar = () => {
    setSidebarVisible((prev: boolean) => !prev);
  };

  return (
    <div className="app">
      <TitleBar />
      <div className="app-header">
        <div className="header-left">
          <h1>{t('app.title')}</h1>
        </div>
        <div className="header-right">
          <SettingsButton onConfigImported={loadSavedConnections} />
        </div>
      </div>

      <div className="app-body" ref={appBodyRef}>
        {/* 侧边栏 - 始终渲染，通过 CSS 控制滑动动画 */}
        <aside
          className={`sidebar ${sidebarVisible ? 'sidebar-visible' : 'sidebar-hidden'}`}
          style={{ width: sidebarVisible ? sidebarWidth : 0 }}
        >
          <div className="sidebar-content" style={{ width: sidebarWidth }}>
            <ConnectionPanel
              connections={connections}
              activeConnectionId={activeConnectionId}
              onConnect={handleConnect}
              onDisconnect={handleDisconnect}
              onSelect={setActiveConnectionId}
              onRefresh={handleRefreshConnection}
              onDelete={handleDeleteConnection}
              onExecute={handleExecuteForConnection}
            />
          </div>
        </aside>

        {/* 侧边栏分割条（含折叠/展开按钮） */}
        <div
          className={`sidebar-resizer ${isSidebarDragging ? 'dragging' : ''} ${!sidebarVisible ? 'collapsed' : ''}`}
          onMouseDown={sidebarVisible ? handleSidebarMouseDown : undefined}
          onClick={!sidebarVisible ? toggleSidebar : undefined}
        >
          <button
            className="toggle-sidebar-btn"
            onClick={(e) => {
              e.stopPropagation();
              toggleSidebar();
            }}
            title={sidebarVisible ? (t('sidebar.hide') || '隐藏侧边栏') : (t('sidebar.show') || '显示侧边栏')}
          >
            {sidebarVisible ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
          </button>
        </div>

        <main className="main-content" ref={mainContentRef}>
          {activeConnection?.status === 'connected' ? (
            <>
              <div className="content-top" style={{ flex: consoleVisible ? undefined : 1 }}>
                <KeyBrowser
                  connectionId={activeConnectionId!}
                  onExecute={handleExecute}
                  onPipeline={handlePipeline}
                  refreshTrigger={refreshTrigger}
                />
              </div>

              {/* 控制台分隔条 */}
              {consoleVisible && (
                <div
                  className={`console-resizer ${isConsoleDragging ? 'dragging' : ''}`}
                  onMouseDown={handleConsoleMouseDown}
                >
                  <button
                    className="toggle-console-btn"
                    onClick={toggleConsole}
                    title={t('console.hide') || '隐藏控制台'}
                  >
                    <ChevronDown size={14} />
                  </button>
                </div>
              )}

              {/* 控制台 - 始终渲染，通过 CSS 控制滑动动画 */}
              <div
                className={`content-bottom ${consoleVisible ? 'console-visible' : 'console-hidden'}`}
                style={{ height: consoleVisible ? consoleHeight : 0 }}
              >
                <CommandConsole
                  history={commandHistory}
                  onExecute={handleExecute}
                  onClear={() => setCommandHistory([])}
                  disabled={activeConnection?.status !== 'connected'}
                />
              </div>
            </>
          ) : activeConnection?.status === 'connecting' ? (
            <div className="connecting-overlay">
              <div className="connecting-content">
                <Loader2 className="connecting-spinner" size={48} />
                <h2>{t('status.connecting')}</h2>
                <p>{activeConnection.name}</p>
              </div>
            </div>
          ) : (
            <div className="no-connection">
              <div className="no-connection-icon"><Unplug size={48} /></div>
              <h2>{t('noConnection.title')}</h2>
              <p>{t('noConnection.hint')}</p>
            </div>
          )}
        </main>
      </div>

      <StatusBar
        connection={activeConnection}
        consoleVisible={consoleVisible}
        onToggleConsole={toggleConsole}
      />

      {/* 快捷键帮助面板 */}
      <ShortcutsModal isOpen={showShortcuts} onClose={() => setShowShortcuts(false)} />
    </div>
  );
}

function App() {
  return (
    <SettingsProvider>
      <ToastProvider>
        <AppContent />
      </ToastProvider>
    </SettingsProvider>
  );
}

export default App;
