/**
 * scripts/validateEnv.mjs
 * Fail-fast validation for required frontend environment variables.
 */

const VALID_NETWORKS = ["testnet", "mainnet"];

function collectErrors(env) {
  const errors = [];

  const network = env.NEXT_PUBLIC_STELLAR_NETWORK?.trim();
  if (!network) {
    errors.push(
      'NEXT_PUBLIC_STELLAR_NETWORK is required (e.g. "testnet" or "mainnet")'
    );
  } else if (!VALID_NETWORKS.includes(network)) {
    errors.push(
      `NEXT_PUBLIC_STELLAR_NETWORK must be "testnet" or "mainnet", got "${network}"`
    );
  }

  const horizonUrl = env.NEXT_PUBLIC_HORIZON_URL?.trim();
  if (!horizonUrl) {
    errors.push(
      'NEXT_PUBLIC_HORIZON_URL is required (e.g. "https://horizon-testnet.stellar.org")'
    );
  } else {
    try {
      new URL(horizonUrl);
    } catch {
      errors.push(
        `NEXT_PUBLIC_HORIZON_URL must be a valid URL, got "${horizonUrl}"`
      );
    }
  }

  const apiUrl = env.NEXT_PUBLIC_API_URL?.trim();
  if (!apiUrl) {
    errors.push(
      'NEXT_PUBLIC_API_URL is required (e.g. "http://localhost:4000")'
    );
  } else {
    try {
      new URL(apiUrl);
    } catch {
      errors.push(
        `NEXT_PUBLIC_API_URL must be a valid URL, got "${apiUrl}"`
      );
    }
  }

  return errors;
}

/**
 * Validate required environment variables.
 * Logs actionable errors and exits the process when validation fails.
 *
 * @param {NodeJS.ProcessEnv} [env=process.env]
 */
export function validateEnv(env = process.env) {
  const errors = collectErrors(env);

  if (errors.length === 0) {
    return;
  }

  console.error("\nEnvironment validation failed:\n");
  for (const message of errors) {
    console.error(`  - ${message}`);
  }
  console.error(
    "\nCopy frontend/.env.example to frontend/.env.local and set the required values.\n"
  );
  process.exit(1);
}

export { collectErrors };
