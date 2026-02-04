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

export class RespParseError extends Error {
  constructor(message: string, public offset?: number) {
    super(message);
    this.name = 'RespParseError';
  }
}

export class RespParser {
  private buffer: Buffer = Buffer.alloc(0);
  private offset: number = 0;

  /**
   * 向缓冲区追加数据
   */
  append(data: Buffer): void {
    this.buffer = Buffer.concat([this.buffer.subarray(this.offset), data]);
    this.offset = 0;
  }

  /**
   * 尝试解析一个完整的 RESP 值
   * 如果数据不完整，返回 null
   */
  tryParse(): RespValue | null {
    if (this.buffer.length - this.offset === 0) {
      return null;
    }

    const startOffset = this.offset;
    try {
      const result = this.parseValue();
      return result;
    } catch (e) {
      if (e instanceof IncompleteDataError) {
        this.offset = startOffset; // 回滚
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
          this.offset - 1
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
      throw new RespParseError(`Invalid integer: ${line}`, this.offset);
    }
    return { type: 'integer', value };
  }

  private parseBulkString(): RespValue {
    const lengthLine = this.readLine();
    const length = parseInt(lengthLine, 10);

    if (isNaN(length)) {
      throw new RespParseError(`Invalid bulk string length: ${lengthLine}`, this.offset);
    }

    // $-1 表示 null
    if (length === -1) {
      return { type: 'bulk_string', value: null };
    }

    if (length < 0) {
      throw new RespParseError(`Invalid bulk string length: ${length}`, this.offset);
    }

    // 检查是否有足够的数据
    if (this.buffer.length - this.offset < length + CRLF_LENGTH) {
      throw new IncompleteDataError();
    }

    const value = this.buffer.subarray(this.offset, this.offset + length).toString('utf8');
    this.offset += length;

    // 跳过 CRLF
    this.expectCRLF();

    return { type: 'bulk_string', value };
  }

  private parseArray(): RespValue {
    const lengthLine = this.readLine();
    const length = parseInt(lengthLine, 10);

    if (isNaN(length)) {
      throw new RespParseError(`Invalid array length: ${lengthLine}`, this.offset);
    }

    // *-1 表示 null 数组
    if (length === -1) {
      return { type: 'array', value: null };
    }

    if (length < 0) {
      throw new RespParseError(`Invalid array length: ${length}`, this.offset);
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
    if (this.offset >= this.buffer.length) {
      throw new IncompleteDataError();
    }
    return this.buffer[this.offset++];
  }

  /**
   * 读取一行（直到 CRLF）
   */
  private readLine(): string {
    const start = this.offset;
    let end = start;

    while (end < this.buffer.length - 1) {
      if (this.buffer[end] === 0x0d && this.buffer[end + 1] === 0x0a) {
        const line = this.buffer.subarray(start, end).toString('utf8');
        this.offset = end + CRLF_LENGTH;
        return line;
      }
      end++;
    }

    throw new IncompleteDataError();
  }

  /**
   * 期望读取 CRLF
   */
  private expectCRLF(): void {
    if (this.offset + CRLF_LENGTH > this.buffer.length) {
      throw new IncompleteDataError();
    }

    if (this.buffer[this.offset] !== 0x0d || this.buffer[this.offset + 1] !== 0x0a) {
      throw new RespParseError(
        `Expected CRLF, got: ${this.buffer.subarray(this.offset, this.offset + 2).toString('hex')}`,
        this.offset
      );
    }

    this.offset += CRLF_LENGTH;
  }

  /**
   * 清空缓冲区
   */
  reset(): void {
    this.buffer = Buffer.alloc(0);
    this.offset = 0;
  }

  /**
   * 获取剩余未解析的数据长度
   */
  get remainingLength(): number {
    return this.buffer.length - this.offset;
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
