/**
 * RESP 协议序列化器
 * 将 Redis 命令序列化为 RESP 协议格式
 */

const CRLF = '\r\n';

/**
 * 将命令数组序列化为 RESP 协议格式
 * 
 * 示例：
 * serializeCommand(['SET', 'key', 'value'])
 * => "*3\r\n$3\r\nSET\r\n$3\r\nkey\r\n$5\r\nvalue\r\n"
 */
export function serializeCommand(args: (string | number | Buffer)[]): Buffer {
  const parts: Buffer[] = [];
  
  // 数组头：*<count>\r\n
  parts.push(Buffer.from(`*${args.length}${CRLF}`));

  for (const arg of args) {
    const data = toBuffer(arg);
    // 批量字符串：$<length>\r\n<data>\r\n
    parts.push(Buffer.from(`$${data.length}${CRLF}`));
    parts.push(data);
    parts.push(Buffer.from(CRLF));
  }

  return Buffer.concat(parts);
}

/**
 * 序列化多个命令（Pipeline）
 */
export function serializeCommands(commands: (string | number | Buffer)[][]): Buffer {
  const parts: Buffer[] = [];
  for (const cmd of commands) {
    parts.push(serializeCommand(cmd));
  }
  return Buffer.concat(parts);
}

/**
 * 将值转换为 Buffer
 */
function toBuffer(value: string | number | Buffer): Buffer {
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (typeof value === 'number') {
    return Buffer.from(String(value));
  }
  return Buffer.from(value, 'utf8');
}

/**
 * 解析命令字符串为参数数组
 * 支持引号包裹的参数
 * 
 * 示例：
 * parseCommandString('SET "my key" "hello world"')
 * => ['SET', 'my key', 'hello world']
 */
export function parseCommandString(input: string): string[] {
  const args: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';
  let escape = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (escape) {
      // 处理转义字符
      switch (char) {
        case 'n': current += '\n'; break;
        case 'r': current += '\r'; break;
        case 't': current += '\t'; break;
        case '\\': current += '\\'; break;
        case '"': current += '"'; break;
        case "'": current += "'"; break;
        default: current += char;
      }
      escape = false;
      continue;
    }

    if (char === '\\' && inQuote) {
      escape = true;
      continue;
    }

    if ((char === '"' || char === "'") && !inQuote) {
      inQuote = true;
      quoteChar = char;
      continue;
    }

    if (char === quoteChar && inQuote) {
      inQuote = false;
      quoteChar = '';
      continue;
    }

    if (char === ' ' && !inQuote) {
      if (current.length > 0) {
        args.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    args.push(current);
  }

  return args;
}

/**
 * 格式化命令用于显示
 */
export function formatCommand(args: string[]): string {
  return args.map(arg => {
    // 检查是否需要引号包裹（包含空格、引号或特殊字符）
    if (arg.includes(' ') || arg.includes('"') || arg.includes("'") ||
        arg.includes('\n') || arg.includes('\r') || arg.includes('\t')) {
      // 需要引号包裹
      const escaped = arg
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t');
      return `"${escaped}"`;
    }
    return arg;
  }).join(' ');
}
