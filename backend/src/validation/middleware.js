/**
 * src/validation/middleware.js
 * Express middleware that validates req.body / req.query / req.params against
 * a Zod schema and exposes the parsed (typed, defaulted, coerced) result to
 * downstream handlers as `req.validated`.
 *
 * Failure responses are consistent across every endpoint:
 *   HTTP 400  { error: "<first issue message>", details: { field: [messages] } }
 *
 * Example usage (routes):
 *   const { validate } = require("../validation/middleware");
 *   const { tipSchema } = require("../validation/schemas");
 *   router.post("/", validate(tipSchema), tipsController.recordTip);
 *
 * Example usage (controllers):
 *   const { senderPublicKey } = req.validated; // already parsed & defaulted
 */

"use strict";

const { ZodError } = require("zod");

/**
 * Build the consistent 400 payload for a failed parse.
 * `error` is the first issue's message (schemas are authored so the first
 * issue is the most relevant one); `details` maps each field to the list of
 * its error messages.
 *
 * @param {ZodError} zodError
 * @returns {{ error: string, details: Record<string, string[]> }}
 */
function formatZodError(zodError) {
  const first = zodError.issues[0];
  return {
    error: first ? first.message : "Validation failed",
    details: zodError.flatten().fieldErrors,
  };
}

/**
 * Validate part of the request with a Zod schema.
 *
 * @param {import("zod").ZodTypeAny} schema  Schema to parse with.
 * @param {"body"|"query"|"params"} [source="body"]
 *        Which part of the request to validate.
 * @param {object} [options]
 * @param {object} [options.errorResponse]
 *        When provided, this exact body is returned on validation failure
 *        instead of the standard { error, details } payload. Used by legacy
 *        endpoints whose error shape predates standardisation (e.g. the
 *        AI payment-intent parser).
 * @param {number} [options.status=400] Status used with `errorResponse`.
 *
 * On success, the *parsed* data (with defaults applied and coercions done) is
 * merged into `req.validated`, so a route may validate params and query in
 * sequence without one result clobbering the other.
 */
function validate(schema, source = "body", options = {}) {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      if (options.errorResponse) {
        return res.status(options.status || 400).json(options.errorResponse);
      }
      return res.status(400).json(formatZodError(result.error));
    }

    req.validated = { ...(req.validated || {}), ...result.data };
    next();
  };
}

/**
 * Global error-handling middleware that catches any ZodError thrown outside
 * the validate() middleware (e.g. a schema.parse() inside a controller) and
 * converts it into the same consistent 400 payload.
 *
 * Register in server.js BEFORE the generic error handler:
 *   app.use(zodErrorHandler);
 */
function zodErrorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    return res.status(400).json(formatZodError(err));
  }
  return next(err);
}

module.exports = { validate, zodErrorHandler, formatZodError };
