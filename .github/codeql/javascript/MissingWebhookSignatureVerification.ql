/**
 * @name Webhook handler missing HMAC signature verification
 * @description An Express route that appears to be a webhook receiver
 *              processes the request body without verifying the
 *              X-Webhook-Signature (or equivalent) header.  Without
 *              signature verification an attacker can forge arbitrary
 *              webhook payloads and trigger payment events, data mutations,
 *              or other privileged actions.
 *
 *              The Finchippay webhook service signs every outbound payload
 *              with HMAC-SHA256 and includes the digest in the
 *              `X-Webhook-Signature` header.  Consumers MUST call
 *              `verifyWebhookSignature` (or an equivalent timing-safe
 *              comparison) before trusting the body.
 * @kind problem
 * @problem.severity error
 * @security-severity 8.0
 * @precision medium
 * @id finchippay/missing-webhook-signature-verification
 * @tags security
 *       integrity
 *       webhooks
 *       stellar
 */

import javascript
import semmle.javascript.frameworks.Express

/**
 * Holds if `handler` is an Express route handler function whose enclosing
 * route path contains a webhook-related segment.
 */
predicate isWebhookRouteHandler(Express::RouteHandler handler) {
  exists(Express::RouteSetup setup |
    setup.getARouteHandler() = handler and
    (
      setup.getRelativePath().regexpMatch("(?i).*/webhook.*") or
      setup.getRelativePath().regexpMatch("(?i).*/hook.*") or
      setup.getRelativePath().regexpMatch("(?i).*/notify.*") or
      setup.getRelativePath().regexpMatch("(?i).*/callback.*") or
      setup.getRelativePath().regexpMatch("(?i).*/event.*")
    ) and
    (
      setup.getRequestMethod() = "post" or
      setup.getRequestMethod() = "put" or
      setup.getRequestMethod() = "patch"
    )
  )
}

/**
 * Holds if `handler` accesses `req.headers` in a way that suggests it is
 * reading a signature or verification header (X-Webhook-Signature,
 * X-Hub-Signature, X-Signature, etc.).
 */
predicate readsSignatureHeader(Express::RouteHandler handler) {
  exists(PropAccess headersAccess |
    // req.headers
    headersAccess.getPropertyName() = "headers" and
    headersAccess.getBase().(Expr).flow().(DataFlow::SourceNode).hasLocationInfo(_, _, _, _, _) and
    headersAccess.getEnclosingFunction() = handler.getFunction()
  ) and
  exists(string sigPattern |
    sigPattern.regexpMatch("(?i).*(signature|webhook.sig|x-hub|hmac|x-webhook).*") and
    any(PropAccess pa |
      pa.getEnclosingFunction() = handler.getFunction() and
      pa.getPropertyName().regexpMatch("(?i).*(signature|webhook.sig|x-hub|hmac|x-webhook).*")
    ).getPropertyName() = sigPattern
  )
}

/**
 * Holds if `handler` calls a signature verification function, identified by
 * a call whose callee name contains "verify", "validate", or "check" and
 * "signature" or "hmac" or "webhook".
 */
predicate callsSignatureVerification(Express::RouteHandler handler) {
  exists(CallExpr call |
    call.getEnclosingFunction() = handler.getFunction() and
    (
      call.getCalleeName().regexpMatch("(?i).*(verify|validate|check).*(signature|hmac|webhook).*") or
      call.getCalleeName().regexpMatch("(?i).*(signature|hmac|webhook).*(verify|validate|check).*") or
      // Direct method call: verifyWebhookSignature(...)
      call.getCalleeName() = "verifyWebhookSignature" or
      call.getCalleeName() = "validateWebhookSignature" or
      call.getCalleeName() = "checkSignature" or
      call.getCalleeName() = "verifySignature"
    )
  )
}

/**
 * Holds if `handler` accesses req.body, indicating it consumes the payload.
 */
predicate consumesRequestBody(Express::RouteHandler handler) {
  exists(PropAccess bodyAccess |
    bodyAccess.getPropertyName() = "body" and
    bodyAccess.getEnclosingFunction() = handler.getFunction()
  )
}

from Express::RouteHandler handler
where
  isWebhookRouteHandler(handler) and
  consumesRequestBody(handler) and
  not callsSignatureVerification(handler) and
  not readsSignatureHeader(handler)
select handler,
  "This webhook route handler accesses the request body without verifying the " +
  "HMAC-SHA256 signature (X-Webhook-Signature header). " +
  "Call verifyWebhookSignature(payload, secret, req.headers['x-webhook-signature']) " +
  "using a timing-safe comparison before processing the payload to prevent " +
  "forged webhook attacks."
