/**
 * 自定义标题栏组件
 */

import { useState, useEffect } from 'react';
import { Minus, Square, X, Copy } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import './TitleBar.css';

declare global {
  interface Window {
    electronAPI: {
      window: {
        minimize: () => void;
        maximize: () => void;
        close: () => void;
        isMaximized: () => Promise<boolean>;
        onMaximizedChange: (callback: (isMaximized: boolean) => void) => () => void;
      };
    };
  }
}

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);
  const { effectiveTheme } = useSettings();

  useEffect(() => {
    // 获取初始状态
    window.electronAPI?.window.isMaximized().then(setIsMaximized);

    // 监听最大化状态变化
    const unsubscribe = window.electronAPI?.window.onMaximizedChange((maximized) => {
      setIsMaximized(maximized);
    });

    return () => {
      unsubscribe?.();
    };
  }, []);

  const handleMinimize = () => {
    window.electronAPI?.window.minimize();
  };

  const handleMaximize = () => {
    window.electronAPI?.window.maximize();
  };

  const handleClose = () => {
    window.electronAPI?.window.close();
  };

  return (
    <div className="title-bar">
      <div className="title-bar-drag">
        <div className="title-bar-icon">
          <img src="icon.png" alt="Redis Connector" className={effectiveTheme} />
        </div>
      </div>
      <div className="title-bar-controls">
        <button
          className="title-bar-button"
          onClick={handleMinimize}
          title="最小化"
        >
          <Minus size={16} />
        </button>
        <button
          className="title-bar-button"
          onClick={handleMaximize}
          title={isMaximized ? '还原' : '最大化'}
        >
          {isMaximized ? <Copy size={14} /> : <Square size={14} />}
        </button>
        <button
          className="title-bar-button title-bar-close"
          onClick={handleClose}
          title="关闭"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
