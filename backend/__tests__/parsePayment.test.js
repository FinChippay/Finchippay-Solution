/**
 * __tests__/parsePayment.test.js
 * Unit tests for the AI payment parsing route.
 */

"use strict";

const request = require("supertest");
const express = require("express");

// Mock axios before requiring the route
jest.mock("axios");
const axios = require("axios");

// Build a minimal Express app that mounts the route under test
const app = express();
app.use(express.json());
const parsePaymentRoutes = require("../src/routes/parsePayment");
app.use("/api/parse-payment", parsePaymentRoutes);

describe("POST /api/parse-payment", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("validation", () => {
    it("returns 400 when input is missing", async () => {
      const res = await request(app).post("/api/parse-payment").send({});
      expect(res.status).toBe(400);
      expect(res.body.clarification).toBe(
        "Please provide a payment description.",
      );
    });

    it("returns 400 when input is not a string", async () => {
      const res = await request(app)
        .post("/api/parse-payment")
        .send({ input: 123 });
      expect(res.status).toBe(400);
    });

    it("returns 400 when input is an empty string", async () => {
      const res = await request(app)
        .post("/api/parse-payment")
        .send({ input: "" });
      expect(res.status).toBe(400);
    });
  });

  describe("when ANTHROPIC_API_KEY is not set", () => {
    const originalKey = process.env.ANTHROPIC_API_KEY;

    beforeEach(() => {
      delete process.env.ANTHROPIC_API_KEY;
    });

    afterEach(() => {
      process.env.ANTHROPIC_API_KEY = originalKey;
    });

    it("returns 501 when API key is missing", async () => {
      const res = await request(app)
        .post("/api/parse-payment")
        .send({ input: "Send 50 XLM to GABC" });
      expect(res.status).toBe(501);
      expect(res.body.clarification).toContain("ANTHROPIC_API_KEY");
    });
  });

  describe("with ANTHROPIC_API_KEY set", () => {
    beforeEach(() => {
      process.env.ANTHROPIC_API_KEY = "test-key";
    });

    afterEach(() => {
      delete process.env.ANTHROPIC_API_KEY;
    });

    it("returns parsed payment intent on successful API response", async () => {
      const mockResponse = {
        data: {
          content: [
            {
              text: JSON.stringify({
                amount: "50 XLM",
                recipient: "GABC123",
                memo: "design work",
                isValid: true,
                clarification: "",
              }),
            },
          ],
        },
      };

      axios.post.mockResolvedValue(mockResponse);

      const res = await request(app)
        .post("/api/parse-payment")
        .send({ input: "Send 50 XLM to GABC123 for design work" });

      expect(res.status).toBe(200);
      expect(res.body.amount).toBe("50 XLM");
      expect(res.body.recipient).toBe("GABC123");
      expect(res.body.memo).toBe("design work");
      expect(res.body.isValid).toBe(true);
    });

    it("handles Anthropic API errors gracefully", async () => {
      axios.post.mockRejectedValue(new Error("Network error"));

      const res = await request(app)
        .post("/api/parse-payment")
        .send({ input: "Send 50 XLM to GABC" });

      expect(res.status).toBe(500);
      expect(res.body.clarification).toBe("Server error. Try again.");
    });

    it("handles malformed Anthropic responses gracefully", async () => {
      const mockResponse = {
        data: {
          content: [{ text: "not valid json at all {{{" }],
        },
      };

      axios.post.mockResolvedValue(mockResponse);

      const res = await request(app)
        .post("/api/parse-payment")
        .send({ input: "Send 50 XLM to GABC" });

      expect(res.status).toBe(200);
      expect(res.body.isValid).toBe(false);
      expect(res.body.clarification).toContain("couldn't understand");
    });

    it("sends the correct prompt structure to Anthropic", async () => {
      const mockResponse = {
        data: {
          content: [
            {
              text: JSON.stringify({
                amount: "10 XLM",
                recipient: "GDEF456",
                memo: "coffee",
                isValid: true,
                clarification: "",
              }),
            },
          ],
        },
      };

      axios.post.mockResolvedValue(mockResponse);

      await request(app)
        .post("/api/parse-payment")
        .send({ input: "Pay 10 XLM to GDEF456 for coffee" });

      expect(axios.post).toHaveBeenCalledTimes(1);

      const callArgs = axios.post.mock.calls[0];
      expect(callArgs[0]).toBe("https://api.anthropic.com/v1/messages");
      expect(callArgs[1].model).toBe("claude-3-haiku-20240307");
      expect(callArgs[1].max_tokens).toBe(300);
      expect(callArgs[1].messages).toHaveLength(1);
      expect(callArgs[1].messages[0].role).toBe("user");
      expect(callArgs[1].messages[0].content).toContain(
        "Pay 10 XLM to GDEF456 for coffee",
      );
      expect(callArgs[2].headers["x-api-key"]).toBe("test-key");
      expect(callArgs[2].headers["anthropic-version"]).toBe("2023-06-01");
    });
  });
});
