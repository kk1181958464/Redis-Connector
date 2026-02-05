# AGENTS.md - 项目上下文文档

## 项目概述

**Redis Connector** 是一个基于 Electron + TypeScript + React 构建的 Redis 图形化管理工具，核心特点是**自研 RESP 协议解析层**，而非依赖现有的 Redis 客户端库（如 ioredis）。这是一个学习型项目，旨在深入理解 Redis 通信协议并提供轻量级、可控的桌面客户端解决方案。

### 项目定位
- **类型**: 跨平台桌面应用（Windows / macOS / Linux）
- **核心价值**: 自研 RESP2 协议实现，学习价值和可控性优先于开发效率
- **目标用户**: Redis 开发者、数据库管理员、协议学习研究者

### 技术栈
| 层级 | 技术选型 |
|------|----------|
| 协议层 | 自研 RESP 解析器 + Node.js net/tls 模块 |
| 桌面框架 | Electron 28 |
| 前端框架 | React 18 + TypeScript 5.3 |
| 构建工具 | Vite 5 |
| 打包工具 | electron-builder |
| 测试框架 | Vitest |
| 图标库 | Lucide React |
| 安全通信 | SSH2 (SSH 隧道支持) |

## 项目架构

### 三层架构设计

```
┌─────────────────────────────────────────────────────────────┐
│              Renderer Process (React 渲染进程)                │
│  src/components/  →  window.electronAPI  →  IPC Channel     │
│  - ConnectionPanel (连接管理)                                 │
│  - CommandConsole (命令控制台)                                │
│  - KeyBrowser (Key 浏览器)                                    │
│  - StatusBar (状态栏)                                         │
└─────────────────────────────────────────────────────────────┘
                              ↓ IPC (进程间通信)
┌─────────────────────────────────────────────────────────────┐
│                 Main Process (Electron 主进程)                │
│  electron/ipc/redis-handler.ts  →  连接池管理                 │
│  electron/main.ts              →  窗口管理、系统托盘           │
│  electron/preload.ts           →  Context Isolation 桥接      │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    Core Protocol Layer (核心协议层)           │
│  core/redis-client.ts     →  Redis 客户端封装                 │
│  core/resp-parser.ts      →  流式 RESP 解析器                 │
│  core/resp-serializer.ts  →  命令序列化器                     │
│  core/ssh-tunnel.ts       →  SSH 隧道支持                     │
│  core/types.ts            →  类型定义                         │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                     Network Layer (网络层)                    │
│  Node.js net.Socket  →  TCP 通信                             │
│  Node.js tls          →  TLS 加密通信                        │
└─────────────────────────────────────────────────────────────┘
```

### 目录结构

```
redis-connector/
├── core/                      # 核心协议层（独立模块）
│   ├── index.ts              # 模块导出入口
│   ├── types.ts              # 类型定义（RespValue, RedisConnectionConfig 等）
│   ├── resp-parser.ts        # RESP2 流式解析器
│   ├── resp-serializer.ts    # 命令序列化器
│   ├── redis-client.ts       # Redis 客户端封装
│   └── ssh-tunnel.ts         # SSH 隧道支持
├── electron/                  # Electron 主进程代码
│   ├── main.ts               # 应用入口，窗口管理
│   ├── preload.ts            # 预加载脚本（Context Isolation）
│   └── ipc/
│       └── redis-handler.ts  # Redis IPC 处理器，连接池管理
├── src/                       # 渲染进程（React 应用）
│   ├── App.tsx               # 主应用组件
│   ├── main.tsx              # React 入口
│   ├── components/           # UI 组件（19 个组件）
│   │   ├── ConnectionPanel.tsx      # 连接面板
│   │   ├── CommandConsole.tsx       # 命令控制台
│   │   ├── KeyBrowser.tsx            # Key 浏览器
│   │   ├── TitleBar.tsx              # 自定义标题栏
│   │   ├── StatusBar.tsx             # 状态栏
│   │   ├── ConnectionModal.tsx       # 连接配置弹窗
│   │   ├── NewKeyModal.tsx           # 新建 Key 弹窗
│   │   ├── ServerInfoModal.tsx       # 服务器信息弹窗
│   │   ├── SettingsButton.tsx        # 设置按钮（导入/导出）
│   │   ├── ShortcutsModal.tsx        # 快捷键帮助
│   │   ├── Toast.tsx                 # 通知组件
│   │   └── ...                       # 其他辅助组件
│   ├── contexts/
│   │   └── SettingsContext.tsx       # 设置上下文（多语言支持）
│   ├── stores/                       # 状态管理（预留）
│   └── styles/
│       ├── app.css                   # 应用样式
│       └── global.css                # 全局样式
├── tests/                    # 测试用例
│   ├── resp-parser.test.ts          # RESP 解析器测试
│   └── resp-serializer.test.ts      # 序列化器测试
├── public/                   # 静态资源
│   └── icon.png              # 应用图标
├── build/                    # 构建资源
│   └── icon.png              # 打包图标
├── .github/
│   └── workflows/
│       └── build.yml         # GitHub Actions 构建配置
├── package.json              # 项目配置
├── vite.config.ts            # Vite 配置
├── tsconfig.json             # TypeScript 配置（前端）
├── tsconfig.node.json        # TypeScript 配置（Node.js/Electron）
├── vitest.config.ts          # Vitest 测试配置
├── README.md                 # 项目说明
├── DESIGN.md                 # 设计文档
└── CLAUDE.md                 # Claude 辅助说明
```

## 核心技术实现

### 1. RESP 协议实现

项目在 `core/resp-parser.ts` 中完整实现了 RESP2 协议的流式解析：

**RESP2 类型标识符**：
```
+  简单字符串  "+OK\r\n"
-  错误       "-ERR unknown command\r\n"
:  整数       ":1000\r\n"
$  批量字符串  "$5\r\nhello\r\n"  ($-1 表示 null)
*  数组       "*2\r\n$3\r\nfoo\r\n$3\r\nbar\r\n"
```

**流式解析设计**：
- 使用 `RespParser` 类维护内部缓冲区
- `tryParse()` 方法返回 `null` 表示数据不完整（TCP 分包场景）
- 遇到数据不完整时抛出内部 `IncompleteDataError`，回滚偏移量等待更多数据
- 解析流程：`数据到达 → 追加到缓冲区 → 尝试解析 → 成功返回 / 数据不完整回滚`

### 2. Redis 客户端

`core/redis-client.ts` 实现了完整的 Redis 客户端功能：

**核心特性**：
- 基于 Node.js `net.Socket` 的 TCP 通信
- 支持 TLS 加密连接
- 支持密码认证和数据库选择
- 支持命令超时控制
- Pipeline 批量命令执行
- 连接状态管理（disconnected/connecting/connected/error）
- 自动重连机制（最多 3 次）

**关键方法**：
- `connect()`: 连接到 Redis 服务器
- `sendCommand()`: 发送命令并等待响应
- `execute()`: 执行命令并返回简化结果
- `pipeline()`: 批量执行命令
- `ping()`, `get()`, `set()`, `del()`, `keys()`, `scan()` 等常用命令快捷方法

### 3. SSH 隧道支持

`core/ssh-tunnel.ts` 使用 `ssh2` 库实现 SSH 隧道：
- 支持密码认证和私钥认证
- 支持通过 SSH 跳板机连接到内网 Redis

### 4. Electron IPC 架构

**主进程** (`electron/ipc/redis-handler.ts`)：
- 管理连接池（`Map<connectionId, ConnectionInfo>`）
- 提供 IPC 通道：`redis:connect`, `redis:disconnect`, `redis:execute`, `redis:pipeline` 等
- 配置持久化到 `userData/connections.json`（不存储密码）

**渲染进程**：
- 通过 `window.electronAPI` 调用主进程（Context Isolation）
- 预加载脚本 `electron/preload.ts` 提供类型安全的 API

### 5. React 组件架构

**状态管理**：
- 当前使用 `useState` + props drilling
- 考虑到应用规模较小，暂未引入状态管理库
- 技术债：如果功能复杂化，考虑引入 Zustand 或 Jotai

**主要组件**：
- `ConnectionPanel`: 连接列表和管理
- `CommandConsole`: 命令执行和历史记录
- `KeyBrowser`: Key 浏览和操作
- `TitleBar`: 自定义无边框标题栏
- `StatusBar`: 连接状态显示

## 构建和运行

### 环境要求
- Node.js >= 18
- npm >= 8

### 常用命令

```bash
# 安装依赖
npm install

# 开发模式 - 仅 Web UI（用于纯前端开发）
npm run dev
# 访问 http://localhost:5173

# 开发模式 - 完整 Electron 应用
npm run electron:dev

# 构建 Web 应用
npm run build

# 构建 Electron 应用
npm run electron:build
# 输出目录: release/

# 运行测试
npm test

# 运行测试（带覆盖率）
npm run test:coverage
```

### 路径别名
```typescript
// tsconfig.json & vite.config.ts
"@/*"     → "src/*"
"@core/*" → "core/*"
```

## 开发规范

### 代码风格
- TypeScript 严格模式启用
- React 函数式组件 + Hooks
- 使用 Lucide React 图标库
- 组件与样式分离（`.css` 文件）
- 命名规范：组件 PascalCase，文件 kebab-case

### 测试规范
- 使用 Vitest 进行单元测试
- 测试文件命名：`*.test.ts`
- 测试核心协议层（RESP 解析器、序列化器）

### 安全设计
- Electron 启用 `contextIsolation: true`, `nodeIntegration: false`
- 密码不持久化到配置文件
- 阻止新窗口创建（`setWindowOpenHandler`）
- Content-Security-Policy 头

### 技术决策记录

**1. 为什么自研 RESP 协议而非使用 ioredis/redis？**
- 学习价值：深入理解 Redis 通信协议
- 包体积：避免引入重型依赖
- 可控性：完全控制协议实现

**2. 为什么选择 Electron 而非 Tauri？**
- 需要原生 Node.js 的 `net` 模块实现 TCP 通信
- Electron 生态更成熟，开发效率更高
- Tauri 需要额外桥接 Node.js API

**3. 为什么不使用状态管理库？**
- 应用规模较小，状态层级不深
- 避免引入额外依赖
- 预留技术债，后续可根据复杂度引入 Zustand 或 Jotai

## 常见任务

### 添加新的 Redis 命令
在 `core/redis-client.ts` 中添加快捷方法：
```typescript
async yourCommand(arg1: string, arg2: string): Promise<ReturnType> {
  const resp = await this.sendCommand(['YOURCOMMAND', arg1, arg2]);
  return respToJs(resp);
}
```

### 修改 UI 组件
- 组件位于 `src/components/`
- 样式文件与组件同名（`.css`）
- 使用 Lucide React 图标

### 测试 RESP 解析
```bash
# 运行 RESP 解析器测试
npx vitest tests/resp-parser.test.ts

# 监听模式
npx vitest --watch
```

### 构建发布包
```bash
npm run electron:build
# Windows 输出: release/Redis Connector Setup 1.0.0.exe
# Linux 输出: release/redis-connector-1.0.0.AppImage
```

## 待办事项 / 技术债

1. **状态管理**: 当前使用 useState + props drilling，复杂化后考虑引入 Zustand
2. **测试覆盖**: 扩展测试覆盖范围，特别是 UI 组件测试
3. **错误处理**: 增强错误处理和用户提示
4. **性能优化**: 大数据量场景下的性能优化
5. **文档完善**: 补充 API 文档和使用示例

## 贡献指南

1. 遵循现有代码风格和架构
2. 添加测试覆盖新功能
3. 更新相关文档（README.md、DESIGN.md、CLAUDE.md）
4. 确保通过 `npm test` 和 `npm run build`

## 许可证

MIT License

## 联系方式

- 作者: KK1181958464
- 邮箱: 1181958464@qq.com
- GitHub: https://github.com/kk1181958464/Redis-Connector