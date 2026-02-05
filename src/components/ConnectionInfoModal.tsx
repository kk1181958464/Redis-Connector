/**
 * Redis 连接详情弹窗
 * 展示 Redis 服务器完整信息
 */

import { useState, useEffect } from 'react';
import {
  BarChart3, Server, Users, HardDrive, TrendingUp,
  RefreshCw, Zap, Database, Globe, AlertCircle
} from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import Modal from './Modal';
import './ConnectionInfoModal.css';

interface RedisInfo {
  // Server
  redis_version?: string;
  redis_mode?: string;
  os?: string;
  arch_bits?: string;
  process_id?: string;
  uptime_in_seconds?: string;
  uptime_in_days?: string;
  tcp_port?: string;

  // Clients
  connected_clients?: string;
  blocked_clients?: string;

  // Memory
  used_memory?: string;
  used_memory_human?: string;
  used_memory_peak?: string;
  used_memory_peak_human?: string;
  total_system_memory?: string;
  total_system_memory_human?: string;
  used_memory_rss?: string;
  used_memory_rss_human?: string;
  maxmemory?: string;
  maxmemory_human?: string;
  maxmemory_policy?: string;
  mem_fragmentation_ratio?: string;

  // Stats
  total_connections_received?: string;
  total_commands_processed?: string;
  instantaneous_ops_per_sec?: string;
  rejected_connections?: string;
  expired_keys?: string;
  evicted_keys?: string;
  keyspace_hits?: string;
  keyspace_misses?: string;

  // Replication
  role?: string;
  connected_slaves?: string;

  // CPU
  used_cpu_sys?: string;
  used_cpu_user?: string;

  // Cluster
  cluster_enabled?: string;

  // Keyspace
  [key: string]: string | undefined;
}

interface KeyspaceInfo {
  db: number;
  keys: number;
  expires: number;
  avg_ttl: number;
}

interface ConnectionInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId: string | null;
  connectionName: string;
  onExecute: (command: string) => Promise<any>;
}

// 解析 INFO 命令返回的字符串
function parseRedisInfo(infoStr: string): RedisInfo {
  const info: RedisInfo = {};
  const lines = infoStr.split('\r\n');

  for (const line of lines) {
    if (line && !line.startsWith('#')) {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.substring(0, colonIndex);
        const value = line.substring(colonIndex + 1);
        info[key] = value;
      }
    }
  }

  return info;
}

// 解析 Keyspace 信息
function parseKeyspace(info: RedisInfo): KeyspaceInfo[] {
  const keyspaces: KeyspaceInfo[] = [];

  for (const key of Object.keys(info)) {
    if (key.startsWith('db')) {
      const dbNum = parseInt(key.substring(2), 10);
      const value = info[key];
      if (value) {
        // 格式: keys=123,expires=45,avg_ttl=67890
        const parts = value.split(',');
        const ks: KeyspaceInfo = { db: dbNum, keys: 0, expires: 0, avg_ttl: 0 };

        for (const part of parts) {
          const [k, v] = part.split('=');
          if (k === 'keys') ks.keys = parseInt(v, 10);
          if (k === 'expires') ks.expires = parseInt(v, 10);
          if (k === 'avg_ttl') ks.avg_ttl = parseInt(v, 10);
        }

        keyspaces.push(ks);
      }
    }
  }

  return keyspaces.sort((a, b) => a.db - b.db);
}

// 格式化运行时间
function formatUptime(seconds: string | undefined): string {
  if (!seconds) return '-';
  const sec = parseInt(seconds, 10);
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const mins = Math.floor((sec % 3600) / 60);

  if (days > 0) {
    return `${days}天 ${hours}小时 ${mins}分钟`;
  } else if (hours > 0) {
    return `${hours}小时 ${mins}分钟`;
  } else {
    return `${mins}分钟 ${sec % 60}秒`;
  }
}

// 格式化数字
function formatNumber(num: string | undefined): string {
  if (!num) return '-';
  return parseInt(num, 10).toLocaleString();
}

// 计算命中率
function calcHitRate(hits: string | undefined, misses: string | undefined): string {
  if (!hits || !misses) return '-';
  const h = parseInt(hits, 10);
  const m = parseInt(misses, 10);
  const total = h + m;
  if (total === 0) return '0%';
  return ((h / total) * 100).toFixed(2) + '%';
}

function ConnectionInfoModal({
  isOpen,
  onClose,
  connectionId,
  connectionName,
  onExecute
}: ConnectionInfoModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<RedisInfo | null>(null);
  const [keyspaces, setKeyspaces] = useState<KeyspaceInfo[]>([]);
  const { t } = useSettings();

  // 加载 Redis 信息
  useEffect(() => {
    if (!isOpen || !connectionId) return;

    const fetchInfo = async () => {
      setLoading(true);
      setError(null);

      try {
        const result = await onExecute('INFO');

        if (result?.success && result.data) {
          const parsed = parseRedisInfo(result.data);
          setInfo(parsed);
          setKeyspaces(parseKeyspace(parsed));
        } else {
          setError(result?.error || '获取信息失败');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '获取信息失败');
      } finally {
        setLoading(false);
      }
    };

    fetchInfo();
  }, [isOpen, connectionId, onExecute]);

  if (!isOpen) return null;

  // 计算总 key 数量和过期数量
  const totalKeys = keyspaces.reduce((sum, ks) => sum + ks.keys, 0);
  const totalExpires = keyspaces.reduce((sum, ks) => sum + ks.expires, 0);
  const totalPersistent = totalKeys - totalExpires;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={<><BarChart3 size={20} /> {connectionName} - {t('connection.details')}</>}
      width={720}
      className="connection-info-modal"
    >
      <div className="info-modal-body">
        {loading ? (
          <div className="info-loading">
            <div className="spinner"></div>
            <p>加载中...</p>
          </div>
        ) : error ? (
          <div className="info-error">
            <p><AlertCircle size={16} /> {error}</p>
          </div>
        ) : info ? (
          <div className="info-sections">
            {/* 服务器信息 */}
            <div className="info-section">
              <h3><Server size={16} /> 服务器</h3>
              <div className="info-grid">
                <div className="info-item">
                  <span className="info-label">Redis 版本</span>
                  <span className="info-value highlight">{info.redis_version || '-'}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">运行模式</span>
                  <span className="info-value">{info.redis_mode || 'standalone'}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">操作系统</span>
                  <span className="info-value">{info.os || '-'}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">架构</span>
                  <span className="info-value">{info.arch_bits ? `${info.arch_bits} bit` : '-'}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">进程 ID</span>
                  <span className="info-value">{info.process_id || '-'}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">TCP 端口</span>
                  <span className="info-value">{info.tcp_port || '-'}</span>
                </div>
                <div className="info-item full-width">
                  <span className="info-label">运行时间</span>
                  <span className="info-value">{formatUptime(info.uptime_in_seconds)}</span>
                </div>
              </div>
            </div>

            {/* 客户端信息 */}
            <div className="info-section">
              <h3><Users size={16} /> 客户端</h3>
              <div className="info-grid">
                <div className="info-item">
                  <span className="info-label">已连接客户端</span>
                  <span className="info-value highlight">{formatNumber(info.connected_clients)}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">阻塞客户端</span>
                  <span className="info-value">{formatNumber(info.blocked_clients)}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">历史连接总数</span>
                  <span className="info-value">{formatNumber(info.total_connections_received)}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">拒绝连接数</span>
                  <span className="info-value">{formatNumber(info.rejected_connections)}</span>
                </div>
              </div>
            </div>

            {/* 内存信息 */}
            <div className="info-section">
              <h3><HardDrive size={16} /> 内存</h3>
              <div className="info-grid">
                <div className="info-item">
                  <span className="info-label">已用内存</span>
                  <span className="info-value highlight">{info.used_memory_human || '-'}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">内存峰值</span>
                  <span className="info-value">{info.used_memory_peak_human || '-'}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">RSS 内存</span>
                  <span className="info-value">{info.used_memory_rss_human || '-'}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">系统总内存</span>
                  <span className="info-value">{info.total_system_memory_human || '-'}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">最大内存限制</span>
                  <span className="info-value">{info.maxmemory_human || info.maxmemory === '0' ? '无限制' : (info.maxmemory_human || '-')}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">内存淘汰策略</span>
                  <span className="info-value">{info.maxmemory_policy || '-'}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">内存碎片率</span>
                  <span className="info-value">{info.mem_fragmentation_ratio || '-'}</span>
                </div>
              </div>
            </div>

            {/* 统计信息 */}
            <div className="info-section">
              <h3><TrendingUp size={16} /> 统计</h3>
              <div className="info-grid">
                <div className="info-item">
                  <span className="info-label">命令处理总数</span>
                  <span className="info-value">{formatNumber(info.total_commands_processed)}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">每秒操作数</span>
                  <span className="info-value highlight">{formatNumber(info.instantaneous_ops_per_sec)} ops/s</span>
                </div>
                <div className="info-item">
                  <span className="info-label">命中次数</span>
                  <span className="info-value">{formatNumber(info.keyspace_hits)}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">未命中次数</span>
                  <span className="info-value">{formatNumber(info.keyspace_misses)}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">命中率</span>
                  <span className="info-value highlight">{calcHitRate(info.keyspace_hits, info.keyspace_misses)}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">过期 Key 数</span>
                  <span className="info-value">{formatNumber(info.expired_keys)}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">淘汰 Key 数</span>
                  <span className="info-value">{formatNumber(info.evicted_keys)}</span>
                </div>
              </div>
            </div>

            {/* 复制信息 */}
            <div className="info-section">
              <h3><RefreshCw size={16} /> 复制</h3>
              <div className="info-grid">
                <div className="info-item">
                  <span className="info-label">角色</span>
                  <span className="info-value highlight">{info.role || '-'}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">从节点数量</span>
                  <span className="info-value">{formatNumber(info.connected_slaves)}</span>
                </div>
              </div>
            </div>

            {/* CPU 信息 */}
            <div className="info-section">
              <h3><Zap size={16} /> CPU</h3>
              <div className="info-grid">
                <div className="info-item">
                  <span className="info-label">系统 CPU</span>
                  <span className="info-value">{info.used_cpu_sys ? `${parseFloat(info.used_cpu_sys).toFixed(2)}s` : '-'}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">用户 CPU</span>
                  <span className="info-value">{info.used_cpu_user ? `${parseFloat(info.used_cpu_user).toFixed(2)}s` : '-'}</span>
                </div>
              </div>
            </div>

            {/* Keyspace 信息 */}
            <div className="info-section">
              <h3><Database size={16} /> 数据库</h3>
              <div className="info-summary">
                <div className="summary-item">
                  <span className="summary-value">{totalKeys.toLocaleString()}</span>
                  <span className="summary-label">总 Key 数</span>
                </div>
                <div className="summary-item">
                  <span className="summary-value expires">{totalExpires.toLocaleString()}</span>
                  <span className="summary-label">会过期</span>
                </div>
                <div className="summary-item">
                  <span className="summary-value persistent">{totalPersistent.toLocaleString()}</span>
                  <span className="summary-label">永不过期</span>
                </div>
              </div>

              {keyspaces.length > 0 ? (
                <table className="keyspace-table">
                  <thead>
                    <tr>
                      <th>数据库</th>
                      <th>Key 数量</th>
                      <th>会过期</th>
                      <th>永不过期</th>
                      <th>平均 TTL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {keyspaces.map(ks => (
                      <tr key={ks.db}>
                        <td>db{ks.db}</td>
                        <td>{ks.keys.toLocaleString()}</td>
                        <td>{ks.expires.toLocaleString()}</td>
                        <td>{(ks.keys - ks.expires).toLocaleString()}</td>
                        <td>{ks.avg_ttl > 0 ? `${Math.round(ks.avg_ttl / 1000)}s` : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="no-data">暂无数据</p>
              )}
            </div>

            {/* 集群信息 */}
            {info.cluster_enabled === '1' && (
              <div className="info-section">
                <h3><Globe size={16} /> 集群</h3>
                <div className="info-grid">
                  <div className="info-item">
                    <span className="info-label">集群状态</span>
                    <span className="info-value highlight">已启用</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>

      <div className="modal-footer">
        <button className="secondary" onClick={onClose}>
          {t('common.close') || '关闭'}
        </button>
      </div>
    </Modal>
  );
}

export default ConnectionInfoModal;
