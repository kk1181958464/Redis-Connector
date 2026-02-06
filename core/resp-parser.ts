/**
 * RESP 协议解析器
 * 将 Redis 服务器返回的字节流解析为结构化数据
 */

import {
  RESP_TYPES,
  RespValue,
  RespTypeChar,
  ParseResult
} from './types';

const CRLF = '\r\n';
const CRLF_LENGTH = 2;
const CRLF_BUFFER = Buffer.from('\r\n');

// 预分配缓冲区大小（64KB，可自动扩展）
const INITIAL_BUFFER_SIZE = 64 * 1024;
// 缓冲区压缩阈值（当已消费数据超过此比例时压缩）
const COMPACT_THRESHOLD = 0.5;

export class RespParseError extends Error {
  constructor(message: string, public offset?: number) {
    super(message);
    this.name = 'RespParseError';
  }
}

export class RespParser {
  private buffer: Buffer;
  private writeOffset: number = 0;  // 写入位置
  private readOffset: number = 0;   // 读取位置

  constructor() {
    // 预分配缓冲区，避免频繁内存分配
    this.buffer = Buffer.allocUnsafe(INITIAL_BUFFER_SIZE);
  }

  /**
   * 向缓冲区追加数据（优化版：避免频繁拷贝）
   */
  append(data: Buffer): void {
    const dataLength = data.length;
    const remainingSpace = this.buffer.length - this.writeOffset;
    const usedSpace = this.writeOffset - this.readOffset;

    // 检查是否需要压缩或扩展缓冲区
    if (dataLength > remainingSpace) {
      // 先尝试压缩（移动未读数据到缓冲区开头）
      if (this.readOffset > this.buffer.length * COMPACT_THRESHOLD) {
        this.buffer.copy(this.buffer, 0, this.readOffset, this.writeOffset);
        this.writeOffset = usedSpace;
        this.readOffset = 0;
      }

      // 如果压缩后仍然不够，扩展缓冲区
      const newRemainingSpace = this.buffer.length - this.writeOffset;
      if (dataLength > newRemainingSpace) {
        const newSize = Math.max(
          this.buffer.length * 2,
          usedSpace + dataLength + INITIAL_BUFFER_SIZE
        );
        const newBuffer = Buffer.allocUnsafe(newSize);
        this.buffer.copy(newBuffer, 0, this.readOffset, this.writeOffset);
        this.buffer = newBuffer;
        this.writeOffset = usedSpace;
        this.readOffset = 0;
      }
    }

    // 写入新数据
    data.copy(this.buffer, this.writeOffset);
    this.writeOffset += dataLength;
  }

  /**
   * 尝试解析一个完整的 RESP 值
   * 如果数据不完整，返回 null
   */
  tryParse(): RespValue | null {
    if (this.writeOffset - this.readOffset === 0) {
      return null;
    }

    const startOffset = this.readOffset;
    try {
      const result = this.parseValue();
      return result;
    } catch (e) {
      if (e instanceof IncompleteDataError) {
        this.readOffset = startOffset; // 回滚
        return null;
      }
      throw e;
    }
  }

  /**
   * 解析单个 RESP 值（内部方法）
   */
  private parseValue(): RespValue {
    const typeChar = this.readByte();
    const typeStr = String.fromCharCode(typeChar);

    switch (typeStr) {
      case RESP_TYPES.SIMPLE_STRING:
        return this.parseSimpleString();
      case RESP_TYPES.ERROR:
        return this.parseError();
      case RESP_TYPES.INTEGER:
        return this.parseInteger();
      case RESP_TYPES.BULK_STRING:
        return this.parseBulkString();
      case RESP_TYPES.ARRAY:
        return this.parseArray();
      default:
        throw new RespParseError(
          `Unknown RESP type: ${typeStr}`,
          this.readOffset - 1
        );
    }
  }

  private parseSimpleString(): RespValue {
    const line = this.readLine();
    return { type: 'simple_string', value: line };
  }

  private parseError(): RespValue {
    const line = this.readLine();
    return { type: 'error', value: line };
  }

  private parseInteger(): RespValue {
    const line = this.readLine();
    const value = parseInt(line, 10);
    if (isNaN(value)) {
      throw new RespParseError(`Invalid integer: ${line}`, this.readOffset);
    }
    return { type: 'integer', value };
  }

  private parseBulkString(): RespValue {
    const lengthLine = this.readLine();
    const length = parseInt(lengthLine, 10);

    if (isNaN(length)) {
      throw new RespParseError(`Invalid bulk string length: ${lengthLine}`, this.readOffset);
    }

    // $-1 表示 null
    if (length === -1) {
      return { type: 'bulk_string', value: null };
    }

    if (length < 0) {
      throw new RespParseError(`Invalid bulk string length: ${length}`, this.readOffset);
    }

    // 检查是否有足够的数据
    if (this.writeOffset - this.readOffset < length + CRLF_LENGTH) {
      throw new IncompleteDataError();
    }

    const value = this.buffer.subarray(this.readOffset, this.readOffset + length).toString('utf8');
    this.readOffset += length;

    // 跳过 CRLF
    this.expectCRLF();

    return { type: 'bulk_string', value };
  }

  private parseArray(): RespValue {
    const lengthLine = this.readLine();
    const length = parseInt(lengthLine, 10);

    if (isNaN(length)) {
      throw new RespParseError(`Invalid array length: ${lengthLine}`, this.readOffset);
    }

    // *-1 表示 null 数组
    if (length === -1) {
      return { type: 'array', value: null };
    }

    if (length < 0) {
      throw new RespParseError(`Invalid array length: ${length}`, this.readOffset);
    }

    const elements: RespValue[] = [];
    for (let i = 0; i < length; i++) {
      elements.push(this.parseValue());
    }

    return { type: 'array', value: elements };
  }

  /**
   * 读取一个字节
   */
  private readByte(): number {
    if (this.readOffset >= this.writeOffset) {
      throw new IncompleteDataError();
    }
    return this.buffer[this.readOffset++];
  }

  /**
   * 读取一行（直到 CRLF）- 使用 indexOf 优化
   */
  private readLine(): string {
    const start = this.readOffset;
    // 使用 Buffer.indexOf 替代手动循环，性能更好
    const crlfIndex = this.buffer.indexOf(CRLF_BUFFER, start);

    if (crlfIndex === -1 || crlfIndex >= this.writeOffset) {
      throw new IncompleteDataError();
    }

    const line = this.buffer.subarray(start, crlfIndex).toString('utf8');
    this.readOffset = crlfIndex + CRLF_LENGTH;
    return line;
  }

  /**
   * 期望读取 CRLF
   */
  private expectCRLF(): void {
    if (this.readOffset + CRLF_LENGTH > this.writeOffset) {
      throw new IncompleteDataError();
    }

    if (this.buffer[this.readOffset] !== 0x0d || this.buffer[this.readOffset + 1] !== 0x0a) {
      throw new RespParseError(
        `Expected CRLF, got: ${this.buffer.subarray(this.readOffset, this.readOffset + 2).toString('hex')}`,
        this.readOffset
      );
    }

    this.readOffset += CRLF_LENGTH;
  }

  /**
   * 清空缓冲区
   */
  reset(): void {
    this.readOffset = 0;
    this.writeOffset = 0;
  }

  /**
   * 获取剩余未解析的数据长度
   */
  get remainingLength(): number {
    return this.writeOffset - this.readOffset;
  }
}

/**
 * 数据不完整异常（内部使用）
 */
class IncompleteDataError extends Error {
  constructor() {
    super('Incomplete data');
    this.name = 'IncompleteDataError';
  }
}

/**
 * 将 RespValue 转换为简化的 JavaScript 值
 */
export function respToJs(resp: RespValue): any {
  switch (resp.type) {
    case 'simple_string':
    case 'bulk_string':
      return resp.value;
    case 'integer':
      return resp.value;
    case 'error':
      throw new Error(resp.value);
    case 'array':
      if (resp.value === null) return null;
      return resp.value.map(respToJs);
  }
}
