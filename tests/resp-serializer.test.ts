/**
 * RESP 序列化器单元测试
 */

import { describe, it, expect } from 'vitest';
import { 
  serializeCommand, 
  serializeCommands, 
  parseCommandString, 
  formatCommand 
} from '../core/resp-serializer';

describe('serializeCommand', () => {
  it('should serialize simple command', () => {
    const result = serializeCommand(['PING']);
    expect(result.toString()).toBe('*1\r\n$4\r\nPING\r\n');
  });

  it('should serialize SET command', () => {
    const result = serializeCommand(['SET', 'key', 'value']);
    expect(result.toString()).toBe('*3\r\n$3\r\nSET\r\n$3\r\nkey\r\n$5\r\nvalue\r\n');
  });

  it('should serialize command with numbers', () => {
    const result = serializeCommand(['EXPIRE', 'key', 60]);
    expect(result.toString()).toBe('*3\r\n$6\r\nEXPIRE\r\n$3\r\nkey\r\n$2\r\n60\r\n');
  });

  it('should handle empty string argument', () => {
    const result = serializeCommand(['SET', 'key', '']);
    expect(result.toString()).toBe('*3\r\n$3\r\nSET\r\n$3\r\nkey\r\n$0\r\n\r\n');
  });

  it('should handle binary data in Buffer', () => {
    const result = serializeCommand(['SET', 'key', Buffer.from('hello')]);
    expect(result.toString()).toBe('*3\r\n$3\r\nSET\r\n$3\r\nkey\r\n$5\r\nhello\r\n');
  });
});

describe('serializeCommands', () => {
  it('should serialize multiple commands (pipeline)', () => {
    const result = serializeCommands([
      ['SET', 'a', '1'],
      ['SET', 'b', '2'],
    ]);
    expect(result.toString()).toBe(
      '*3\r\n$3\r\nSET\r\n$1\r\na\r\n$1\r\n1\r\n' +
      '*3\r\n$3\r\nSET\r\n$1\r\nb\r\n$1\r\n2\r\n'
    );
  });
});

describe('parseCommandString', () => {
  it('should parse simple command', () => {
    expect(parseCommandString('PING')).toEqual(['PING']);
  });

  it('should parse command with arguments', () => {
    expect(parseCommandString('SET key value')).toEqual(['SET', 'key', 'value']);
  });

  it('should handle double quotes', () => {
    expect(parseCommandString('SET "my key" "my value"')).toEqual(['SET', 'my key', 'my value']);
  });

  it('should handle single quotes', () => {
    expect(parseCommandString("SET 'my key' 'my value'")).toEqual(['SET', 'my key', 'my value']);
  });

  it('should handle escape sequences', () => {
    expect(parseCommandString('SET key "hello\\nworld"')).toEqual(['SET', 'key', 'hello\nworld']);
  });

  it('should handle escaped quotes', () => {
    expect(parseCommandString('SET key "say \\"hello\\""')).toEqual(['SET', 'key', 'say "hello"']);
  });

  it('should handle multiple spaces', () => {
    expect(parseCommandString('SET   key    value')).toEqual(['SET', 'key', 'value']);
  });

  it('should handle empty input', () => {
    expect(parseCommandString('')).toEqual([]);
  });
});

describe('formatCommand', () => {
  it('should format simple command', () => {
    expect(formatCommand(['SET', 'key', 'value'])).toBe('SET key value');
  });

  it('should quote arguments with spaces', () => {
    expect(formatCommand(['SET', 'my key', 'value'])).toBe('SET "my key" value');
  });

  it('should escape special characters', () => {
    expect(formatCommand(['SET', 'key', 'hello\nworld'])).toBe('SET key "hello\\nworld"');
  });
});
