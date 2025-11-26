/**
 * Simple Logger Utility
 *
 * Provides consistent logging format with timestamps and log levels.
 * Supports filtering by log level via LOG_LEVEL environment variable.
 *
 * @example
 * ```typescript
 * import { logger } from '@/lib/logger';
 *
 * logger.debug('RateLimiter', 'Detailed debug info');
 * logger.info('ProcessVideo', 'Starting job', { jobId: '123' });
 * logger.warn('Gemini', 'Retry attempt', { attempt: 2, maxRetries: 5 });
 * logger.error('ProcessVideo', 'Job failed', { error: err.message });
 * ```
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Get log level from environment, default to 'info'
function getCurrentLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase();
  if (envLevel && envLevel in LOG_LEVELS) {
    return envLevel as LogLevel;
  }
  return 'info';
}

/**
 * Format timestamp in ISO format with milliseconds
 */
function getTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Format log message with consistent structure
 */
function formatMessage(
  level: LogLevel,
  component: string,
  message: string,
  data?: Record<string, unknown>
): string {
  const timestamp = getTimestamp();
  const levelUpper = level.toUpperCase().padEnd(5);
  const dataStr = data ? ` ${JSON.stringify(data)}` : '';
  return `${timestamp} ${levelUpper} [${component}] ${message}${dataStr}`;
}

/**
 * Check if a log level should be output
 */
function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[getCurrentLevel()];
}

/**
 * Logger instance with methods for each log level
 */
export const logger = {
  /**
   * Debug level - detailed information for debugging
   * Only shown when LOG_LEVEL=debug
   */
  debug(component: string, message: string, data?: Record<string, unknown>): void {
    if (shouldLog('debug')) {
      console.log(formatMessage('debug', component, message, data));
    }
  },

  /**
   * Info level - general information about normal operation
   * Default level
   */
  info(component: string, message: string, data?: Record<string, unknown>): void {
    if (shouldLog('info')) {
      console.log(formatMessage('info', component, message, data));
    }
  },

  /**
   * Warn level - potential issues that don't prevent operation
   */
  warn(component: string, message: string, data?: Record<string, unknown>): void {
    if (shouldLog('warn')) {
      console.warn(formatMessage('warn', component, message, data));
    }
  },

  /**
   * Error level - errors that affect operation
   */
  error(component: string, message: string, data?: Record<string, unknown>): void {
    if (shouldLog('error')) {
      console.error(formatMessage('error', component, message, data));
    }
  },
};

export default logger;
