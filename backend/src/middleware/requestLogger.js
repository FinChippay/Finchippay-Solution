const logger = require("../utils/logger");

function requestLogger(req, res, next) {
  const start = Date.now();
  const correlationId = req.correlationId;

  // Log on request start
  if (req.log) {
    req.log.info(
      { method: req.method, url: req.originalUrl || req.url, correlationId },
      "Request started",
    );
  } else {
    logger.info(
      { method: req.method, url: req.originalUrl || req.url, correlationId },
      "Request started",
    );
  }

  // Log on response finish
  res.on("finish", () => {
    const responseTime = Date.now() - start;
    if (req.log) {
      req.log.info(
        {
          method: req.method,
          url: req.originalUrl || req.url,
          statusCode: res.statusCode,
          responseTime,
          correlationId,
        },
        "Request finished",
      );
    } else {
      logger.info(
        {
          method: req.method,
          url: req.originalUrl || req.url,
          statusCode: res.statusCode,
          responseTime,
          correlationId,
        },
        "Request finished",
      );
    }
  });

  next();
}

module.exports = requestLogger;
