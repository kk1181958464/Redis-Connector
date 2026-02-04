import { useState, useRef, useEffect, useCallback } from 'react';
import { Settings, Moon, Sun, Monitor, Download, Upload } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import { ThemeMode, FONT_OPTIONS, KEYS_PER_PAGE_OPTIONS, ACCENT_COLOR_OPTIONS } from '../types/settings';
import { useToast } from './Toast';
import ConfirmModal from './ConfirmModal';
import './SettingsButton.css';

interface SettingsButtonProps {
  onConfigImported?: () => void;
}

function SettingsButton({ onConfigImported }: SettingsButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [importConfirm, setImportConfirm] = useState<any>(null); // 待导入的数据
  const menuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { settings, setTheme, setFont, setLanguage, setKeysPerPage, setAccentColor, t, updateSettings } = useSettings();
  const { showToast } = useToast();

  // 点击外部关闭菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // 导出配置
  const handleExport = useCallback(async () => {
    try {
      // 获取连接配置
      const result = await window.electronAPI?.config.export();
      if (!result?.success) {
        showToast(result?.error || 'Export failed', 'error');
        return;
      }

      // 组合完整配置
      const exportData = {
        ...result.data,
        settings: settings,
      };

      // 生成文件名
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `redis-connector-config-${timestamp}.json`;

      // 创建下载
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast(t('settings.exportSuccess'), 'success');
      setIsOpen(false);
    } catch (error) {
      showToast(String(error), 'error');
    }
  }, [settings, showToast, t]);

  // 导入配置
  const handleImport = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // 处理文件选择
  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 重置 input，允许重复选择同一文件
    e.target.value = '';

    try {
      const text = await file.text();
      const importData = JSON.parse(text);

      // 验证格式
      if (!importData.version || !Array.isArray(importData.connections)) {
        showToast(t('settings.importFailed') + ': Invalid format', 'error');
        return;
      }

      // 显示确认弹窗
      setImportConfirm(importData);
    } catch (error) {
      showToast(t('settings.importFailed') + ': ' + String(error), 'error');
    }
  }, [showToast, t]);

  // 确认导入
  const confirmImport = useCallback(async () => {
    if (!importConfirm) return;

    const importData = importConfirm;
    setImportConfirm(null);

    try {
      // 导入连接配置
      const result = await window.electronAPI?.config.import({
        connections: importData.connections,
      });

      if (!result?.success) {
        showToast(t('settings.importFailed') + ': ' + result?.error, 'error');
        return;
      }

      // 导入应用设置
      if (importData.settings) {
        updateSettings(importData.settings);
      }

      showToast(t('settings.importSuccess') + ` (${result.count} ${settings.language === 'zh-CN' ? '个连接' : 'connections'})`, 'success');
      setIsOpen(false);

      // 通知父组件刷新连接列表
      onConfigImported?.();
    } catch (error) {
      showToast(t('settings.importFailed') + ': ' + String(error), 'error');
    }
  }, [importConfirm, showToast, t, updateSettings, onConfigImported, settings.language]);

  const themeOptions: { value: ThemeMode; icon: React.ReactNode; labelKey: string }[] = [
    { value: 'dark', icon: <Moon size={20} />, labelKey: 'settings.theme.dark' },
    { value: 'light', icon: <Sun size={20} />, labelKey: 'settings.theme.light' },
    { value: 'system', icon: <Monitor size={20} />, labelKey: 'settings.theme.system' },
  ];

  return (
    <div className="settings-container" ref={menuRef}>
      {/* 隐藏的文件输入 */}
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: 'none' }}
        accept=".json"
        onChange={handleFileChange}
      />

      <button
        className="settings-btn"
        onClick={() => setIsOpen(!isOpen)}
        title={t('settings.title')}
      >
        <Settings size={18} />
      </button>

      {isOpen && (
        <div className="settings-menu">
          <div className="menu-header">{t('settings.title')}</div>

          {/* 外观 - 主题 */}
          <div className="menu-section">
            <div className="section-title">{t('settings.theme')}</div>
            <div className="theme-options">
              {themeOptions.map(opt => (
                <button
                  key={opt.value}
                  className={`theme-option ${settings.appearance.theme === opt.value ? 'active' : ''}`}
                  onClick={() => setTheme(opt.value)}
                >
                  <span className="theme-icon">{opt.icon}</span>
                  <span className="theme-label">{t(opt.labelKey)}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 主题色 */}
          <div className="menu-section">
            <div className="section-title">{t('settings.accentColor')}</div>
            <div className="accent-color-options">
              {ACCENT_COLOR_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  className={`accent-color-option ${settings.appearance.accentColor === opt.value ? 'active' : ''}`}
                  onClick={() => setAccentColor(opt.value)}
                  title={opt.label[settings.language]}
                  style={{ '--color-preview': opt.color } as React.CSSProperties}
                >
                  <span className="color-dot" />
                </button>
              ))}
            </div>
          </div>

          {/* 字体 */}
          <div className="menu-section">
            <div className="section-title">{t('settings.font')}</div>
            <select
              className="settings-select"
              value={settings.appearance.fontFamily}
              onChange={(e) => setFont(e.target.value)}
            >
              {FONT_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label[settings.language]}
                </option>
              ))}
            </select>
          </div>

          {/* 语言 */}
          <div className="menu-section">
            <div className="section-title">{t('settings.language')}</div>
            <div className="language-options">
              <button
                className={`language-option ${settings.language === 'zh-CN' ? 'active' : ''}`}
                onClick={() => setLanguage('zh-CN')}
              >
                中文
              </button>
              <button
                className={`language-option ${settings.language === 'en-US' ? 'active' : ''}`}
                onClick={() => setLanguage('en-US')}
              >
                English
              </button>
            </div>
          </div>

          {/* 数据 - Key 加载数量 */}
          <div className="menu-section">
            <div className="section-title">{t('settings.keysPerPage')}</div>
            <div className="keys-per-page-input">
              <select
                className="settings-select"
                value={KEYS_PER_PAGE_OPTIONS.includes(settings.data.keysPerPage) ? settings.data.keysPerPage : 'custom'}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val !== 'custom') {
                    setKeysPerPage(Number(val));
                  }
                }}
              >
                {KEYS_PER_PAGE_OPTIONS.map(opt => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
                <option value="custom">{settings.language === 'zh-CN' ? '自定义' : 'Custom'}</option>
              </select>
              <input
                type="number"
                className="custom-input"
                min="10"
                max="100000"
                value={settings.data.keysPerPage}
                onChange={(e) => {
                  const val = Math.max(10, Math.min(100000, Number(e.target.value) || 100));
                  setKeysPerPage(val);
                }}
                placeholder={settings.language === 'zh-CN' ? '自定义数量' : 'Custom'}
              />
            </div>
          </div>

          {/* 配置管理 - 导入/导出 */}
          <div className="menu-section">
            <div className="section-title">{t('settings.configManagement')}</div>
            <div className="config-buttons">
              <button className="config-btn" onClick={handleExport}>
                <Download size={16} />
                <span>{t('settings.export')}</span>
              </button>
              <button className="config-btn" onClick={handleImport}>
                <Upload size={16} />
                <span>{t('settings.import')}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 导入确认弹窗 */}
      <ConfirmModal
        isOpen={importConfirm !== null}
        title={settings.language === 'zh-CN' ? '导入配置' : 'Import Config'}
        message={
          importConfirm ? (
            settings.language === 'zh-CN'
              ? `即将导入 ${importConfirm.connections?.length || 0} 个连接配置${importConfirm.settings ? '和应用设置' : ''}。\n\n⚠️ 此操作将覆盖当前所有连接配置，是否继续？`
              : `About to import ${importConfirm.connections?.length || 0} connection(s)${importConfirm.settings ? ' and app settings' : ''}.\n\n⚠️ This will overwrite all current connections. Continue?`
          ) : ''
        }
        confirmText={settings.language === 'zh-CN' ? '确认导入' : 'Import'}
        cancelText={t('common.cancel')}
        type="warning"
        onConfirm={confirmImport}
        onCancel={() => setImportConfirm(null)}
      />
    </div>
  );
}

export default SettingsButton;
