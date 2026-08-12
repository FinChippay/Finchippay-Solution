"use strict";

const { z } = require("zod");
const { SUPPORTED_WEBHOOK_TOPICS } = require("../services/webhookTopics");

const WEBHOOK_FIELDS_REQUIRED = "publicKey, url, and secret are required";

const registerWebhookSchema = z.object({
  publicKey: z
    .string({ required_error: WEBHOOK_FIELDS_REQUIRED })
    .regex(/^G[A-Z2-7]{55}$/, "Invalid Stellar public key format"),
  url: z
    .string({ required_error: WEBHOOK_FIELDS_REQUIRED })
    .url("Invalid URL format")
    .refine((value) => process.env.NODE_ENV !== "production" || value.startsWith("https://"), {
      message: "Webhook URL must use HTTPS in production",
    }),
  secret: z
    .string({ required_error: WEBHOOK_FIELDS_REQUIRED })
    .min(8, "Secret must be at least 8 characters for HMAC-SHA256 security"),
  topics: z
    .array(
      z.enum(SUPPORTED_WEBHOOK_TOPICS, {
        errorMap: () => ({
          message: `Invalid webhook topic. Supported topics: ${SUPPORTED_WEBHOOK_TOPICS.join(", ")}`,
        }),
      }),
    )
    .min(1, "topics must contain at least one topic")
    .default(["all"])
    .transform((topics) => (topics.includes("all") ? ["all"] : [...new Set(topics)])),
});

module.exports = {
  registerWebhookSchema,
};
