/**
 * RESP 解析器单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RespParser, respToJs, RespParseError } from '../core/resp-parser';

describe('RespParser', () => {
  let parser: RespParser;

  beforeEach(() => {
    parser = new RespParser();
  });

  describe('Simple String', () => {
    it('should parse simple string', () => {
      parser.append(Buffer.from('+OK\r\n'));
      const result = parser.tryParse();
      expect(result).toEqual({ type: 'simple_string', value: 'OK' });
    });

    it('should parse PONG', () => {
      parser.append(Buffer.from('+PONG\r\n'));
      const result = parser.tryParse();
      expect(result).toEqual({ type: 'simple_string', value: 'PONG' });
    });
  });

  describe('Error', () => {
    it('should parse error', () => {
      parser.append(Buffer.from('-ERR unknown command\r\n'));
      const result = parser.tryParse();
      expect(result).toEqual({ type: 'error', value: 'ERR unknown command' });
    });
  });

  describe('Integer', () => {
    it('should parse positive integer', () => {
      parser.append(Buffer.from(':1000\r\n'));
      const result = parser.tryParse();
      expect(result).toEqual({ type: 'integer', value: 1000 });
    });

    it('should parse negative integer', () => {
      parser.append(Buffer.from(':-1\r\n'));
      const result = parser.tryParse();
      expect(result).toEqual({ type: 'integer', value: -1 });
    });

    it('should parse zero', () => {
      parser.append(Buffer.from(':0\r\n'));
      const result = parser.tryParse();
      expect(result).toEqual({ type: 'integer', value: 0 });
    });
  });

  describe('Bulk String', () => {
    it('should parse bulk string', () => {
      parser.append(Buffer.from('$5\r\nhello\r\n'));
      const result = parser.tryParse();
      expect(result).toEqual({ type: 'bulk_string', value: 'hello' });
    });

    it('should parse empty bulk string', () => {
      parser.append(Buffer.from('$0\r\n\r\n'));
      const result = parser.tryParse();
      expect(result).toEqual({ type: 'bulk_string', value: '' });
    });

    it('should parse null bulk string', () => {
      parser.append(Buffer.from('$-1\r\n'));
      const result = parser.tryParse();
      expect(result).toEqual({ type: 'bulk_string', value: null });
    });

    it('should handle binary data', () => {
      parser.append(Buffer.from('$12\r\nhello\r\nworld\r\n'));
      const result = parser.tryParse();
      expect(result).toEqual({ type: 'bulk_string', value: 'hello\r\nworld' });
    });
  });

  describe('Array', () => {
    it('should parse simple array', () => {
      parser.append(Buffer.from('*2\r\n$3\r\nfoo\r\n$3\r\nbar\r\n'));
      const result = parser.tryParse();
      expect(result).toEqual({
        type: 'array',
        value: [
          { type: 'bulk_string', value: 'foo' },
          { type: 'bulk_string', value: 'bar' },
        ],
      });
    });

    it('should parse empty array', () => {
      parser.append(Buffer.from('*0\r\n'));
      const result = parser.tryParse();
      expect(result).toEqual({ type: 'array', value: [] });
    });

    it('should parse null array', () => {
      parser.append(Buffer.from('*-1\r\n'));
      const result = parser.tryParse();
      expect(result).toEqual({ type: 'array', value: null });
    });

    it('should parse nested array', () => {
      parser.append(Buffer.from('*2\r\n*2\r\n$1\r\na\r\n$1\r\nb\r\n*1\r\n$1\r\nc\r\n'));
      const result = parser.tryParse();
      expect(result).toEqual({
        type: 'array',
        value: [
          {
            type: 'array',
            value: [
              { type: 'bulk_string', value: 'a' },
              { type: 'bulk_string', value: 'b' },
            ],
          },
          {
            type: 'array',
            value: [{ type: 'bulk_string', value: 'c' }],
          },
        ],
      });
    });

    it('should parse mixed type array', () => {
      parser.append(Buffer.from('*3\r\n:1\r\n$3\r\ntwo\r\n+three\r\n'));
      const result = parser.tryParse();
      expect(result).toEqual({
        type: 'array',
        value: [
          { type: 'integer', value: 1 },
          { type: 'bulk_string', value: 'two' },
          { type: 'simple_string', value: 'three' },
        ],
      });
    });
  });

  describe('Streaming / Incomplete Data', () => {
    it('should return null for incomplete data', () => {
      parser.append(Buffer.from('$5\r\nhel'));
      expect(parser.tryParse()).toBeNull();
    });

    it('should parse after receiving complete data', () => {
      parser.append(Buffer.from('$5\r\nhel'));
      expect(parser.tryParse()).toBeNull();
      
      parser.append(Buffer.from('lo\r\n'));
      const result = parser.tryParse();
      expect(result).toEqual({ type: 'bulk_string', value: 'hello' });
    });

    it('should parse multiple values in sequence', () => {
      parser.append(Buffer.from('+OK\r\n:100\r\n'));
      
      expect(parser.tryParse()).toEqual({ type: 'simple_string', value: 'OK' });
      expect(parser.tryParse()).toEqual({ type: 'integer', value: 100 });
      expect(parser.tryParse()).toBeNull();
    });
  });

  describe('respToJs', () => {
    it('should convert simple string', () => {
      expect(respToJs({ type: 'simple_string', value: 'OK' })).toBe('OK');
    });

    it('should convert integer', () => {
      expect(respToJs({ type: 'integer', value: 42 })).toBe(42);
    });

    it('should convert bulk string', () => {
      expect(respToJs({ type: 'bulk_string', value: 'hello' })).toBe('hello');
    });

    it('should convert null bulk string', () => {
      expect(respToJs({ type: 'bulk_string', value: null })).toBeNull();
    });

    it('should convert array', () => {
      const resp = {
        type: 'array' as const,
        value: [
          { type: 'bulk_string' as const, value: 'foo' },
          { type: 'integer' as const, value: 1 },
        ],
      };
      expect(respToJs(resp)).toEqual(['foo', 1]);
    });

    it('should throw on error type', () => {
      expect(() => respToJs({ type: 'error', value: 'ERR test' })).toThrow('ERR test');
    });
  });
});
