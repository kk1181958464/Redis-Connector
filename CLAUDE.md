# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Redis Connector 是一个基于 Electron + React + TypeScript 的 Redis GUI 客户端，核心特点是**自研 RESP 协议解析层**（非依赖 ioredis 等现有库）。

## 常用命令

```bash
# 安装依赖
npm install

# 开发模式 - 仅 Web UI（用于纯前端开发）
npm run dev

# 开发模式 - 完整 Electron 应用
npm run electron:dev

# 构建发布包
npm run electron:build

# 运行测试
npm test

# 运行测试（带覆盖率）
npm run test:coverage
```

## 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                    Renderer Process (React)                  │
│  src/components/  →  window.electronAPI  →  IPC Channel     │
└─────────────────────────────────────────────────────────────┘
                              ↓ IPC
┌─────────────────────────────────────────────────────────────┐
│                    Main Process (Electron)                   │
│  electron/ipc/redis-handler.ts  →  连接池管理               │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    Core Protocol Layer                       │
│  core/redis-client.ts  →  TCP Socket (Node.js net)          │
│  core/resp-parser.ts   →  流式 RESP 解析                    │
│  core/resp-serializer.ts → 命令序列化                       │
│  core/ssh-tunnel.ts    →  SSH 隧道支持                      │
└─────────────────────────────────────────────────────────────┘
```

### 三层架构

1. **Core 协议层** (`core/`)
   - 自研 RESP2 协议解析器，支持流式解析（处理 TCP 分包）
   - `RespParser` 类维护内部缓冲区，`tryParse()` 返回 null 表示数据不完整
   - 类型定义在 `core/types.ts`，包含 `RespValue` 联合类型

2. **Electron 主进程** (`electron/`)
   - `redis-handler.ts` 管理连接池（`Map<connectionId, ConnectionInfo>`）
   - IPC 通道：`redis:connect`, `redis:execute`, `redis:pipeline` 等
   - 配置持久化到 `userData/connections.json`（不存储密码）

3. **React 渲染进程** (`src/`)
   - 通过 `window.electronAPI` 调用主进程（Context Isolation）
   - 组件：ConnectionPanel, CommandConsole, KeyBrowser, StatusBar

### 路径别名

```typescript
// tsconfig.json & vite.config.ts
"@/*"     → "src/*"
"@core/*" → "core/*"
```

## RESP 协议要点

```
+  简单字符串  "+OK\r\n"
-  错误       "-ERR unknown command\r\n"
:  整数       ":1000\r\n"
$  批量字符串  "$5\r\nhello\r\n"  ($-1 表示 null)
*  数组       "*2\r\n$3\r\nfoo\r\n$3\r\nbar\r\n"
```

解析器核心逻辑：遇到数据不完整时抛出内部 `IncompleteDataError`，回滚偏移量等待更多数据。

## 测试

使用 Vitest，测试文件在 `tests/` 目录：

```bash
# 运行单个测试文件
npx vitest tests/resp-parser.test.ts

# 监听模式
npx vitest --watch
```

## 安全设计

- Electron 启用 `contextIsolation: true`, `nodeIntegration: false`
- 密码不持久化到配置文件
- 阻止新窗口创建（`setWindowOpenHandler`）

## 技术债记录

- 状态管理使用 useState + props drilling，复杂化后考虑引入 Zustand
- 详见 `DESIGN.md`
