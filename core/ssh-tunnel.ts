/**
 * SSH 隧道管理器
 * 通过 SSH 建立端口转发隧道，用于连接远程 Redis
 */

import { Client, ConnectConfig } from 'ssh2';
import * as net from 'net';
import { EventEmitter } from 'events';

export interface SSHConfig {
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'privateKey';
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

export interface TunnelConfig {
  // SSH 服务器配置
  ssh: SSHConfig;
  // 远程 Redis 地址（从 SSH 服务器视角）
  remoteHost: string;
  remotePort: number;
  // 本地监听端口（可选，不指定则自动分配）
  localPort?: number;
}

export interface TunnelInfo {
  localHost: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
}

export class SSHTunnel extends EventEmitter {
  private sshClient: Client | null = null;
  private server: net.Server | null = null;
  private config: TunnelConfig;
  private tunnelInfo: TunnelInfo | null = null;
  private isConnected: boolean = false;

  constructor(config: TunnelConfig) {
    super();
    this.config = config;
  }

  /**
   * 建立 SSH 隧道
   */
  async connect(): Promise<TunnelInfo> {
    return new Promise((resolve, reject) => {
      this.sshClient = new Client();

      // SSH 连接配置
      const sshConfig: ConnectConfig = {
        host: this.config.ssh.host,
        port: this.config.ssh.port,
        username: this.config.ssh.username,
        readyTimeout: 10000,
      };

      // 认证方式
      if (this.config.ssh.authType === 'password') {
        sshConfig.password = this.config.ssh.password;
      } else {
        sshConfig.privateKey = this.config.ssh.privateKey;
        if (this.config.ssh.passphrase) {
          sshConfig.passphrase = this.config.ssh.passphrase;
        }
      }

      // SSH 连接就绪
      this.sshClient.on('ready', () => {
        this.isConnected = true;
        this.createLocalServer()
          .then(resolve)
          .catch(reject);
      });

      // SSH 错误
      this.sshClient.on('error', (err) => {
        this.emit('error', err);
        reject(err);
      });

      // SSH 连接关闭
      this.sshClient.on('close', () => {
        this.isConnected = false;
        this.emit('close');
      });

      // 发起 SSH 连接
      this.sshClient.connect(sshConfig);
    });
  }

  /**
   * 创建本地 TCP 服务器，转发到远程
   */
  private createLocalServer(): Promise<TunnelInfo> {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((localSocket) => {
        if (!this.sshClient || !this.isConnected) {
          localSocket.destroy();
          return;
        }

        // 通过 SSH 建立到远程 Redis 的连接
        this.sshClient.forwardOut(
          '127.0.0.1',
          localSocket.localPort || 0,
          this.config.remoteHost,
          this.config.remotePort,
          (err, remoteSocket) => {
            if (err) {
              localSocket.destroy();
              this.emit('error', err);
              return;
            }

            // 双向管道
            localSocket.pipe(remoteSocket);
            remoteSocket.pipe(localSocket);

            localSocket.on('error', () => remoteSocket.destroy());
            remoteSocket.on('error', () => localSocket.destroy());
            localSocket.on('close', () => remoteSocket.destroy());
            remoteSocket.on('close', () => localSocket.destroy());
          }
        );
      });

      this.server.on('error', (err) => {
        reject(err);
      });

      // 监听本地端口
      const localPort = this.config.localPort || 0; // 0 表示自动分配
      this.server.listen(localPort, '127.0.0.1', () => {
        const address = this.server!.address() as net.AddressInfo;
        this.tunnelInfo = {
          localHost: '127.0.0.1',
          localPort: address.port,
          remoteHost: this.config.remoteHost,
          remotePort: this.config.remotePort,
        };
        this.emit('ready', this.tunnelInfo);
        resolve(this.tunnelInfo);
      });
    });
  }

  /**
   * 获取隧道信息
   */
  getTunnelInfo(): TunnelInfo | null {
    return this.tunnelInfo;
  }

  /**
   * 检查隧道是否连接
   */
  isActive(): boolean {
    return this.isConnected && this.server !== null;
  }

  /**
   * 关闭隧道
   */
  async close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null;
        });
      }

      if (this.sshClient) {
        this.sshClient.end();
        this.sshClient = null;
      }

      this.isConnected = false;
      this.tunnelInfo = null;
      resolve();
    });
  }
}

/**
 * 创建 SSH 隧道的便捷方法
 */
export function createTunnel(config: TunnelConfig): SSHTunnel {
  return new SSHTunnel(config);
}
