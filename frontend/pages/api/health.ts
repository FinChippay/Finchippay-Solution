import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Health check endpoint for deployment verification.
 * Responds with 200 OK and basic build/deployment metadata.
 */
export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
    version: process.env.NEXT_PUBLIC_VERSION || "unknown",
  });
}
