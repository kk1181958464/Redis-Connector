import { useState, useEffect } from 'react';
import { Plug, Lock, Eye, EyeOff, Zap, CheckCircle, XCircle, Shield } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import Modal from './Modal';
import './ConnectionModal.css';

interface ConnectionConfig {
  name: string;
  host: string;
  port: number;
  password?: string;
  db?: number;
  useSSH: boolean;
  ssh?: {
    host: string;
    port: number;
    username: string;
    authType: 'password' | 'privateKey';
    password?: string;
    privateKey?: string;
    passphrase?: string;
  };
  // TLS 配置
  tls?: {
    enabled: boolean;
    rejectUnauthorized?: boolean;
    ca?: string;
    cert?: string;
    key?: string;
  };
  existingId?: string; // 已存在的连接 ID（用于编辑/重连）
}

interface EditConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  password?: string;
  db?: number;
  useSSH?: boolean;
  sshHost?: string;
  sshPort?: number;
  sshUsername?: string;
  sshAuthType?: 'password' | 'privateKey';
  sshPassword?: string;
  sshPrivateKey?: string;
  sshPassphrase?: string;
  // TLS
  useTLS?: boolean;
  tlsRejectUnauthorized?: boolean;
  tlsCa?: string;
  tlsCert?: string;
  tlsKey?: string;
}

interface ConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnect: (config: ConnectionConfig) => Promise<{ success: boolean; error?: string }>;
  editConnection?: EditConnection | null;
}

function ConnectionModal({ isOpen, onClose, onConnect, editConnection }: ConnectionModalProps) {
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; version?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'direct' | 'ssh'>('direct');
  const [showPassword, setShowPassword] = useState(false);
  const [showSshPassword, setShowSshPassword] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);
  const { t, settings } = useSettings();

  const defaultFormData = {
    name: '',
    host: '127.0.0.1',
    port: '6379',
    password: '',
    db: '0',
    sshHost: '',
    sshPort: '22',
    sshUsername: '',
    sshAuthType: 'password' as 'password' | 'privateKey',
    sshPassword: '',
    sshPrivateKey: '',
    sshPassphrase: '',
    // TLS
    useTLS: false,
    tlsRejectUnauthorized: true,
    tlsCa: '',
    tlsCert: '',
    tlsKey: '',
  };

  const [formData, setFormData] = useState(defaultFormData);

  // 编辑模式时填充表单
  useEffect(() => {
    if (isOpen && editConnection) {
      setFormData({
        name: editConnection.name || '',
        host: editConnection.host || '127.0.0.1',
        port: String(editConnection.port || 6379),
        password: editConnection.password || '',
        db: String(editConnection.db ?? 0),
        sshHost: editConnection.sshHost || '',
        sshPort: String(editConnection.sshPort || 22),
        sshUsername: editConnection.sshUsername || '',
        sshAuthType: editConnection.sshAuthType || 'password',
        sshPassword: editConnection.sshPassword || '',
        sshPrivateKey: editConnection.sshPrivateKey || '',
        sshPassphrase: editConnection.sshPassphrase || '',
        // TLS
        useTLS: editConnection.useTLS || false,
        tlsRejectUnauthorized: editConnection.tlsRejectUnauthorized !== false,
        tlsCa: editConnection.tlsCa || '',
        tlsCert: editConnection.tlsCert || '',
        tlsKey: editConnection.tlsKey || '',
      });
      setActiveTab(editConnection.useSSH ? 'ssh' : 'direct');
    } else if (isOpen) {
      setFormData(defaultFormData);
      setActiveTab('direct');
    }
    setError(null);
    setTestResult(null);
  }, [isOpen, editConnection]);

  // 测试连接
  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setError(null);

    const config: ConnectionConfig = {
      name: formData.name || `${formData.host}:${formData.port}`,
      host: formData.host,
      port: parseInt(formData.port, 10),
      password: formData.password || undefined,
      db: parseInt(formData.db, 10),
      useSSH: activeTab === 'ssh',
    };

    if (activeTab === 'ssh') {
      config.ssh = {
        host: formData.sshHost,
        port: parseInt(formData.sshPort, 10),
        username: formData.sshUsername,
        authType: formData.sshAuthType,
        password: formData.sshAuthType === 'password' ? formData.sshPassword : undefined,
        privateKey: formData.sshAuthType === 'privateKey' ? formData.sshPrivateKey : undefined,
        passphrase: formData.sshPassphrase || undefined,
      };
    }

    // TLS 配置
    if (formData.useTLS) {
      config.tls = {
        enabled: true,
        rejectUnauthorized: formData.tlsRejectUnauthorized,
        ca: formData.tlsCa || undefined,
        cert: formData.tlsCert || undefined,
        key: formData.tlsKey || undefined,
      };
    }

    try {
      const result = await window.electronAPI?.redis.test(config);
      if (result?.success) {
        setTestResult({
          success: true,
          message: settings.language === 'zh-CN' ? '连接成功' : 'Connection successful',
          version: result.version,
        });
      } else {
        setTestResult({
          success: false,
          message: result?.error || (settings.language === 'zh-CN' ? '连接失败' : 'Connection failed'),
        });
      }
    } catch (err) {
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const config: ConnectionConfig = {
      name: formData.name || `${formData.host}:${formData.port}`,
      host: formData.host,
      port: parseInt(formData.port, 10),
      password: formData.password || undefined,
      db: parseInt(formData.db, 10),
      useSSH: activeTab === 'ssh',
      existingId: editConnection?.id, // 传递已存在的连接 ID
    };

    if (activeTab === 'ssh') {
      config.ssh = {
        host: formData.sshHost,
        port: parseInt(formData.sshPort, 10),
        username: formData.sshUsername,
        authType: formData.sshAuthType,
        password: formData.sshAuthType === 'password' ? formData.sshPassword : undefined,
        privateKey: formData.sshAuthType === 'privateKey' ? formData.sshPrivateKey : undefined,
        passphrase: formData.sshPassphrase || undefined,
      };
    }

    // TLS 配置
    if (formData.useTLS) {
      config.tls = {
        enabled: true,
        rejectUnauthorized: formData.tlsRejectUnauthorized,
        ca: formData.tlsCa || undefined,
        cert: formData.tlsCert || undefined,
        key: formData.tlsKey || undefined,
      };
    }

    const result = await onConnect(config);
    setLoading(false);

    if (result.success) {
      onClose();
      setFormData(defaultFormData);
    } else {
      setError(result.error || t('status.error'));
    }
  };

  const isEditMode = !!editConnection;
  const modalTitle = isEditMode ? t('connection.edit') : t('connection.add');
  const submitText = isEditMode ? t('common.save') : t('connection.connect');

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={modalTitle}
      width={500}
      height={550}
      minWidth={400}
      minHeight={400}
      className="connection-modal"
      storageKey="connection"
    >
      <div className="modal-tabs">
        <button
          className={`tab ${activeTab === 'direct' ? 'active' : ''}`}
          onClick={() => setActiveTab('direct')}
        >
          <Plug size={16} /> {t('connection.direct')}
        </button>
        <button
          className={`tab ${activeTab === 'ssh' ? 'active' : ''}`}
          onClick={() => setActiveTab('ssh')}
        >
          <Lock size={16} /> {t('connection.ssh')}
        </button>
      </div>

      <form className="modal-form" onSubmit={handleSubmit}>
        {/* Redis 配置 */}
        <div className="form-section">
          <h3>Redis</h3>

          <div className="form-group">
            <label>{t('connection.name')}</label>
            <input
              type="text"
              placeholder={t('connection.name')}
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
            />
          </div>

          <div className="form-row">
            <div className="form-group flex-2">
              <label>{t('connection.host')}</label>
              <input
                type="text"
                placeholder="127.0.0.1"
                value={formData.host}
                onChange={e => setFormData({ ...formData, host: e.target.value })}
                required
              />
            </div>
            <div className="form-group flex-1">
              <label>{t('connection.port')}</label>
              <input
                type="number"
                placeholder="6379"
                value={formData.port}
                onChange={e => setFormData({ ...formData, port: e.target.value })}
                required
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group flex-2">
              <label>{t('connection.password')}</label>
              <div className="password-input-wrapper">
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder={t('connection.password')}
                  value={formData.password}
                  onChange={e => setFormData({ ...formData, password: e.target.value })}
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <div className="form-group flex-1">
              <label>{t('connection.database')}</label>
              <input
                type="number"
                placeholder="0"
                min="0"
                max="15"
                value={formData.db}
                onChange={e => setFormData({ ...formData, db: e.target.value })}
              />
            </div>
          </div>
        </div>

        {/* TLS 配置（仅直连模式） */}
        {activeTab === 'direct' && (
          <div className="form-section tls-section">
            <div className="section-header">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={formData.useTLS}
                  onChange={e => setFormData({ ...formData, useTLS: e.target.checked })}
                />
                <Shield size={16} />
                <span>TLS/SSL</span>
              </label>
            </div>

            {formData.useTLS && (
              <div className="tls-options">
                <div className="form-group">
                  <label className="checkbox-label small">
                    <input
                      type="checkbox"
                      checked={formData.tlsRejectUnauthorized}
                      onChange={e => setFormData({ ...formData, tlsRejectUnauthorized: e.target.checked })}
                    />
                    <span>{settings.language === 'zh-CN' ? '验证服务器证书' : 'Verify Server Certificate'}</span>
                  </label>
                  <p className="form-hint">
                    {settings.language === 'zh-CN'
                      ? '关闭后将接受自签名证书（不推荐用于生产环境）'
                      : 'Disable to accept self-signed certificates (not recommended for production)'}
                  </p>
                </div>

                <div className="form-group">
                  <label>{settings.language === 'zh-CN' ? 'CA 证书（可选）' : 'CA Certificate (Optional)'}</label>
                  <textarea
                    placeholder="-----BEGIN CERTIFICATE-----..."
                    value={formData.tlsCa}
                    onChange={e => setFormData({ ...formData, tlsCa: e.target.value })}
                    rows={3}
                  />
                </div>

                <div className="form-group">
                  <label>{settings.language === 'zh-CN' ? '客户端证书（可选）' : 'Client Certificate (Optional)'}</label>
                  <textarea
                    placeholder="-----BEGIN CERTIFICATE-----..."
                    value={formData.tlsCert}
                    onChange={e => setFormData({ ...formData, tlsCert: e.target.value })}
                    rows={3}
                  />
                </div>

                <div className="form-group">
                  <label>{settings.language === 'zh-CN' ? '客户端私钥（可选）' : 'Client Private Key (Optional)'}</label>
                  <textarea
                    placeholder="-----BEGIN PRIVATE KEY-----..."
                    value={formData.tlsKey}
                    onChange={e => setFormData({ ...formData, tlsKey: e.target.value })}
                    rows={3}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* SSH 配置 */}
        {activeTab === 'ssh' && (
          <div className="form-section">
            <h3>{t('connection.ssh')}</h3>

            <div className="form-row">
              <div className="form-group flex-2">
                <label>{t('ssh.host')}</label>
                <input
                  type="text"
                  placeholder="ssh.example.com"
                  value={formData.sshHost}
                  onChange={e => setFormData({ ...formData, sshHost: e.target.value })}
                  required
                />
              </div>
              <div className="form-group flex-1">
                <label>{t('ssh.port')}</label>
                <input
                  type="number"
                  placeholder="22"
                  value={formData.sshPort}
                  onChange={e => setFormData({ ...formData, sshPort: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label>{t('ssh.username')}</label>
              <input
                type="text"
                placeholder="root"
                value={formData.sshUsername}
                onChange={e => setFormData({ ...formData, sshUsername: e.target.value })}
                required
              />
            </div>

            <div className="form-group">
              <label>{t('ssh.auth')}</label>
              <div className="auth-options">
                <button
                  type="button"
                  className={`auth-option ${formData.sshAuthType === 'password' ? 'active' : ''}`}
                  onClick={() => setFormData({ ...formData, sshAuthType: 'password' })}
                >
                  {t('ssh.auth.password')}
                </button>
                <button
                  type="button"
                  className={`auth-option ${formData.sshAuthType === 'privateKey' ? 'active' : ''}`}
                  onClick={() => setFormData({ ...formData, sshAuthType: 'privateKey' })}
                >
                  {t('ssh.auth.privateKey')}
                </button>
              </div>
            </div>

            {formData.sshAuthType === 'password' ? (
              <div className="form-group">
                <label>{t('ssh.auth.password')}</label>
                <div className="password-input-wrapper">
                  <input
                    type={showSshPassword ? 'text' : 'password'}
                    placeholder={t('ssh.auth.password')}
                    value={formData.sshPassword}
                    onChange={e => setFormData({ ...formData, sshPassword: e.target.value })}
                    required
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowSshPassword(!showSshPassword)}
                    tabIndex={-1}
                  >
                    {showSshPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="form-group">
                  <label>{t('ssh.privateKey')}</label>
                  <textarea
                    placeholder="-----BEGIN RSA PRIVATE KEY-----..."
                    value={formData.sshPrivateKey}
                    onChange={e => setFormData({ ...formData, sshPrivateKey: e.target.value })}
                    rows={4}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>{t('ssh.passphrase')}</label>
                  <div className="password-input-wrapper">
                    <input
                      type={showPassphrase ? 'text' : 'password'}
                      placeholder={t('ssh.passphrase')}
                      value={formData.sshPassphrase}
                      onChange={e => setFormData({ ...formData, sshPassphrase: e.target.value })}
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      onClick={() => setShowPassphrase(!showPassphrase)}
                      tabIndex={-1}
                    >
                      {showPassphrase ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {error && <div className="form-error">{error}</div>}

        {/* 测试结果 */}
        {testResult && (
          <div className={`test-result ${testResult.success ? 'success' : 'error'}`}>
            {testResult.success ? <CheckCircle size={16} /> : <XCircle size={16} />}
            <span>{testResult.message}</span>
            {testResult.version && <span className="version">Redis {testResult.version}</span>}
          </div>
        )}

        <div className="modal-footer">
          <button type="button" className="secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="test-btn"
            onClick={handleTest}
            disabled={testing || loading}
          >
            <Zap size={14} />
            {testing
              ? (settings.language === 'zh-CN' ? '测试中...' : 'Testing...')
              : (settings.language === 'zh-CN' ? '测试连接' : 'Test')}
          </button>
          <button type="submit" className="primary" disabled={loading || testing}>
            {loading ? '...' : submitText}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default ConnectionModal;
