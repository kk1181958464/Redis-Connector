/**
 * RESP (REdis Serialization Protocol) 类型定义
 * 协议版本: RESP2 (兼容 Redis 2.0+)
 */

// RESP 数据类型标识符
export const RESP_TYPES = {
  SIMPLE_STRING: '+',  // 简单字符串
  ERROR: '-',          // 错误
  INTEGER: ':',        // 整数
  BULK_STRING: '$',    // 批量字符串
  ARRAY: '*',          // 数组
} as const;

export type RespTypeChar = typeof RESP_TYPES[keyof typeof RESP_TYPES];

// RESP 解析后的值类型
export type RespSimpleString = { type: 'simple_string'; value: string };
export type RespError = { type: 'error'; value: string };
export type RespInteger = { type: 'integer'; value: number };
export type RespBulkString = { type: 'bulk_string'; value: string | null };
export type RespArray = { type: 'array'; value: RespValue[] | null };

export type RespValue = 
  | RespSimpleString 
  | RespError 
  | RespInteger 
  | RespBulkString 
  | RespArray;

// 简化的 JavaScript 值类型（用于应用层）
export type RedisValue = string | number | null | RedisValue[];

// 连接配置
export interface RedisConnectionConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
  name?: string;           // 连接名称（用于 UI 显示）
  connectTimeout?: number; // 连接超时（毫秒）
  commandTimeout?: number; // 命令超时（毫秒）
  // TLS/SSL 配置
  tls?: {
    enabled: boolean;
    rejectUnauthorized?: boolean; // 是否验证服务器证书，默认 true
    ca?: string;                  // CA 证书内容
    cert?: string;                // 客户端证书内容
    key?: string;                 // 客户端私钥内容
  };
}

// 连接状态
export type ConnectionStatus = 
  | 'disconnected' 
  | 'connecting' 
  | 'connected' 
  | 'error';

// 命令执行结果
export interface CommandResult {
  success: boolean;
  data?: RedisValue;
  error?: string;
  duration: number; // 执行耗时（毫秒）
}

// Key 信息
export interface RedisKeyInfo {
  key: string;
  type: 'string' | 'list' | 'set' | 'zset' | 'hash' | 'stream' | 'unknown';
  ttl: number;      // -1 表示永不过期，-2 表示 key 不存在
  size?: number;    // 元素数量或字符串长度
}

// 解析器状态（用于流式解析）
export interface ParserState {
  buffer: Buffer;
  offset: number;
}

// 解析结果
export interface ParseResult<T> {
  value: T;
  bytesConsumed: number;
}
