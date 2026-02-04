import { X, Keyboard } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import './ShortcutsModal.css';

interface ShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutItem {
  keys: string[];
  description: { zh: string; en: string };
}

interface ShortcutGroup {
  title: { zh: string; en: string };
  shortcuts: ShortcutItem[];
}

const shortcutGroups: ShortcutGroup[] = [
  {
    title: { zh: '全局', en: 'Global' },
    shortcuts: [
      { keys: ['Ctrl', 'N'], description: { zh: '新建连接', en: 'New Connection' } },
      { keys: ['Ctrl', 'R'], description: { zh: '刷新 Key 列表', en: 'Refresh Keys' } },
      { keys: ['Ctrl', ','], description: { zh: '打开设置', en: 'Open Settings' } },
      { keys: ['Ctrl', 'I'], description: { zh: '服务器信息', en: 'Server Info' } },
      { keys: ['Ctrl', '?'], description: { zh: '快捷键帮助', en: 'Shortcuts Help' } },
      { keys: ['Esc'], description: { zh: '关闭弹窗', en: 'Close Modal' } },
    ],
  },
  {
    title: { zh: 'Key 浏览器', en: 'Key Browser' },
    shortcuts: [
      { keys: ['Ctrl', 'F'], description: { zh: '搜索 Key', en: 'Search Keys' } },
      { keys: ['Delete'], description: { zh: '删除选中 Key', en: 'Delete Selected Key' } },
      { keys: ['Ctrl', 'D'], description: { zh: '复制 Key', en: 'Duplicate Key' } },
      { keys: ['↑', '↓'], description: { zh: '选择上/下一个 Key', en: 'Select Prev/Next Key' } },
      { keys: ['Enter'], description: { zh: '查看 Key 详情', en: 'View Key Details' } },
    ],
  },
  {
    title: { zh: '命令控制台', en: 'Command Console' },
    shortcuts: [
      { keys: ['↑'], description: { zh: '上一条历史命令', en: 'Previous Command' } },
      { keys: ['↓'], description: { zh: '下一条历史命令', en: 'Next Command' } },
      { keys: ['Tab'], description: { zh: '命令自动补全', en: 'Auto Complete' } },
      { keys: ['Enter'], description: { zh: '执行命令', en: 'Execute Command' } },
      { keys: ['Ctrl', 'L'], description: { zh: '清除控制台', en: 'Clear Console' } },
    ],
  },
  {
    title: { zh: '编辑器', en: 'Editor' },
    shortcuts: [
      { keys: ['Ctrl', 'S'], description: { zh: '保存修改', en: 'Save Changes' } },
      { keys: ['Ctrl', 'Z'], description: { zh: '撤销', en: 'Undo' } },
      { keys: ['Ctrl', 'Shift', 'Z'], description: { zh: '重做', en: 'Redo' } },
    ],
  },
];

function ShortcutsModal({ isOpen, onClose }: ShortcutsModalProps) {
  const { settings } = useSettings();
  const isZh = settings.language === 'zh-CN';

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="shortcuts-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>
            <Keyboard size={20} />
            {isZh ? '快捷键' : 'Keyboard Shortcuts'}
          </h2>
          <button className="close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="modal-body">
          {shortcutGroups.map((group, groupIndex) => (
            <div key={groupIndex} className="shortcut-group">
              <h3 className="group-title">{isZh ? group.title.zh : group.title.en}</h3>
              <div className="shortcut-list">
                {group.shortcuts.map((shortcut, index) => (
                  <div key={index} className="shortcut-item">
                    <div className="shortcut-keys">
                      {shortcut.keys.map((key, keyIndex) => (
                        <span key={keyIndex}>
                          <kbd>{key}</kbd>
                          {keyIndex < shortcut.keys.length - 1 && <span className="key-separator">+</span>}
                        </span>
                      ))}
                    </div>
                    <span className="shortcut-desc">
                      {isZh ? shortcut.description.zh : shortcut.description.en}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="modal-footer">
          <p className="hint">
            {isZh
              ? '提示：在 Mac 上，Ctrl 对应 ⌘ Command 键'
              : 'Tip: On Mac, Ctrl corresponds to ⌘ Command key'}
          </p>
        </div>
      </div>
    </div>
  );
}

export default ShortcutsModal;
