/**
 * 应用设置类型定义
 */

export type ThemeMode = 'dark' | 'light' | 'system';
export type Language = 'zh-CN' | 'en-US';
export type AccentColor = 'blue' | 'green' | 'purple' | 'orange' | 'pink' | 'cyan' | 'red' | 'yellow';

export interface AppSettings {
  // 外观设置
  appearance: {
    theme: ThemeMode;
    fontFamily: string;
    accentColor: AccentColor;
  };
  // 语言设置
  language: Language;
  // 数据设置
  data: {
    keysPerPage: number;
  };
}

export const DEFAULT_SETTINGS: AppSettings = {
  appearance: {
    theme: 'dark',
    fontFamily: 'system-ui',
    accentColor: 'blue',
  },
  language: 'zh-CN',
  data: {
    keysPerPage: 100,
  },
};

// 主题配色选项
export const ACCENT_COLOR_OPTIONS: { value: AccentColor; label: { 'zh-CN': string; 'en-US': string }; color: string }[] = [
  { value: 'blue', label: { 'zh-CN': '蓝色', 'en-US': 'Blue' }, color: '#58a6ff' },
  { value: 'green', label: { 'zh-CN': '绿色', 'en-US': 'Green' }, color: '#3fb950' },
  { value: 'purple', label: { 'zh-CN': '紫色', 'en-US': 'Purple' }, color: '#a371f7' },
  { value: 'orange', label: { 'zh-CN': '橙色', 'en-US': 'Orange' }, color: '#f0883e' },
  { value: 'pink', label: { 'zh-CN': '粉色', 'en-US': 'Pink' }, color: '#db61a2' },
  { value: 'cyan', label: { 'zh-CN': '青色', 'en-US': 'Cyan' }, color: '#39c5cf' },
  { value: 'red', label: { 'zh-CN': '红色', 'en-US': 'Red' }, color: '#f85149' },
  { value: 'yellow', label: { 'zh-CN': '黄色', 'en-US': 'Yellow' }, color: '#d29922' },
];

// Key 加载数量选项
export const KEYS_PER_PAGE_OPTIONS = [50, 100, 200, 500, 1000, 2000, 5000, 10000];

// 可选字体列表
export const FONT_OPTIONS = [
  { value: 'system-ui', label: { 'zh-CN': '系统默认', 'en-US': 'System Default' } },
  { value: '"Microsoft YaHei", sans-serif', label: { 'zh-CN': '微软雅黑', 'en-US': 'Microsoft YaHei' } },
  { value: '"PingFang SC", sans-serif', label: { 'zh-CN': '苹方', 'en-US': 'PingFang SC' } },
  { value: '"Source Han Sans SC", sans-serif', label: { 'zh-CN': '思源黑体', 'en-US': 'Source Han Sans' } },
  { value: 'Consolas, monospace', label: { 'zh-CN': 'Consolas', 'en-US': 'Consolas' } },
  { value: '"JetBrains Mono", monospace', label: { 'zh-CN': 'JetBrains Mono', 'en-US': 'JetBrains Mono' } },
];

// 国际化文本
export const I18N: Record<Language, Record<string, string>> = {
  'zh-CN': {
    // 通用
    'app.title': 'Redis Connector',
    'common.confirm': '确认',
    'common.cancel': '取消',
    'common.save': '保存',
    'common.close': '关闭',

    // 设置
    'settings.title': '设置',
    'settings.appearance': '外观',
    'settings.theme': '主题',
    'settings.theme.dark': '深色',
    'settings.theme.light': '浅色',
    'settings.theme.system': '跟随系统',
    'settings.accentColor': '主题色',
    'settings.font': '字体',
    'settings.language': '语言',
    'settings.data': '数据',
    'settings.keysPerPage': '每页 Key 数量',
    'settings.export': '导出配置',
    'settings.import': '导入配置',
    'settings.exportSuccess': '配置已导出',
    'settings.importSuccess': '配置导入成功',
    'settings.importFailed': '配置导入失败',
    'settings.importConfirm': '导入配置将覆盖当前所有连接配置，是否继续？',
    'settings.configManagement': '配置管理',

    // 连接
    'connection.title': '连接管理',
    'connection.add': '添加连接',
    'connection.empty': '暂无连接',
    'connection.empty.hint': '点击 + 添加新连接',
    'connection.disconnect': '断开连接',
    'connection.name': '连接名称',
    'connection.host': '主机地址',
    'connection.port': '端口',
    'connection.password': '密码',
    'connection.database': '数据库',
    'connection.connect': '连接',
    'connection.test': '测试连接',
    'connection.direct': '直连',
    'connection.ssh': 'SSH 隧道',
    'connection.edit': '编辑',
    'connection.details': '详情',
    'connection.refresh': '刷新',
    'connection.delete': '删除连接',
    'connection.deleteConfirm': '确定要删除此连接吗？',

    // SSH
    'ssh.host': 'SSH 主机',
    'ssh.port': 'SSH 端口',
    'ssh.username': '用户名',
    'ssh.auth': '认证方式',
    'ssh.auth.password': '密码',
    'ssh.auth.privateKey': '私钥',
    'ssh.privateKey': '私钥路径',
    'ssh.passphrase': '私钥密码',

    // 控制台
    'console.placeholder': '输入 Redis 命令...',
    'console.execute': '执行',
    'console.clear': '清空',
    'console.hide': '隐藏控制台',
    'console.show': '显示控制台',

    // Key 浏览器
    'keyBrowser.title': 'Key 浏览器',
    'keyBrowser.search': '搜索模式 (支持 * 通配符)',
    'keyBrowser.scan': '扫描',
    'keyBrowser.scanning': '扫描中...',
    'keyBrowser.fullSearch': '搜索全部',
    'keyBrowser.fullSearchHint': '完整扫描数据库，查找所有匹配的 Key',
    'keyBrowser.noKeys': '无匹配的 Key',
    'keyBrowser.selectKey': '选择一个 Key 查看详情',
    'keyBrowser.loading': '加载中...',
    'keyBrowser.delete': '删除',
    'keyBrowser.deleteConfirm': '确定要删除此 Key 吗？',
    'keyBrowser.deleteAll': '删除当前列表',
    'keyBrowser.loadMore': '加载更多',
    'keyBrowser.loadAll': '加载全部',
    'keyBrowser.page': '页',
    'keyBrowser.total': '共',
    'keyBrowser.items': '项',
    'keyBrowser.edit': '编辑',
    'keyBrowser.save': '保存',
    'keyBrowser.cancel': '取消',
    'keyBrowser.saving': '保存中...',
    'keyBrowser.ttl': 'TTL (秒)',
    'keyBrowser.ttlHint': '-1 或留空 = 永不过期',
    'keyBrowser.renameFailed': '重命名失败',
    'keyBrowser.saveFailed': '保存失败',
    'keyBrowser.hashHint': 'JSON 对象格式: {"field1": "value1", "field2": "value2"}',
    'keyBrowser.listHint': 'JSON 数组格式: ["item1", "item2", "item3"]',
    'keyBrowser.setHint': 'JSON 数组格式: ["member1", "member2"]',
    'keyBrowser.zsetHint': '数组格式: [{"member": "xxx", "score": 1}, ...]',
    'keyBrowser.stringHint': '直接输入字符串内容',

    // 状态
    'status.connected': '已连接',
    'status.connecting': '连接中',
    'status.disconnected': '未连接',
    'status.error': '连接错误',
    'status.ready': '就绪',

    // 无连接
    'noConnection.title': '未连接到 Redis',
    'noConnection.hint': '请在左侧面板添加并连接到 Redis 服务器',
  },
  'en-US': {
    // Common
    'app.title': 'Redis Connector',
    'common.confirm': 'Confirm',
    'common.cancel': 'Cancel',
    'common.save': 'Save',
    'common.close': 'Close',

    // Settings
    'settings.title': 'Settings',
    'settings.appearance': 'Appearance',
    'settings.theme': 'Theme',
    'settings.theme.dark': 'Dark',
    'settings.theme.light': 'Light',
    'settings.theme.system': 'System',
    'settings.accentColor': 'Accent Color',
    'settings.font': 'Font',
    'settings.language': 'Language',
    'settings.data': 'Data',
    'settings.keysPerPage': 'Keys Per Page',
    'settings.export': 'Export Config',
    'settings.import': 'Import Config',
    'settings.exportSuccess': 'Config exported',
    'settings.importSuccess': 'Config imported successfully',
    'settings.importFailed': 'Config import failed',
    'settings.importConfirm': 'Importing will overwrite all current connection configs. Continue?',
    'settings.configManagement': 'Config Management',

    // Connection
    'connection.title': 'Connections',
    'connection.add': 'Add Connection',
    'connection.empty': 'No Connections',
    'connection.empty.hint': 'Click + to add a new connection',
    'connection.disconnect': 'Disconnect',
    'connection.name': 'Connection Name',
    'connection.host': 'Host',
    'connection.port': 'Port',
    'connection.password': 'Password',
    'connection.database': 'Database',
    'connection.connect': 'Connect',
    'connection.test': 'Test Connection',
    'connection.direct': 'Direct',
    'connection.ssh': 'SSH Tunnel',
    'connection.edit': 'Edit',
    'connection.details': 'Details',
    'connection.refresh': 'Refresh',
    'connection.delete': 'Delete Connection',
    'connection.deleteConfirm': 'Are you sure you want to delete this connection?',

    // SSH
    'ssh.host': 'SSH Host',
    'ssh.port': 'SSH Port',
    'ssh.username': 'Username',
    'ssh.auth': 'Authentication',
    'ssh.auth.password': 'Password',
    'ssh.auth.privateKey': 'Private Key',
    'ssh.privateKey': 'Private Key Path',
    'ssh.passphrase': 'Passphrase',

    // Console
    'console.placeholder': 'Enter Redis command...',
    'console.execute': 'Execute',
    'console.clear': 'Clear',
    'console.hide': 'Hide Console',
    'console.show': 'Show Console',

    // Key Browser
    'keyBrowser.title': 'Key Browser',
    'keyBrowser.search': 'Search pattern (supports * wildcard)',
    'keyBrowser.scan': 'Scan',
    'keyBrowser.scanning': 'Scanning...',
    'keyBrowser.fullSearch': 'Full Search',
    'keyBrowser.fullSearchHint': 'Scan entire database to find all matching keys',
    'keyBrowser.noKeys': 'No matching keys',
    'keyBrowser.selectKey': 'Select a key to view details',
    'keyBrowser.loading': 'Loading...',
    'keyBrowser.delete': 'Delete',
    'keyBrowser.deleteConfirm': 'Are you sure you want to delete this key?',
    'keyBrowser.deleteAll': 'Delete Listed Keys',
    'keyBrowser.loadMore': 'Load More',
    'keyBrowser.loadAll': 'Load All',
    'keyBrowser.page': 'Page',
    'keyBrowser.total': 'Total',
    'keyBrowser.items': 'items',
    'keyBrowser.edit': 'Edit',
    'keyBrowser.save': 'Save',
    'keyBrowser.cancel': 'Cancel',
    'keyBrowser.saving': 'Saving...',
    'keyBrowser.ttl': 'TTL (seconds)',
    'keyBrowser.ttlHint': '-1 or empty = never expires',
    'keyBrowser.renameFailed': 'Rename failed',
    'keyBrowser.saveFailed': 'Save failed',
    'keyBrowser.hashHint': 'JSON object format: {"field1": "value1", "field2": "value2"}',
    'keyBrowser.listHint': 'JSON array format: ["item1", "item2", "item3"]',
    'keyBrowser.setHint': 'JSON array format: ["member1", "member2"]',
    'keyBrowser.zsetHint': 'Array format: [{"member": "xxx", "score": 1}, ...]',
    'keyBrowser.stringHint': 'Enter string content directly',

    // Status
    'status.connected': 'Connected',
    'status.connecting': 'Connecting',
    'status.disconnected': 'Disconnected',
    'status.error': 'Error',
    'status.ready': 'Ready',

    // No Connection
    'noConnection.title': 'Not Connected to Redis',
    'noConnection.hint': 'Add and connect to a Redis server from the left panel',
  },
};
