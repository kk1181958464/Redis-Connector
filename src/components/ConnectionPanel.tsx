import { useState, useEffect, useRef, useMemo } from 'react';
import { Plus, MoreVertical, Pencil, Info, RefreshCw, Square, Trash2, ChevronRight, ChevronDown, Folder } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import { useToast } from './Toast';
import ConnectionModal from './ConnectionModal';
import ConnectionInfoModal from './ConnectionInfoModal';
import ConfirmModal from './ConfirmModal';
import './ConnectionPanel.css';

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

interface ConnectionPanelProps {
  connections: Connection[];
  activeConnectionId: string | null;
  onConnect: (config: any) => Promise<{ success: boolean; error?: string }>;
  onDisconnect: (connectionId: string) => void;
  onSelect: (connectionId: string) => void;
  onRefresh?: (connectionId: string) => void;
  onDelete?: (connectionId: string) => void;
  onExecute?: (connectionId: string, command: string) => Promise<any>;
}

function ConnectionPanel({
  connections,
  activeConnectionId,
  onConnect,
  onDisconnect,
  onSelect,
  onRefresh,
  onDelete,
  onExecute
}: ConnectionPanelProps) {
  const [showModal, setShowModal] = useState(false);
  const [editingConnection, setEditingConnection] = useState<Connection | null>(null);
  const [showDetails, setShowDetails] = useState<string | null>(null);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [infoConnection, setInfoConnection] = useState<Connection | null>(null);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Connection | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['default']));
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { t, settings } = useSettings();
  const { showToast } = useToast();

  // 按名称前缀分组连接（使用 : 或 / 作为分隔符）
  const groupedConnections = useMemo(() => {
    const groups: Record<string, Connection[]> = {};

    for (const conn of connections) {
      // 查找分组前缀
      const separatorIndex = Math.max(conn.name.indexOf(':'), conn.name.indexOf('/'));
      const groupName = separatorIndex > 0 ? conn.name.substring(0, separatorIndex) : 'default';

      if (!groups[groupName]) {
        groups[groupName] = [];
      }
      groups[groupName].push(conn);
    }

    // 按组名排序，default 放最后
    const sortedGroups = Object.entries(groups).sort(([a], [b]) => {
      if (a === 'default') return 1;
      if (b === 'default') return -1;
      return a.localeCompare(b);
    });

    return sortedGroups;
  }, [connections]);

  // 切换分组展开/收起
  const toggleGroup = (groupName: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupName)) {
        next.delete(groupName);
      } else {
        next.add(groupName);
      }
      return next;
    });
  };

  // 点击外部关闭下拉菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
    };
    if (openDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openDropdown]);

  const handleEdit = (conn: Connection) => {
    setOpenDropdown(null);
    setEditingConnection(conn);
    setShowModal(true);
  };

  const handleDetails = (conn: Connection) => {
    setOpenDropdown(null);
    if (conn.status === 'connected') {
      // 已连接：打开详情弹窗
      setInfoConnection(conn);
      setShowInfoModal(true);
    } else {
      // 未连接：展开/收起基本信息
      setShowDetails(showDetails === conn.id ? null : conn.id);
    }
  };

  const handleRefresh = (connId: string) => {
    setOpenDropdown(null);
    onRefresh?.(connId);
  };

  const handleDelete = (conn: Connection) => {
    setOpenDropdown(null);
    setDeleteConfirm(conn);
  };

  const confirmDelete = () => {
    if (deleteConfirm) {
      if (deleteConfirm.status === 'connected') {
        onDisconnect(deleteConfirm.id);
      }
      onDelete?.(deleteConfirm.id);
      setDeleteConfirm(null);
    }
  };

  // 点击连接项：已连接则选中，未连接则自动建立连接
  const handleConnectionClick = async (conn: Connection) => {
    onSelect(conn.id);

    if (conn.status !== 'connected' && conn.status !== 'connecting') {
      // SSH 连接需要检查是否有认证信息
      if (conn.useSSH) {
        const hasPassword = conn.sshAuthType === 'password' && conn.sshPassword;
        const hasPrivateKey = conn.sshAuthType === 'privateKey' && conn.sshPrivateKey;

        if (!hasPassword && !hasPrivateKey) {
          // 缺少 SSH 认证信息，打开编辑弹窗让用户输入
          handleEdit(conn);
          return;
        }
      }

      // 自动建立连接
      const config = {
        name: conn.name,
        host: conn.host,
        port: conn.port,
        password: conn.password,
        db: conn.db,
        useSSH: conn.useSSH,
        ssh: conn.useSSH ? {
          host: conn.sshHost || '',
          port: conn.sshPort || 22,
          username: conn.sshUsername || '',
          authType: conn.sshAuthType || 'password',
          password: conn.sshPassword,
          privateKey: conn.sshPrivateKey,
          passphrase: conn.sshPassphrase,
        } : undefined,
        existingId: conn.id,
      };

      const result = await onConnect(config);
      if (!result.success) {
        // 连接失败，显示错误提示
        showToast(result.error || (settings.language === 'zh-CN' ? '连接失败' : 'Connection failed'), 'error');
      }
    }
  };

  const handleDisconnect = (connId: string) => {
    setOpenDropdown(null);
    onDisconnect(connId);
  };

  const toggleDropdown = (connId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenDropdown(openDropdown === connId ? null : connId);
  };

  const handleModalClose = () => {
    setShowModal(false);
    setEditingConnection(null);
  };

  return (
    <div className="connection-panel">
      <div className="panel-header">
        <h3>{t('connection.title')}</h3>
        <button className="add-btn" onClick={() => setShowModal(true)} title={t('connection.add')}>
          <Plus size={16} />
        </button>
      </div>

      <div className="connection-list">
        {connections.length === 0 ? (
          <div className="empty-list">
            <p>{t('connection.empty')}</p>
            <p className="hint">{t('connection.empty.hint')}</p>
          </div>
        ) : (
          groupedConnections.map(([groupName, groupConns]) => (
            <div key={groupName} className="connection-group">
              {/* 只有多个分组时才显示分组头 */}
              {groupedConnections.length > 1 && (
                <div
                  className="group-header"
                  onClick={() => toggleGroup(groupName)}
                >
                  <span className="group-toggle">
                    {expandedGroups.has(groupName) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </span>
                  <Folder size={14} className="group-icon" />
                  <span className="group-name">
                    {groupName === 'default'
                      ? (settings.language === 'zh-CN' ? '未分组' : 'Ungrouped')
                      : groupName}
                  </span>
                  <span className="group-count">({groupConns.length})</span>
                </div>
              )}

              {/* 分组内的连接 */}
              {(expandedGroups.has(groupName) || groupedConnections.length === 1) && (
                <div className="group-connections">
                  {groupConns.map(conn => (
                    <div key={conn.id}>
                      <div
                        className={`connection-item ${conn.id === activeConnectionId ? 'active' : ''}`}
                        onClick={() => handleConnectionClick(conn)}
                        onDoubleClick={() => handleEdit(conn)}
                      >
                        <span className={`status-dot ${conn.status}`} />
                        <div className="connection-info">
                          <div className="connection-name">{conn.name}</div>
                          <div className="connection-addr">
                            {conn.useSSH && <span className="ssh-badge">SSH</span>}
                            {conn.host}:{conn.port}
                          </div>
                        </div>
                        <div className={`connection-actions ${openDropdown === conn.id ? 'open' : ''}`} ref={openDropdown === conn.id ? dropdownRef : null}>
                          <button
                            className="more-btn"
                            onClick={(e) => toggleDropdown(conn.id, e)}
                            title="操作"
                          >
                            <MoreVertical size={16} />
                          </button>
                          {openDropdown === conn.id && (
                            <div className="actions-dropdown">
                              <button className="dropdown-item" onClick={() => handleEdit(conn)}>
                                <span className="icon"><Pencil size={14} /></span>
                                {t('connection.edit')}
                              </button>
                              <button className="dropdown-item" onClick={() => handleDetails(conn)}>
                                <span className="icon"><Info size={14} /></span>
                                {t('connection.details')}
                              </button>
                              {conn.status === 'connected' && (
                                <button className="dropdown-item" onClick={() => handleRefresh(conn.id)}>
                                  <span className="icon"><RefreshCw size={14} /></span>
                                  {t('connection.refresh')}
                                </button>
                              )}
                              <div className="dropdown-divider" />
                              {(conn.status === 'connected' || conn.status === 'disconnecting') && (
                                <button
                                  className={`dropdown-item disconnect ${conn.status === 'disconnecting' ? 'loading' : ''}`}
                                  onClick={(e) => { e.stopPropagation(); handleDisconnect(conn.id); }}
                                  disabled={conn.status === 'disconnecting'}
                                >
                                  <span className="icon">
                                    {conn.status === 'disconnecting' ? (
                                      <RefreshCw size={14} className="spin" />
                                    ) : (
                                      <Square size={14} />
                                    )}
                                  </span>
                                  {conn.status === 'disconnecting'
                                    ? (settings.language === 'zh-CN' ? '断开中...' : 'Disconnecting...')
                                    : t('connection.disconnect')}
                                </button>
                              )}
                              <button className="dropdown-item delete" onClick={(e) => { e.stopPropagation(); handleDelete(conn); }}>
                                <span className="icon"><Trash2 size={14} /></span>
                                {t('connection.delete')}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* 详情展开面板 */}
                      {showDetails === conn.id && (
                        <div className="connection-details">
                          <div className="detail-row">
                            <span className="detail-label">{t('connection.host')}:</span>
                            <span className="detail-value">{conn.host}</span>
                          </div>
                          <div className="detail-row">
                            <span className="detail-label">{t('connection.port')}:</span>
                            <span className="detail-value">{conn.port}</span>
                          </div>
                          <div className="detail-row">
                            <span className="detail-label">{t('connection.database')}:</span>
                            <span className="detail-value">{conn.db ?? 0}</span>
                          </div>
                          <div className="detail-row">
                            <span className="detail-label">{t('connection.password')}:</span>
                            <span className="detail-value">{conn.password ? '••••••' : '-'}</span>
                          </div>
                          {conn.useSSH && (
                            <>
                              <div className="detail-divider" />
                              <div className="detail-row">
                                <span className="detail-label">{t('ssh.host')}:</span>
                                <span className="detail-value">{conn.sshHost}:{conn.sshPort}</span>
                              </div>
                              <div className="detail-row">
                                <span className="detail-label">{t('ssh.username')}:</span>
                                <span className="detail-value">{conn.sshUsername}</span>
                              </div>
                              <div className="detail-row">
                                <span className="detail-label">{t('ssh.auth')}:</span>
                                <span className="detail-value">
                                  {conn.sshAuthType === 'privateKey' ? t('ssh.auth.privateKey') : t('ssh.auth.password')}
                                </span>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <ConnectionModal
        isOpen={showModal}
        onClose={handleModalClose}
        onConnect={onConnect}
        editConnection={editingConnection}
      />

      <ConnectionInfoModal
        isOpen={showInfoModal}
        onClose={() => {
          setShowInfoModal(false);
          setInfoConnection(null);
        }}
        connectionId={infoConnection?.id || null}
        connectionName={infoConnection?.name || ''}
        onExecute={async (command: string) => {
          if (infoConnection && onExecute) {
            return await onExecute(infoConnection.id, command);
          }
          return { success: false, error: '未连接' };
        }}
      />

      <ConfirmModal
        isOpen={deleteConfirm !== null}
        title={settings.language === 'zh-CN' ? '删除连接' : 'Delete Connection'}
        message={settings.language === 'zh-CN'
          ? `确定要删除连接「${deleteConfirm?.name}」吗？此操作不可恢复。`
          : `Are you sure you want to delete "${deleteConfirm?.name}"? This action cannot be undone.`}
        confirmText={t('connection.delete')}
        cancelText={t('common.cancel')}
        type="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteConfirm(null)}
      />
    </div>
  );
}

export default ConnectionPanel;
