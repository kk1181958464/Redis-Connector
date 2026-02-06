/**
 * Redis 客户端
 * 基于 TCP Socket 实现，自研 RESP 协议通信
 */

import * as net from 'net';
import * as tls from 'tls';
import { EventEmitter } from 'events';
import { RespParser, respToJs, RespParseError } from './resp-parser';
import { serializeCommand, parseCommandString } from './resp-serializer';
import {
  RedisConnectionConfig,
  ConnectionStatus,
  CommandResult,
  RespValue,
  RedisValue
} from './types';

// 默认配置
const DEFAULT_CONFIG: Partial<RedisConnectionConfig> = {
  port: 6379,
  host: '127.0.0.1',
  db: 0,
  connectTimeout: 5000,
  commandTimeout: 10000,
};

// 心跳检测间隔（毫秒）
const HEARTBEAT_INTERVAL = 30000;

// 命令回调
interface PendingCommand {
  resolve: (value: RespValue) => void;
  reject: (error: Error) => void;
  timer?: NodeJS.Timeout;
  cancelled?: boolean; // 标记命令是否已超时取消
}

export class RedisClient extends EventEmitter {
  private config: RedisConnectionConfig;
  private socket: net.Socket | null = null;
  private parser: RespParser;
  private status: ConnectionStatus = 'disconnected';
  private pendingCommands: PendingCommand[] = [];
  private pendingCommandsHead: number = 0; // 队列头指针，避免 shift() O(n) 操作
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 3;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(config: RedisConnectionConfig) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.parser = new RespParser();
  }

  /**
   * 获取当前连接状态
   */
  getStatus(): ConnectionStatus {
    return this.status;
  }

  /**
   * 获取连接配置
   */
  getConfig(): RedisConnectionConfig {
    return { ...this.config };
  }

  /**
   * 连接到 Redis 服务器
   */
  async connect(): Promise<void> {
    if (this.status === 'connected') {
      return;
    }

    this.setStatus('connecting');

    return new Promise((resolve, reject) => {
      const { host, port, connectTimeout, tls: tlsConfig } = this.config;

      // 连接超时
      const timer = setTimeout(() => {
        this.socket?.destroy();
        this.setStatus('error');
        reject(new Error(`Connection timeout after ${connectTimeout}ms`));
      }, connectTimeout);

      // 创建 socket（根据是否启用 TLS）
      if (tlsConfig?.enabled) {
        // TLS 连接
        const tlsOptions: tls.ConnectionOptions = {
          host: host!,
          port: port!,
          rejectUnauthorized: tlsConfig.rejectUnauthorized !== false,
        };

        // 添加证书配置
        if (tlsConfig.ca) {
          tlsOptions.ca = tlsConfig.ca;
        }
        if (tlsConfig.cert) {
          tlsOptions.cert = tlsConfig.cert;
        }
        if (tlsConfig.key) {
          tlsOptions.key = tlsConfig.key;
        }

        this.socket = tls.connect(tlsOptions, async () => {
          clearTimeout(timer);
          this.setupSocketListeners();

          try {
            // 认证
            if (this.config.password) {
              await this.sendCommand(['AUTH', this.config.password]);
            }

            // 选择数据库
            if (this.config.db && this.config.db > 0) {
              await this.sendCommand(['SELECT', String(this.config.db)]);
            }

            this.setStatus('connected');
            this.reconnectAttempts = 0;
            this.startHeartbeat();
            resolve();
          } catch (err) {
            this.setStatus('error');
            this.socket?.destroy();
            reject(err);
          }
        });

        // TLS 错误处理
        this.socket.once('error', (err) => {
          clearTimeout(timer);
          this.setStatus('error');
          reject(err);
        });
      } else {
        // 普通 TCP 连接
        this.socket = new net.Socket();

        // 连接成功
        this.socket.once('connect', async () => {
          clearTimeout(timer);
          this.setupSocketListeners();

          try {
            // 认证
            if (this.config.password) {
              await this.sendCommand(['AUTH', this.config.password]);
            }

            // 选择数据库
            if (this.config.db && this.config.db > 0) {
              await this.sendCommand(['SELECT', String(this.config.db)]);
            }

            this.setStatus('connected');
            this.reconnectAttempts = 0;
            this.startHeartbeat();
            resolve();
          } catch (err) {
            this.setStatus('error');
            this.socket?.destroy();
            reject(err);
          }
        });

        // 连接错误
        this.socket.once('error', (err) => {
          clearTimeout(timer);
          this.setStatus('error');
          reject(err);
        });

        // 发起连接
        this.socket.connect(port!, host!);
      }
    });
  }

  /**
   * 设置 socket 事件监听
   */
  private setupSocketListeners(): void {
    if (!this.socket) return;

    // 禁用 Nagle 算法，减少小数据包延迟（Redis 命令通常很小）
    this.socket.setNoDelay(true);

    // 启用 TCP KeepAlive，检测死连接
    this.socket.setKeepAlive(true, 10000);

    // 接收数据
    this.socket.on('data', (data: Buffer) => {
      this.parser.append(data);
      this.processResponses();
    });

    // 连接关闭
    this.socket.on('close', (hadError: boolean) => {
      this.stopHeartbeat();
      this.setStatus('disconnected');
      this.rejectAllPending(new Error('Connection closed'));
      this.emit('close', hadError);
    });

    // 错误处理
    this.socket.on('error', (err: Error) => {
      this.stopHeartbeat();
      this.setStatus('disconnected');
      this.emit('error', err);
    });

    // 连接超时（空闲超时）
    this.socket.on('timeout', () => {
      this.stopHeartbeat();
      this.setStatus('disconnected');
      this.socket?.destroy();
      this.emit('error', new Error('Connection timeout (idle)'));
    });
  }

  /**
   * 处理响应队列（使用索引指针，O(1) 出队）
   */
  private processResponses(): void {
    let response: RespValue | null;

    while ((response = this.parser.tryParse()) !== null) {
      // 跳过已取消的命令（超时）
      while (this.pendingCommands[this.pendingCommandsHead]?.cancelled) {
        this.pendingCommands[this.pendingCommandsHead] = undefined as any;
        this.pendingCommandsHead++;
      }

      const pending = this.pendingCommands[this.pendingCommandsHead];

      if (pending) {
        // 移动头指针（O(1) 操作，替代 shift() 的 O(n)）
        this.pendingCommands[this.pendingCommandsHead] = undefined as any;
        this.pendingCommandsHead++;

        // 定期压缩数组，避免内存无限增长（当已处理超过 1000 个命令时）
        if (this.pendingCommandsHead > 1000) {
          this.pendingCommands = this.pendingCommands.slice(this.pendingCommandsHead);
          this.pendingCommandsHead = 0;
        }

        if (pending.timer) {
          clearTimeout(pending.timer);
        }
        pending.resolve(response);
      } else {
        // 收到未预期的响应（可能是 Pub/Sub 消息）
        this.emit('message', response);
      }
    }
  }

  /**
   * 发送命令并等待响应
   */
  async sendCommand(args: (string | number)[]): Promise<RespValue> {
    if (!this.socket || this.status !== 'connected' && this.status !== 'connecting') {
      throw new Error('Not connected to Redis server');
    }

    return new Promise((resolve, reject) => {
      const pending: PendingCommand = { resolve, reject };

      // 命令超时（使用 cancelled 标志，避免 splice 破坏队列顺序）
      if (this.config.commandTimeout) {
        pending.timer = setTimeout(() => {
          pending.cancelled = true;
          reject(new Error(`Command timeout after ${this.config.commandTimeout}ms`));
        }, this.config.commandTimeout);
      }

      this.pendingCommands.push(pending);

      // 序列化并发送
      const buffer = serializeCommand(args.map(String));
      this.socket!.write(buffer);
    });
  }

  /**
   * 执行命令并返回简化结果
   */
  async execute(command: string): Promise<CommandResult>;
  async execute(args: string[]): Promise<CommandResult>;
  async execute(input: string | string[]): Promise<CommandResult> {
    const startTime = Date.now();
    const args = typeof input === 'string' ? parseCommandString(input) : input;

    try {
      const resp = await this.sendCommand(args);
      const data = respToJs(resp);
      
      return {
        success: true,
        data,
        duration: Date.now() - startTime,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * 常用命令快捷方法
   */
  async ping(): Promise<string> {
    const resp = await this.sendCommand(['PING']);
    return respToJs(resp);
  }

  async get(key: string): Promise<string | null> {
    const resp = await this.sendCommand(['GET', key]);
    return respToJs(resp);
  }

  async set(key: string, value: string, options?: { ex?: number; px?: number; nx?: boolean; xx?: boolean }): Promise<string | null> {
    const args: (string | number)[] = ['SET', key, value];
    
    if (options?.ex) args.push('EX', options.ex);
    if (options?.px) args.push('PX', options.px);
    if (options?.nx) args.push('NX');
    if (options?.xx) args.push('XX');

    const resp = await this.sendCommand(args);
    return respToJs(resp);
  }

  async del(...keys: string[]): Promise<number> {
    const resp = await this.sendCommand(['DEL', ...keys]);
    return respToJs(resp);
  }

  async keys(pattern: string): Promise<string[]> {
    const resp = await this.sendCommand(['KEYS', pattern]);
    return respToJs(resp);
  }

  async scan(cursor: number, options?: { match?: string; count?: number; type?: string }): Promise<[string, string[]]> {
    const args: (string | number)[] = ['SCAN', cursor];
    
    if (options?.match) args.push('MATCH', options.match);
    if (options?.count) args.push('COUNT', options.count);
    if (options?.type) args.push('TYPE', options.type);

    const resp = await this.sendCommand(args);
    return respToJs(resp);
  }

  async type(key: string): Promise<string> {
    const resp = await this.sendCommand(['TYPE', key]);
    return respToJs(resp);
  }

  async ttl(key: string): Promise<number> {
    const resp = await this.sendCommand(['TTL', key]);
    return respToJs(resp);
  }

  async info(section?: string): Promise<string> {
    const args = section ? ['INFO', section] : ['INFO'];
    const resp = await this.sendCommand(args);
    return respToJs(resp);
  }

  async dbsize(): Promise<number> {
    const resp = await this.sendCommand(['DBSIZE']);
    return respToJs(resp);
  }

  async flushdb(): Promise<string> {
    const resp = await this.sendCommand(['FLUSHDB']);
    return respToJs(resp);
  }

  /**
   * Pipeline 批量执行命令
   * 将多个命令一次性发送，减少网络往返
   */
  async pipeline(commands: (string | string[])[]): Promise<CommandResult[]> {
    if (!this.socket || this.status !== 'connected') {
      throw new Error('Not connected to Redis server');
    }

    const startTime = Date.now();
    const parsedCommands = commands.map(cmd =>
      typeof cmd === 'string' ? parseCommandString(cmd) : cmd
    );

    // 序列化所有命令到一个 buffer
    const buffers = parsedCommands.map(args => serializeCommand(args));
    const combinedBuffer = Buffer.concat(buffers);

    // 创建所有命令的 Promise
    const promises: Promise<RespValue>[] = parsedCommands.map(() => {
      return new Promise((resolve, reject) => {
        const pending: PendingCommand = { resolve, reject };

        // 命令超时（使用 cancelled 标志，避免 splice 破坏队列顺序）
        if (this.config.commandTimeout) {
          pending.timer = setTimeout(() => {
            pending.cancelled = true;
            reject(new Error(`Command timeout after ${this.config.commandTimeout}ms`));
          }, this.config.commandTimeout);
        }

        this.pendingCommands.push(pending);
      });
    });

    // 一次性发送所有命令
    this.socket.write(combinedBuffer);

    // 等待所有响应
    const results: CommandResult[] = [];
    const responses = await Promise.allSettled(promises);

    for (const response of responses) {
      if (response.status === 'fulfilled') {
        results.push({
          success: true,
          data: respToJs(response.value),
          duration: Date.now() - startTime,
        });
      } else {
        results.push({
          success: false,
          error: response.reason?.message || 'Unknown error',
          duration: Date.now() - startTime,
        });
      }
    }

    return results;
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    this.stopHeartbeat();
    if (this.socket) {
      this.rejectAllPending(new Error('Client disconnecting'));

      return new Promise((resolve) => {
        this.socket!.once('close', () => {
          this.socket = null;
          this.parser.reset();
          resolve();
        });
        this.socket!.end();
      });
    }
  }

  /**
   * 强制关闭连接
   */
  destroy(): void {
    this.stopHeartbeat();
    if (this.socket) {
      this.rejectAllPending(new Error('Client destroyed'));
      this.socket.destroy();
      this.socket = null;
      this.parser.reset();
      this.setStatus('disconnected');
    }
  }

  /**
   * 启动心跳检测
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(async () => {
      if (this.status !== 'connected') {
        this.stopHeartbeat();
        return;
      }

      try {
        await this.ping();
      } catch (err) {
        // PING 失败，连接可能已断开
        console.error('Heartbeat failed:', err);
        this.stopHeartbeat();
        this.setStatus('disconnected');
        this.socket?.destroy();
      }
    }, HEARTBEAT_INTERVAL);
  }

  /**
   * 停止心跳检测
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 设置状态并触发事件
   */
  private setStatus(status: ConnectionStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.emit('status', status);
    }
  }

  /**
   * 拒绝所有待处理的命令
   */
  private rejectAllPending(error: Error): void {
    // 从头指针开始遍历，拒绝所有待处理命令
    for (let i = this.pendingCommandsHead; i < this.pendingCommands.length; i++) {
      const pending = this.pendingCommands[i];
      if (pending) {
        if (pending.timer) {
          clearTimeout(pending.timer);
        }
        pending.reject(error);
      }
    }
    // 重置队列
    this.pendingCommands = [];
    this.pendingCommandsHead = 0;
  }
}

/**
 * 创建 Redis 客户端的便捷方法
 */
export function createClient(config: RedisConnectionConfig): RedisClient {
  return new RedisClient(config);
}
