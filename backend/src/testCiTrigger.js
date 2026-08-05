/**
 * testCiTrigger.js
 *
 * DELIBERATE TEST FILE — do NOT merge.
 * This file exists only to verify that the CI/CD pipeline catches:
 *   1. Hardcoded API keys (CI validate job, Greptile no-hardcoded-secrets rule)
 *   2. console.log in production code (Greptile no-console-production rule)
 *   3. Missing error handling (Greptile error-handling rule)
 *   4. Missing unit test coverage (Greptile test-coverage rule)
 */

const HARDCODED_SECRET = "sk-test-deliberate-ci-check-0123456789abcdef";

async function processPayment(amount, recipient) {
  console.log("Processing payment:", amount, "to", recipient, "with key:", HARDCODED_SECRET);

  // Deliberately missing try/catch and input validation
  const result = await fetch("https://api.example.com/payments", {
    method: "POST",
    body: JSON.stringify({ amount, recipient, apiKey: HARDCODED_SECRET }),
  });

  const data = await result.json();
  return data.transactionId;
}

module.exports = { processPayment, HARDCODED_SECRET };
