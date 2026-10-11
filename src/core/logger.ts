/**
 * Structured logger with redaction support.
 * IMPORTANT: Never log credentials, tokens, cookies, or private client data.
 */

import chalk from 'chalk';

export type LogLevel = 'debug' | 'info' | 'success' | 'warn' | 'error' | 'silent';

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  success: 1,
  warn: 2,
  error: 3,
  silent: 99,
};

let currentLevel: LogLevel = 'info';
let jsonMode = false;

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function setJsonMode(enabled: boolean): void {
  jsonMode = enabled;
}

const SENSITIVE_PATTERNS = [
  /password\s*[:=]\s*\S+/gi,
  /token\s*[:=]\s*\S+/gi,
  /secret\s*[:=]\s*\S+/gi,
  /api[_-]?key\s*[:=]\s*\S+/gi,
  /bearer\s+\S+/gi,
  /authorization\s*:\s*\S+/gi,
];

function redact(message: string): string {
  let result = message;
  for (const pattern of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[currentLevel];
}

function formatMessage(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
  const safe = redact(message);
  if (jsonMode) {
    return JSON.stringify({ level, message: safe, ...(meta ?? {}), timestamp: new Date().toISOString() });
  }
  return safe;
}

export const logger = {
  debug(message: string, meta?: Record<string, unknown>): void {
    if (!shouldLog('debug')) return;
    console.error(chalk.gray(`[debug] ${formatMessage('debug', message, meta)}`));
  },

  info(message: string, meta?: Record<string, unknown>): void {
    if (!shouldLog('info')) return;
    console.error(chalk.blue(`  ${formatMessage('info', message, meta)}`));
  },

  success(message: string, meta?: Record<string, unknown>): void {
    if (!shouldLog('success')) return;
    console.error(chalk.green(`✓ ${formatMessage('success', message, meta)}`));
  },

  warn(message: string, meta?: Record<string, unknown>): void {
    if (!shouldLog('warn')) return;
    console.error(chalk.yellow(`⚠ ${formatMessage('warn', message, meta)}`));
  },

  error(message: string, meta?: Record<string, unknown>): void {
    if (!shouldLog('error')) return;
    console.error(chalk.red(`✗ ${formatMessage('error', message, meta)}`));
  },

  /** Print directly to stdout (for machine-readable output). */
  output(data: unknown): void {
    if (jsonMode || typeof data === 'object') {
      console.log(JSON.stringify(data, null, 2));
    } else {
      console.log(String(data));
    }
  },
};
