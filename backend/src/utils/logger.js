const pino = require("pino");

const isProduction = process.env.NODE_ENV === "production";

const STELLAR_SECRET_KEY_PATTERN = /S[A-Z2-7]{55}/g;
const REDACTED_STELLAR = "[REDACTED_STELLAR_SECRET]";

function redactStellarKeys(obj) {
  if (typeof obj === "string") return obj.replace(STELLAR_SECRET_KEY_PATTERN, REDACTED_STELLAR);
  if (obj instanceof Error) {
    obj.message = obj.message.replace(STELLAR_SECRET_KEY_PATTERN, REDACTED_STELLAR);
    if (obj.stack) obj.stack = obj.stack.replace(STELLAR_SECRET_KEY_PATTERN, REDACTED_STELLAR);
    return obj;
  }
  if (obj && typeof obj === "object") {
    try {
      const str = JSON.stringify(obj);
      if (STELLAR_SECRET_KEY_PATTERN.test(str)) {
        return JSON.parse(str.replace(STELLAR_SECRET_KEY_PATTERN, REDACTED_STELLAR));
      }
    } catch { /* ignore */ }
  }
  return obj;
}

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  base: { service: "finchippay-backend" },
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() };
    },
    bindings: (bindings) => {
      return { service: "finchippay-backend", ...bindings };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      "privateKey",
      "secret",
      "password",
      "token",
      "signature",
      "jwt",
      "authorization",
      "apiKey",
      "api_key",
      "accessToken",
      "access_token",
      "refreshToken",
      "refresh_token",
    ],
    censor: "[REDACTED]",
  },
  mixin() {
    const { getRequestId } = require("./correlationId");
    const correlationId = getRequestId();
    return correlationId ? { correlationId } : {};
  },
  serializers: {
    err: (err) => redactStellarKeys(err),
    error: (err) => redactStellarKeys(err),
  },
  hooks: {
    logMethod(inputArgs, method) {
      const args = inputArgs.map((arg) => redactStellarKeys(arg));
      return method.apply(this, args);
    },
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
          },
        },
      }),
});

module.exports = logger;
