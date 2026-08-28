/**
 * lib/logger.ts
 * Structured frontend logging utility for Finchippay Solution.
 *
 * Replaces ad-hoc console.error/log calls with categorized, production-safe logging.
 * In production, errors are forwarded to Sentry. In development, detailed logs
 * are emitted with timestamps and contextual metadata.
 *
 * Usage:
 *   import { logger } from "@/lib/logger";
 *   logger.error("Payment failed", { txHash, errorCode }, err);
 *   logger.warn("Rate limit approaching", { endpoint, remaining });
 *   logger.info("Wallet connected", { publicKey: publicKey.slice(0, 8) });
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  error?: Error;
  timestamp: string;
  source: string;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const MIN_LEVEL: LogLevel =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "debug"
    : process.env.NODE_ENV === "production"
    ? "warn"
    : "info";

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[MIN_LEVEL];
}

function buildEntry(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>,
  error?: Error,
): LogEntry {
  return {
    level,
    message,
    context: context ? sanitizeContext(context) : undefined,
    error,
    timestamp: new Date().toISOString(),
    source: "finchippay-frontend",
  };
}

/** Strip potentially sensitive data from log context. */
function sanitizeContext(
  ctx: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  const sensitiveKeys = new Set([
    "secretKey",
    "privateKey",
    "password",
    "token",
    "jwt",
    "seed",
    "mnemonic",
  ]);

  for (const [key, value] of Object.entries(ctx)) {
    if (sensitiveKeys.has(key)) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof value === "string" && value.length > 80) {
      sanitized[key] = value.substring(0, 77) + "...";
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

function emit(entry: LogEntry): void {
  if (!shouldLog(entry.level)) return;

  const { level, message, context, error } = entry;

  if (typeof window !== "undefined" && process.env.NODE_ENV === "production") {
    // Forward errors to Sentry in production
    try {
      const Sentry = (window as unknown as Record<string, unknown>).Sentry as
        | { captureException?: (e: Error, ctx?: Record<string, unknown>) => void }
        | undefined;
      if (level === "error" && error && Sentry?.captureException) {
        Sentry.captureException(error, {
          tags: { source: "finchippay-frontend" },
          extra: context,
        });
      }
      if (level === "warn" && error && Sentry?.captureException) {
        Sentry.captureException(error, {
          level: "warning",
          tags: { source: "finchippay-frontend" },
          extra: context,
        });
      }
    } catch {
      // Sentry may not be loaded; fall through to console
    }
  }

  // Console output (development or fallback)
  const prefix = `[${entry.timestamp}] [${level.toUpperCase()}]`;
  const ctxStr = context ? ` ${JSON.stringify(context)}` : "";

  switch (level) {
    case "error":
      if (error) {
        console.error(`${prefix} ${message}${ctxStr}`, error);
      } else {
        console.error(`${prefix} ${message}${ctxStr}`);
      }
      break;
    case "warn":
      console.warn(`${prefix} ${message}${ctxStr}`);
      break;
    case "info":
      console.info(`${prefix} ${message}${ctxStr}`);
      break;
    case "debug":
      console.debug(`${prefix} ${message}${ctxStr}`);
      break;
  }
}

export const logger = {
  debug(message: string, context?: Record<string, unknown>): void {
    emit(buildEntry("debug", message, context));
  },

  info(message: string, context?: Record<string, unknown>): void {
    emit(buildEntry("info", message, context));
  },

  warn(
    message: string,
    context?: Record<string, unknown>,
    error?: Error,
  ): void {
    emit(buildEntry("warn", message, context, error));
  },

  error(
    message: string,
    context?: Record<string, unknown>,
    error?: Error,
  ): void {
    emit(buildEntry("error", message, context, error));
  },
};

export default logger;
