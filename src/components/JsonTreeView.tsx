import React, { useState, useCallback, useMemo } from 'react';
import { ChevronRight, ChevronDown, Copy, Check } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import './JsonTreeView.css';

interface JsonTreeViewProps {
  data: any;
  defaultExpanded?: boolean;
  maxDepth?: number;
  onCopy?: (value: string) => void;
}

interface TreeNodeProps {
  keyName: string | number | null;
  value: any;
  depth: number;
  maxDepth: number;
  defaultExpanded: boolean;
  path: string;
  onCopy?: (value: string) => void;
}

// 获取值的类型
function getValueType(value: any): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

// 格式化预览文本
function getPreview(value: any, type: string): string {
  switch (type) {
    case 'array':
      return `Array(${value.length})`;
    case 'object':
      const keys = Object.keys(value);
      return `Object{${keys.length}}`;
    case 'string':
      if (value.length > 50) {
        return `"${value.slice(0, 50)}..."`;
      }
      return `"${value}"`;
    case 'null':
      return 'null';
    case 'undefined':
      return 'undefined';
    case 'boolean':
      return String(value);
    case 'number':
      return String(value);
    default:
      return String(value);
  }
}

// 树节点组件
function TreeNode({ keyName, value, depth, maxDepth, defaultExpanded, path, onCopy }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(defaultExpanded && depth < 2);
  const [copied, setCopied] = useState(false);
  const { settings } = useSettings();

  const type = getValueType(value);
  const isExpandable = type === 'object' || type === 'array';
  const hasChildren = isExpandable && (
    type === 'array' ? value.length > 0 : Object.keys(value).length > 0
  );

  const handleToggle = useCallback(() => {
    if (hasChildren && depth < maxDepth) {
      setExpanded(e => !e);
    }
  }, [hasChildren, depth, maxDepth]);

  const handleCopy = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const textToCopy = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    navigator.clipboard.writeText(textToCopy).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      onCopy?.(textToCopy);
    });
  }, [value, onCopy]);

  const indent = depth * 16;

  // 渲染子节点
  const renderChildren = () => {
    if (!expanded || !hasChildren) return null;

    if (type === 'array') {
      return value.map((item: any, index: number) => (
        <TreeNode
          key={index}
          keyName={index}
          value={item}
          depth={depth + 1}
          maxDepth={maxDepth}
          defaultExpanded={defaultExpanded}
          path={`${path}[${index}]`}
          onCopy={onCopy}
        />
      ));
    }

    return Object.entries(value).map(([k, v]) => (
      <TreeNode
        key={k}
        keyName={k}
        value={v}
        depth={depth + 1}
        maxDepth={maxDepth}
        defaultExpanded={defaultExpanded}
        path={`${path}.${k}`}
        onCopy={onCopy}
      />
    ));
  };

  return (
    <div className="tree-node">
      <div
        className={`tree-node-row ${hasChildren ? 'expandable' : ''} ${expanded ? 'expanded' : ''}`}
        style={{ paddingLeft: indent }}
        onClick={handleToggle}
      >
        {/* 展开/折叠图标 */}
        <span className="tree-toggle">
          {hasChildren && depth < maxDepth ? (
            expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
          ) : (
            <span className="toggle-placeholder" />
          )}
        </span>

        {/* Key 名称 */}
        {keyName !== null && (
          <span className="tree-key">
            {typeof keyName === 'number' ? (
              <span className="key-index">{keyName}</span>
            ) : (
              <span className="key-name">"{keyName}"</span>
            )}
            <span className="key-colon">:</span>
          </span>
        )}

        {/* 值 */}
        <span className={`tree-value type-${type}`}>
          {isExpandable ? (
            <>
              {expanded ? (
                type === 'array' ? '[' : '{'
              ) : (
                getPreview(value, type)
              )}
            </>
          ) : (
            getPreview(value, type)
          )}
        </span>

        {/* 复制按钮 */}
        <button
          className={`tree-copy-btn ${copied ? 'copied' : ''}`}
          onClick={handleCopy}
          title={settings.language === 'zh-CN' ? '复制' : 'Copy'}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
      </div>

      {/* 子节点 */}
      {expanded && hasChildren && (
        <div className="tree-children">
          {renderChildren()}
          {/* 闭合括号 */}
          <div className="tree-bracket" style={{ paddingLeft: indent }}>
            {type === 'array' ? ']' : '}'}
          </div>
        </div>
      )}
    </div>
  );
}

// 主组件
function JsonTreeView({ data, defaultExpanded = true, maxDepth = 10, onCopy }: JsonTreeViewProps) {
  const { settings } = useSettings();
  const [viewMode, setViewMode] = useState<'tree' | 'raw'>('tree');
  const [copied, setCopied] = useState(false);

  // 检测是否为有效的可展示数据
  const isValidData = useMemo(() => {
    const type = getValueType(data);
    return type === 'object' || type === 'array';
  }, [data]);

  // 格式化的 JSON 字符串
  const formattedJson = useMemo(() => {
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return String(data);
    }
  }, [data]);

  const handleCopyAll = useCallback(() => {
    navigator.clipboard.writeText(formattedJson).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      onCopy?.(formattedJson);
    });
  }, [formattedJson, onCopy]);

  // 如果不是对象或数组，直接显示原始值
  if (!isValidData) {
    return (
      <div className="json-tree-view simple">
        <pre className={`simple-value type-${getValueType(data)}`}>
          {getPreview(data, getValueType(data))}
        </pre>
      </div>
    );
  }

  return (
    <div className="json-tree-view">
      {/* 工具栏 */}
      <div className="json-tree-toolbar">
        <div className="view-toggle">
          <button
            className={viewMode === 'tree' ? 'active' : ''}
            onClick={() => setViewMode('tree')}
          >
            {settings.language === 'zh-CN' ? '树状' : 'Tree'}
          </button>
          <button
            className={viewMode === 'raw' ? 'active' : ''}
            onClick={() => setViewMode('raw')}
          >
            {settings.language === 'zh-CN' ? '原始' : 'Raw'}
          </button>
        </div>
        <button
          className={`copy-all-btn ${copied ? 'copied' : ''}`}
          onClick={handleCopyAll}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {settings.language === 'zh-CN' ? '复制全部' : 'Copy All'}
        </button>
      </div>

      {/* 内容区域 */}
      <div className="json-tree-content">
        {viewMode === 'tree' ? (
          <div className="tree-container">
            <TreeNode
              keyName={null}
              value={data}
              depth={0}
              maxDepth={maxDepth}
              defaultExpanded={defaultExpanded}
              path="$"
              onCopy={onCopy}
            />
          </div>
        ) : (
          <pre className="raw-json">{formattedJson}</pre>
        )}
      </div>
    </div>
  );
}

export default React.memo(JsonTreeView);
