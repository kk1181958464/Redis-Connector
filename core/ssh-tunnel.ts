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
  private serverReady: boolean = false;
  private serverPort: number = 0;

  constructor(config: TunnelConfig) {
    super();
    this.config = config;
  }

  /**
   * 建立 SSH 隧道（优化版：并行初始化）
   */
  async connect(): Promise<TunnelInfo> {
    // 并行执行：SSH 连接 + 本地服务器创建
    const [serverPort] = await Promise.all([
      this.prepareLocalServer(),
      this.connectSSH(),
    ]);

    this.tunnelInfo = {
      localHost: '127.0.0.1',
      localPort: serverPort,
      remoteHost: this.config.remoteHost,
      remotePort: this.config.remotePort,
    };

    this.emit('ready', this.tunnelInfo);
    return this.tunnelInfo;
  }

  /**
   * 预创建本地 TCP 服务器（不等待 SSH）
   */
  private prepareLocalServer(): Promise<number> {
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

      // 监听本地端口（0 表示自动分配）
      const localPort = this.config.localPort || 0;
      this.server.listen(localPort, '127.0.0.1', () => {
        const address = this.server!.address() as net.AddressInfo;
        this.serverPort = address.port;
        this.serverReady = true;
        resolve(address.port);
      });
    });
  }

  /**
   * 建立 SSH 连接（优化算法配置）
   */
  private connectSSH(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.sshClient = new Client();

      // SSH 连接配置（性能优化）
      const sshConfig: ConnectConfig = {
        host: this.config.ssh.host,
        port: this.config.ssh.port,
        username: this.config.ssh.username,
        readyTimeout: 10000,
        // 性能优化：指定高效算法，减少协商时间
        algorithms: {
          kex: [
            'curve25519-sha256',
            'curve25519-sha256@libssh.org',
            'ecdh-sha2-nistp256',
            'ecdh-sha2-nistp384',
            'ecdh-sha2-nistp521',
            'diffie-hellman-group14-sha256',
            'diffie-hellman-group14-sha1',
          ],
          cipher: [
            'aes128-gcm@openssh.com',
            'aes256-gcm@openssh.com',
            'aes128-ctr',
            'aes192-ctr',
            'aes256-ctr',
          ],
          serverHostKey: [
            'ssh-ed25519',
            'ecdsa-sha2-nistp256',
            'ecdsa-sha2-nistp384',
            'ecdsa-sha2-nistp521',
            'rsa-sha2-512',
            'rsa-sha2-256',
            'ssh-rsa',
          ],
          hmac: [
            'hmac-sha2-256-etm@openssh.com',
            'hmac-sha2-512-etm@openssh.com',
            'hmac-sha2-256',
            'hmac-sha2-512',
            'hmac-sha1',
          ],
          // 禁用压缩，减少协商开销
          compress: ['none'],
        },
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
        resolve();
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
