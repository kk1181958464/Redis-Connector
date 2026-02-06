/**
 * 自定义标题栏组件
 */

import { useState, useEffect } from 'react';
import { Minus, Square, X, Copy } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import Modal from './Modal';
import './TitleBar.css';

// 关闭行为存储 key
const CLOSE_BEHAVIOR_KEY = 'close-behavior';

type CloseBehavior = 'minimize' | 'quit' | null;

// 加载关闭行为设置
function loadCloseBehavior(): CloseBehavior {
  try {
    const saved = localStorage.getItem(CLOSE_BEHAVIOR_KEY);
    if (saved === 'minimize' || saved === 'quit') {
      return saved;
    }
  } catch (e) {
    console.error('Failed to load close behavior:', e);
  }
  return null;
}

// 保存关闭行为设置
function saveCloseBehavior(behavior: CloseBehavior) {
  try {
    if (behavior) {
      localStorage.setItem(CLOSE_BEHAVIOR_KEY, behavior);
    } else {
      localStorage.removeItem(CLOSE_BEHAVIOR_KEY);
    }
  } catch (e) {
    console.error('Failed to save close behavior:', e);
  }
}

declare global {
  interface Window {
    electronAPI: {
      window: {
        minimize: () => void;
        maximize: () => void;
        close: () => void;
        quit: () => void;
        isMaximized: () => Promise<boolean>;
        onMaximizedChange: (callback: (isMaximized: boolean) => void) => () => void;
      };
    };
  }
}

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [rememberChoice, setRememberChoice] = useState(false);
  const { effectiveTheme, settings } = useSettings();

  const isZh = settings.language === 'zh-CN';

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
    const savedBehavior = loadCloseBehavior();

    if (savedBehavior === 'minimize') {
      window.electronAPI?.window.close();
    } else if (savedBehavior === 'quit') {
      window.electronAPI?.window.quit();
    } else {
      // 没有保存的选择，显示弹窗
      setShowCloseModal(true);
      setRememberChoice(false);
    }
  };

  const handleCloseChoice = (choice: 'minimize' | 'quit') => {
    if (rememberChoice) {
      saveCloseBehavior(choice);
    }

    setShowCloseModal(false);

    if (choice === 'minimize') {
      window.electronAPI?.window.close();
    } else {
      window.electronAPI?.window.quit();
    }
  };

  return (
    <>
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
            title={isZh ? '最小化' : 'Minimize'}
          >
            <Minus size={16} />
          </button>
          <button
            className="title-bar-button"
            onClick={handleMaximize}
            title={isMaximized ? (isZh ? '还原' : 'Restore') : (isZh ? '最大化' : 'Maximize')}
          >
            {isMaximized ? <Copy size={14} /> : <Square size={14} />}
          </button>
          <button
            className="title-bar-button title-bar-close"
            onClick={handleClose}
            title={isZh ? '关闭' : 'Close'}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* 关闭确认弹窗 */}
      <Modal
        isOpen={showCloseModal}
        onClose={() => setShowCloseModal(false)}
        title={isZh ? '关闭窗口' : 'Close Window'}
        width={400}
        height={280}
        minWidth={350}
        minHeight={250}
        className="close-confirm-modal"
        storageKey="close-confirm"
      >
        <div className="close-confirm-content">
          <p className="close-confirm-message">
            {isZh ? '请选择关闭窗口的方式：' : 'Choose how to close the window:'}
          </p>

          <div className="close-confirm-options">
            <button
              className="close-option-btn minimize"
              onClick={() => handleCloseChoice('minimize')}
            >
              <Minus size={20} />
              <span className="option-label">{isZh ? '最小化到托盘' : 'Minimize to Tray'}</span>
              <span className="option-desc">{isZh ? '程序在后台继续运行' : 'App keeps running in background'}</span>
            </button>

            <button
              className="close-option-btn quit"
              onClick={() => handleCloseChoice('quit')}
            >
              <X size={20} />
              <span className="option-label">{isZh ? '退出程序' : 'Quit Application'}</span>
              <span className="option-desc">{isZh ? '完全关闭程序' : 'Close the app completely'}</span>
            </button>
          </div>

          <label className="remember-choice">
            <input
              type="checkbox"
              checked={rememberChoice}
              onChange={(e) => setRememberChoice(e.target.checked)}
            />
            <span>{isZh ? '记住我的选择' : 'Remember my choice'}</span>
          </label>
        </div>
      </Modal>
    </>
  );
}
