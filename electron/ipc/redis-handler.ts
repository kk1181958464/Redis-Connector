/**
 * Redis IPC 处理器
 * 处理渲染进程与主进程之间的 Redis 操作通信
 */

import { ipcMain, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { app } from 'electron';
import { RedisClient, RedisConnectionConfig, SSHTunnel, SSHConfig } from '../../core';

// 加密密钥（基于机器标识生成，每台机器不同）
const ENCRYPTION_KEY = crypto.createHash('sha256')
  .update(app.getPath('userData') + 'redis-connector-secret')
  .digest();

// 加密敏感数据
function encrypt(text: string): string {
  if (!text) return '';
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

// 解密敏感数据
function decrypt(encryptedText: string): string {
  if (!encryptedText || !encryptedText.includes(':')) return encryptedText;
  try {
    const [ivHex, encrypted] = encryptedText.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return encryptedText;
  }
}

// 连接信息
interface ConnectionInfo {
  client: RedisClient;
  tunnel?: SSHTunnel;
}

// 连接池：管理多个 Redis 连接
const connections = new Map<string, ConnectionInfo>();

// 生成连接 ID
function generateConnectionId(): string {
  return `conn_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// 获取配置文件路径
function getConfigPath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'connections.json');
}

// 向所有窗口广播事件
function broadcast(channel: string, ...args: any[]): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send(channel, ...args);
  });
}

// 扩展的连接配置（包含 SSH 和 TLS）
interface ExtendedConnectionConfig extends RedisConnectionConfig {
  useSSH?: boolean;
  ssh?: SSHConfig;
  // TLS 配置（从前端传入）
  tls?: {
    enabled: boolean;
    rejectUnauthorized?: boolean;
    ca?: string;
    cert?: string;
    key?: string;
  };
}

export function setupRedisHandlers(): void {
  // 连接到 Redis
  ipcMain.handle('redis:connect', async (_event, config: ExtendedConnectionConfig) => {
    const connectionId = generateConnectionId();
    let tunnel: SSHTunnel | undefined;
    let redisConfig: RedisConnectionConfig = {
      host: config.host,
      port: config.port,
      password: config.password,
      db: config.db,
      name: config.name,
      // TLS 配置
      tls: config.tls?.enabled ? {
        enabled: true,
        rejectUnauthorized: config.tls.rejectUnauthorized,
        ca: config.tls.ca,
        cert: config.tls.cert,
        key: config.tls.key,
      } : undefined,
    };

    try {
      // 如果使用 SSH 隧道
      if (config.useSSH && config.ssh) {
        tunnel = new SSHTunnel({
          ssh: config.ssh,
          remoteHost: config.host || '127.0.0.1',
          remotePort: config.port || 6379,
        });

        // 监听隧道事件
        tunnel.on('error', (err) => {
          broadcast('redis:error', connectionId, `SSH Tunnel Error: ${err.message}`);
        });

        tunnel.on('close', () => {
          broadcast('redis:status', connectionId, 'disconnected');
        });

        // 建立 SSH 隧道
        const tunnelInfo = await tunnel.connect();

        // 通过本地隧道端口连接 Redis
        redisConfig.host = tunnelInfo.localHost;
        redisConfig.port = tunnelInfo.localPort;
      }

      // 创建 Redis 客户端
      const client = new RedisClient(redisConfig);

      // 监听状态变化
      client.on('status', (status) => {
        broadcast('redis:status', connectionId, status);
      });

      client.on('error', (error) => {
        broadcast('redis:error', connectionId, error.message);
      });

      // 连接 Redis
      await client.connect();

      connections.set(connectionId, { client, tunnel });

      return {
        success: true,
        connectionId,
        config: {
          ...config,
          // 返回原始配置（非隧道端口）
          host: config.host,
          port: config.port,
        },
      };
    } catch (error) {
      // 清理失败的连接
      if (tunnel) {
        await tunnel.close();
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // 测试连接（不保存到连接池）
  ipcMain.handle('redis:test', async (_event, config: ExtendedConnectionConfig) => {
    let tunnel: SSHTunnel | undefined;
    let client: RedisClient | undefined;
    let redisConfig: RedisConnectionConfig = {
      host: config.host,
      port: config.port,
      password: config.password,
      db: config.db,
      name: config.name,
      connectTimeout: 5000, // 测试连接使用较短超时
      // TLS 配置
      tls: config.tls?.enabled ? {
        enabled: true,
        rejectUnauthorized: config.tls.rejectUnauthorized,
        ca: config.tls.ca,
        cert: config.tls.cert,
        key: config.tls.key,
      } : undefined,
    };

    try {
      // 如果使用 SSH 隧道
      if (config.useSSH && config.ssh) {
        tunnel = new SSHTunnel({
          ssh: config.ssh,
          remoteHost: config.host || '127.0.0.1',
          remotePort: config.port || 6379,
        });

        // 建立 SSH 隧道
        const tunnelInfo = await tunnel.connect();

        // 通过本地隧道端口连接 Redis
        redisConfig.host = tunnelInfo.localHost;
        redisConfig.port = tunnelInfo.localPort;
      }

      // 创建 Redis 客户端
      client = new RedisClient(redisConfig);

      // 连接 Redis
      await client.connect();

      // 执行 PING 测试
      const pingResult = await client.execute('PING');

      // 获取服务器信息
      const infoResult = await client.execute('INFO server');
      let version = 'unknown';
      if (infoResult.success && typeof infoResult.data === 'string') {
        const versionMatch = infoResult.data.match(/redis_version:([^\r\n]+)/);
        if (versionMatch) {
          version = versionMatch[1];
        }
      }

      // 断开连接
      await client.disconnect();
      if (tunnel) {
        await tunnel.close();
      }

      return {
        success: pingResult.success,
        version,
        message: pingResult.success ? 'Connection successful' : 'PING failed',
      };
    } catch (error) {
      // 清理
      if (client) {
        try { await client.disconnect(); } catch {}
      }
      if (tunnel) {
        try { await tunnel.close(); } catch {}
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // 断开连接
  ipcMain.handle('redis:disconnect', async (_event, connectionId: string) => {
    const connInfo = connections.get(connectionId);
    if (connInfo) {
      await connInfo.client.disconnect();
      if (connInfo.tunnel) {
        await connInfo.tunnel.close();
      }
      connections.delete(connectionId);
      return { success: true };
    }
    return { success: false, error: 'Connection not found' };
  });

  // 执行命令
  ipcMain.handle('redis:execute', async (_event, connectionId: string, command: string) => {
    const connInfo = connections.get(connectionId);
    if (!connInfo) {
      return { success: false, error: 'Connection not found' };
    }

    return await connInfo.client.execute(command);
  });

  // Pipeline 批量执行命令
  ipcMain.handle('redis:pipeline', async (_event, connectionId: string, commands: string[]) => {
    const connInfo = connections.get(connectionId);
    if (!connInfo) {
      return { success: false, error: 'Connection not found' };
    }

    try {
      const results = await connInfo.client.pipeline(commands);
      return { success: true, results };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 获取连接状态
  ipcMain.handle('redis:getStatus', (_event, connectionId: string) => {
    const connInfo = connections.get(connectionId);
    if (!connInfo) {
      return 'disconnected';
    }
    return connInfo.client.getStatus();
  });

  // 列出所有连接
  ipcMain.handle('redis:listConnections', () => {
    const list: { id: string; config: RedisConnectionConfig; status: string }[] = [];
    connections.forEach((connInfo, id) => {
      list.push({
        id,
        config: connInfo.client.getConfig(),
        status: connInfo.client.getStatus(),
      });
    });
    return list;
  });

  // 保存连接配置
  ipcMain.handle('config:save', async (_event, configs: ExtendedConnectionConfig[]) => {
    try {
      const configPath = getConfigPath();
      // 加密敏感信息后保存
      const encryptedConfigs = configs.map((config) => ({
        ...config,
        password: config.password ? encrypt(config.password) : undefined,
        ssh: config.ssh ? {
          ...config.ssh,
          password: config.ssh.password ? encrypt(config.ssh.password) : undefined,
          privateKey: config.ssh.privateKey ? encrypt(config.ssh.privateKey) : undefined,
          passphrase: config.ssh.passphrase ? encrypt(config.ssh.passphrase) : undefined,
        } : undefined,
        _encrypted: true, // 标记已加密
      }));
      await fs.promises.writeFile(configPath, JSON.stringify(encryptedConfigs, null, 2));
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 加载连接配置
  ipcMain.handle('config:load', async () => {
    try {
      const configPath = getConfigPath();
      if (fs.existsSync(configPath)) {
        const data = await fs.promises.readFile(configPath, 'utf-8');
        const configs = JSON.parse(data);
        // 解密敏感信息
        const decryptedConfigs = configs.map((config: any) => {
          if (!config._encrypted) return config; // 旧格式，未加密
          const { _encrypted, ...rest } = config;
          return {
            ...rest,
            password: rest.password ? decrypt(rest.password) : undefined,
            ssh: rest.ssh ? {
              ...rest.ssh,
              password: rest.ssh.password ? decrypt(rest.ssh.password) : undefined,
              privateKey: rest.ssh.privateKey ? decrypt(rest.ssh.privateKey) : undefined,
              passphrase: rest.ssh.passphrase ? decrypt(rest.ssh.passphrase) : undefined,
            } : undefined,
          };
        });
        return { success: true, configs: decryptedConfigs };
      }
      return { success: true, configs: [] };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 导出全部配置（设置 + 连接配置，用于跨设备迁移）
  ipcMain.handle('config:export', async () => {
    try {
      const configPath = getConfigPath();
      let connections: any[] = [];

      if (fs.existsSync(configPath)) {
        const data = await fs.promises.readFile(configPath, 'utf-8');
        const configs = JSON.parse(data);
        // 解密敏感信息后导出（明文，便于跨设备导入）
        connections = configs.map((config: any) => {
          if (!config._encrypted) return config;
          const { _encrypted, ...rest } = config;
          return {
            ...rest,
            password: rest.password ? decrypt(rest.password) : undefined,
            ssh: rest.ssh ? {
              ...rest.ssh,
              password: rest.ssh.password ? decrypt(rest.ssh.password) : undefined,
              privateKey: rest.ssh.privateKey ? decrypt(rest.ssh.privateKey) : undefined,
              passphrase: rest.ssh.passphrase ? decrypt(rest.ssh.passphrase) : undefined,
            } : undefined,
          };
        });
      }

      return {
        success: true,
        data: {
          version: 1,
          exportTime: new Date().toISOString(),
          connections,
        }
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 导入全部配置
  ipcMain.handle('config:import', async (_event, importData: { connections: any[] }) => {
    try {
      if (!importData || !Array.isArray(importData.connections)) {
        return { success: false, error: 'Invalid import data format' };
      }

      const configPath = getConfigPath();
      // 加密敏感信息后保存
      const encryptedConfigs = importData.connections.map((config) => ({
        ...config,
        password: config.password ? encrypt(config.password) : undefined,
        ssh: config.ssh ? {
          ...config.ssh,
          password: config.ssh.password ? encrypt(config.ssh.password) : undefined,
          privateKey: config.ssh.privateKey ? encrypt(config.ssh.privateKey) : undefined,
          passphrase: config.ssh.passphrase ? encrypt(config.ssh.passphrase) : undefined,
        } : undefined,
        _encrypted: true,
      }));

      await fs.promises.writeFile(configPath, JSON.stringify(encryptedConfigs, null, 2));
      return { success: true, count: encryptedConfigs.length };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

// 应用退出时清理所有连接
process.on('exit', () => {
  connections.forEach((connInfo) => {
    connInfo.client.destroy();
    if (connInfo.tunnel) {
      connInfo.tunnel.close();
    }
  });
});
