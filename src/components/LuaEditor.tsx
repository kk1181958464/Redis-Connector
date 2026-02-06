import React, { useState, useCallback, useEffect } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { createTheme } from '@uiw/codemirror-themes';
import { StreamLanguage } from '@codemirror/language';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { tags as t } from '@lezer/highlight';
import { Play, Save, FolderOpen, Plus, Trash2, Copy, Check, Code } from 'lucide-react';
import Modal from './Modal';
import { useToast } from './Toast';
import './LuaEditor.css';

interface LuaEditorProps {
  isOpen: boolean;
  onClose: () => void;
  onExecute: (command: string) => Promise<any>;
}

interface LuaScript {
  id: string;
  name: string;
  content: string;
  keys: string;
  argv: string;
  createdAt: number;
  updatedAt: number;
}

interface ExecuteResult {
  success: boolean;
  data?: any;
  error?: string;
  duration: number;
}

// 默认脚本模板
const DEFAULT_SCRIPT = `-- Redis Lua 脚本示例
-- KEYS[1]: 要操作的 key
-- ARGV[1]: 参数值

local key = KEYS[1]
local value = redis.call('GET', key)

if value then
  return value
else
  return nil
end`;

// CodeMirror 暗色主题
const darkTheme = createTheme({
  theme: 'dark',
  settings: {
    background: 'var(--bg-primary)',
    foreground: 'var(--text-primary)',
    caret: 'var(--text-primary)',
    selection: 'var(--accent-muted)',
    selectionMatch: 'var(--accent-muted)',
    lineHighlight: 'var(--bg-tertiary)',
    gutterBackground: 'var(--bg-secondary)',
    gutterForeground: 'var(--text-muted)',
    gutterBorder: 'var(--border)',
    fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace",
  },
  styles: [
    { tag: t.keyword, color: '#c586c0' },
    { tag: t.comment, color: '#6a9955', fontStyle: 'italic' },
    { tag: t.string, color: '#ce9178' },
    { tag: t.number, color: '#b5cea8' },
    { tag: t.function(t.variableName), color: '#dcdcaa' },
    { tag: t.variableName, color: '#9cdcfe' },
    { tag: t.operator, color: '#d4d4d4' },
    { tag: t.bool, color: '#569cd6' },
    { tag: t.null, color: '#569cd6' },
  ],
});

// Lua 语言扩展
const luaLanguage = StreamLanguage.define(lua);

function LuaEditor({ isOpen, onClose, onExecute }: LuaEditorProps) {
  const [scripts, setScripts] = useState<LuaScript[]>([]);
  const [currentScript, setCurrentScript] = useState<LuaScript | null>(null);
  const [code, setCode] = useState(DEFAULT_SCRIPT);
  const [keys, setKeys] = useState('');
  const [argv, setArgv] = useState('');
  const [result, setResult] = useState<ExecuteResult | null>(null);
  const [executing, setExecuting] = useState(false);
  const [showScriptList, setShowScriptList] = useState(false);
  const [newScriptName, setNewScriptName] = useState('');
  const [copied, setCopied] = useState(false);

  const { showToast } = useToast();

  // 加载保存的脚本
  useEffect(() => {
    const saved = localStorage.getItem('redis-lua-scripts');
    if (saved) {
      try {
        setScripts(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to load scripts:', e);
      }
    }
  }, []);

  // 保存脚本到 localStorage
  const saveScripts = useCallback((newScripts: LuaScript[]) => {
    setScripts(newScripts);
    localStorage.setItem('redis-lua-scripts', JSON.stringify(newScripts));
  }, []);

  // 执行脚本
  const handleExecute = useCallback(async () => {
    if (!code.trim()) {
      showToast('请输入 Lua 脚本', 'warning');
      return;
    }

    setExecuting(true);
    setResult(null);

    const startTime = Date.now();

    try {
      // 解析 KEYS 和 ARGV
      const keyList = keys.trim() ? keys.split(',').map(k => k.trim()).filter(Boolean) : [];
      const argvList = argv.trim() ? argv.split(',').map(a => a.trim()).filter(Boolean) : [];

      // 构建 EVAL 命令
      const parts = ['EVAL', JSON.stringify(code), String(keyList.length)];
      keyList.forEach(k => parts.push(k));
      argvList.forEach(a => parts.push(a));
      const command = parts.join(' ');

      const response = await onExecute(command);
      const duration = Date.now() - startTime;

      if (response?.success) {
        setResult({
          success: true,
          data: response.data,
          duration
        });
      } else {
        setResult({
          success: false,
          error: response?.error || '执行失败',
          duration
        });
      }
    } catch (error: any) {
      const duration = Date.now() - startTime;
      setResult({
        success: false,
        error: error.message || String(error),
        duration
      });
    } finally {
      setExecuting(false);
    }
  }, [code, keys, argv, onExecute, showToast]);

  // 新建脚本
  const handleNewScript = useCallback(() => {
    setCurrentScript(null);
    setCode(DEFAULT_SCRIPT);
    setKeys('');
    setArgv('');
    setResult(null);
    setShowScriptList(false);
    showToast('已新建脚本', 'success');
  }, [showToast]);

  // 保存当前脚本
  const handleSaveScript = useCallback(() => {
    if (!newScriptName.trim() && !currentScript) {
      showToast('请输入脚本名称', 'warning');
      return;
    }

    const now = Date.now();
    let newScripts: LuaScript[];

    if (currentScript) {
      // 更新现有脚本
      newScripts = scripts.map(s =>
        s.id === currentScript.id
          ? { ...s, content: code, keys, argv, updatedAt: now }
          : s
      );
      showToast('脚本已更新', 'success');
    } else {
      // 创建新脚本
      const newScript: LuaScript = {
        id: `script-${now}`,
        name: newScriptName.trim(),
        content: code,
        keys,
        argv,
        createdAt: now,
        updatedAt: now
      };
      newScripts = [...scripts, newScript];
      setCurrentScript(newScript);
      setNewScriptName('');
      showToast('脚本已保存', 'success');
    }

    saveScripts(newScripts);
  }, [code, keys, argv, currentScript, newScriptName, scripts, saveScripts, showToast]);

  // 加载脚本
  const handleLoadScript = useCallback((script: LuaScript) => {
    setCurrentScript(script);
    setCode(script.content);
    setKeys(script.keys);
    setArgv(script.argv);
    setResult(null);
    setShowScriptList(false);
  }, []);

  // 删除脚本
  const handleDeleteScript = useCallback((scriptId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newScripts = scripts.filter(s => s.id !== scriptId);
    saveScripts(newScripts);
    if (currentScript?.id === scriptId) {
      handleNewScript();
    }
    showToast('脚本已删除', 'success');
  }, [scripts, currentScript, saveScripts, handleNewScript, showToast]);

  // 复制代码
  const handleCopyCode = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      showToast('代码已复制', 'success');
    } catch (e) {
      showToast('复制失败', 'error');
    }
  }, [code, showToast]);

  // 格式化结果
  const formatResult = (data: any): string => {
    if (data === null) return '(nil)';
    if (data === undefined) return '(nil)';
    if (typeof data === 'string') return `"${data}"`;
    if (typeof data === 'number') return `(integer) ${data}`;
    if (typeof data === 'boolean') return data ? '(true)' : '(false)';
    if (Array.isArray(data)) {
      if (data.length === 0) return '(empty array)';
      return data.map((item, i) => `${i + 1}) ${formatResult(item)}`).join('\n');
    }
    return JSON.stringify(data, null, 2);
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div className="lua-editor-title">
          <Code size={18} />
          <span>Lua 脚本编辑器</span>
          {currentScript && (
            <span className="current-script-name">{currentScript.name}</span>
          )}
        </div>
      }
      storageKey="lua-editor-modal"
      width={900}
      height={700}
      minWidth={600}
      minHeight={500}
    >
      <div className="lua-editor">
        {/* 工具栏 */}
        <div className="lua-toolbar">
          <div className="toolbar-left">
            <button
              className="toolbar-btn"
              onClick={handleNewScript}
              disabled={!currentScript}
              title="新建脚本"
            >
              <Plus size={16} />
              <span>新建</span>
            </button>
            <div className="open-script-wrapper">
              <button
                className={`toolbar-btn ${showScriptList ? 'active' : ''}`}
                onClick={() => setShowScriptList(!showScriptList)}
                title="打开脚本"
              >
                <FolderOpen size={16} />
                <span>打开</span>
                {scripts.length > 0 && (
                  <span className="script-count">{scripts.length}</span>
                )}
              </button>
              {/* 脚本列表下拉 */}
              {showScriptList && (
                <div className="script-list-dropdown">
                  {scripts.length === 0 ? (
                    <div className="script-list-empty">暂无保存的脚本</div>
                  ) : (
                    scripts.map(script => (
                      <div
                        key={script.id}
                        className={`script-list-item ${currentScript?.id === script.id ? 'active' : ''}`}
                        onClick={() => handleLoadScript(script)}
                      >
                        <div className="script-info">
                          <span className="script-name">{script.name}</span>
                          <span className="script-date">
                            {new Date(script.updatedAt).toLocaleDateString()}
                          </span>
                        </div>
                        <button
                          className="script-delete-btn"
                          onClick={e => handleDeleteScript(script.id, e)}
                          title="删除脚本"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
            {/* 新建状态：显示脚本名称输入框和保存按钮 */}
            {!currentScript && (
              <div className="save-group">
                <input
                  type="text"
                  className="script-name-input"
                  placeholder="脚本名称..."
                  value={newScriptName}
                  onChange={e => setNewScriptName(e.target.value)}
                />
                <button className="toolbar-btn" onClick={handleSaveScript} title="保存脚本">
                  <Save size={16} />
                  <span>保存</span>
                </button>
              </div>
            )}
            {/* 已加载脚本状态：显示脚本名称标签和保存按钮 */}
            {currentScript && (
              <div className="save-group">
                <span className="current-script-badge">{currentScript.name}</span>
                <button className="toolbar-btn" onClick={handleSaveScript} title="保存修改">
                  <Save size={16} />
                  <span>保存</span>
                </button>
              </div>
            )}
          </div>
          <div className="toolbar-right">
            <button
              className={`toolbar-btn copy-btn ${copied ? 'copied' : ''}`}
              onClick={handleCopyCode}
              title="复制代码"
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
            </button>
            <button
              className="toolbar-btn execute-btn"
              onClick={handleExecute}
              disabled={executing}
              title="执行脚本 (Ctrl+Enter)"
            >
              <Play size={16} />
              <span>{executing ? '执行中...' : '执行'}</span>
            </button>
          </div>
        </div>

        {/* CodeMirror 编辑器 */}
        <div className="editor-container">
          <CodeMirror
            value={code}
            onChange={setCode}
            extensions={[luaLanguage]}
            theme={darkTheme}
            basicSetup={{
              lineNumbers: true,
              highlightActiveLineGutter: true,
              highlightActiveLine: true,
              foldGutter: false,
              dropCursor: true,
              allowMultipleSelections: true,
              indentOnInput: true,
              bracketMatching: true,
              closeBrackets: true,
              autocompletion: false,
              rectangularSelection: true,
              crosshairCursor: false,
              highlightSelectionMatches: true,
              searchKeymap: true,
              tabSize: 2,
            }}
            placeholder="在此输入 Lua 脚本..."
            className="code-editor"
          />
        </div>

        {/* 参数输入 */}
        <div className="params-section">
          <div className="param-group">
            <label>KEYS <span className="param-hint">(逗号分隔)</span></label>
            <input
              type="text"
              value={keys}
              onChange={e => setKeys(e.target.value)}
              placeholder="key1, key2, key3..."
            />
          </div>
          <div className="param-group">
            <label>ARGV <span className="param-hint">(逗号分隔)</span></label>
            <input
              type="text"
              value={argv}
              onChange={e => setArgv(e.target.value)}
              placeholder="arg1, arg2, arg3..."
            />
          </div>
        </div>

        {/* 执行结果 */}
        <div className="result-section">
          <div className="result-header">
            <span>执行结果</span>
            {result && (
              <span className={`result-status ${result.success ? 'success' : 'error'}`}>
                {result.success ? '成功' : '失败'} · {result.duration}ms
              </span>
            )}
          </div>
          <div className={`result-content ${result?.success === false ? 'error' : ''}`}>
            {result ? (
              result.success ? (
                <pre>{formatResult(result.data)}</pre>
              ) : (
                <pre className="error-message">{result.error}</pre>
              )
            ) : (
              <span className="result-placeholder">执行脚本后在此显示结果...</span>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default LuaEditor;
