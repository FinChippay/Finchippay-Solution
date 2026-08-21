/**
 * __tests__/emailRenderer.test.js
 *
 * Tests for emailRenderer.js:
 * - Template rendering for all types
 * - HTML structure validation
 * - Tracking pixel injection
 * - Plain text output
 * - Unknown template error
 */

"use strict";

const emailRenderer = require("../src/services/emailRenderer");

describe("emailRenderer", () => {
  const SAMPLE_DATA = {
    amount: "100",
    asset: "USDC",
    sender: "GABCDEF",
    recipient: "GHIJKL",
    memo: "test memo",
    timestamp: "2026-01-01T00:00:00Z",
    txHash: "abc123",
  };

  describe("availableTemplates()", () => {
    it("returns all expected template types", () => {
      const templates = emailRenderer.availableTemplates();
      expect(templates).toEqual(
        expect.arrayContaining([
          "welcome",
          "payment_received",
          "payment_sent",
          "escrow_released",
          "stream_claimed",
          "scheduled_txn_executed",
          "price_alert",
          "security_alert",
          "email_verification",
          "digest",
        ]),
      );
    });
  });

  describe("render()", () => {
    it("throws for unknown template type", () => {
      expect(() => emailRenderer.render("nonexistent_type", {})).toThrow(
        /Unknown email template/,
      );
    });

    it("renders payment_received with HTML and plain text", () => {
      const { html, text, subject } = emailRenderer.render("payment_received", SAMPLE_DATA);
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("100");
      expect(html).toContain("USDC");
      expect(html).toContain("GABCDEF");
      expect(text).toContain("100");
      expect(text).toContain("USDC");
      expect(subject).toMatch(/100.*USDC/);
    });

    it("renders payment_sent correctly", () => {
      const { html, text, subject } = emailRenderer.render("payment_sent", SAMPLE_DATA);
      expect(html).toContain("GHIJKL");
      expect(text).toContain("Payment Sent");
      expect(subject).toMatch(/sent/i);
    });

    it("renders escrow_released correctly", () => {
      const { html, text } = emailRenderer.render("escrow_released", SAMPLE_DATA);
      expect(html).toContain("Escrow");
      expect(text).toContain("Escrow");
    });

    it("renders stream_claimed correctly", () => {
      const { html } = emailRenderer.render("stream_claimed", SAMPLE_DATA);
      expect(html).toContain("stream");
    });

    it("renders scheduled_txn_executed correctly", () => {
      const { html, subject } = emailRenderer.render("scheduled_txn_executed", {
        ...SAMPLE_DATA,
        scheduledAt: "2026-01-01T00:00:00Z",
      });
      expect(html).toContain("Scheduled");
      expect(subject).toMatch(/Scheduled/i);
    });

    it("renders price_alert correctly", () => {
      const { html } = emailRenderer.render("price_alert", {
        asset: "XLM",
        currentPrice: "0.12",
        direction: "above",
        threshold: "0.10",
        timestamp: "2026-01-01T00:00:00Z",
      });
      expect(html).toContain("XLM");
      expect(html).toContain("0.12");
    });

    it("renders security_alert correctly", () => {
      const { html } = emailRenderer.render("security_alert", {
        alertType: "New login detected",
        ipAddress: "1.2.3.4",
        timestamp: "2026-01-01T00:00:00Z",
      });
      expect(html).toContain("Security");
      expect(html).toContain("1.2.3.4");
    });

    it("renders email_verification correctly", () => {
      const { html, text } = emailRenderer.render("email_verification", {
        verificationUrl: "https://finchippay.io/verify?token=abc",
      });
      expect(html).toContain("https://finchippay.io/verify?token=abc");
      expect(text).toContain("https://finchippay.io/verify?token=abc");
    });

    it("renders welcome correctly", () => {
      const { html } = emailRenderer.render("welcome", {
        publicKey: "GABC",
        username: "alice",
        dashboardUrl: "https://finchippay.io/dashboard",
      });
      expect(html).toContain("GABC");
      expect(html).toContain("alice");
    });

    it("injects tracking pixel URL when provided", () => {
      const { html } = emailRenderer.render("payment_received", SAMPLE_DATA, {
        trackingPixelUrl: "https://finchippay.io/api/emails/track/abc/open.gif",
      });
      expect(html).toContain("https://finchippay.io/api/emails/track/abc/open.gif");
    });

    it("injects unsubscribe URL when provided", () => {
      const { html } = emailRenderer.render("payment_received", SAMPLE_DATA, {
        unsubscribeUrl: "https://finchippay.io/api/emails/unsubscribe?token=xyz",
      });
      expect(html).toContain("https://finchippay.io/api/emails/unsubscribe?token=xyz");
    });

    it("renders HTML with responsive wrapper", () => {
      const { html } = emailRenderer.render("payment_received", SAMPLE_DATA);
      expect(html).toContain("max-width");
      expect(html).toContain("@media");
    });

    it("optional memo field is omitted from HTML when missing", () => {
      const dataWithoutMemo = { ...SAMPLE_DATA };
      delete dataWithoutMemo.memo;
      const { html } = emailRenderer.render("payment_received", dataWithoutMemo);
      // Handlebars {{#if memo}} block should suppress the row
      expect(html).not.toMatch(/Memo.*undefined/);
    });

    it("renders digest template with event list", () => {
      const { html, subject } = emailRenderer.render("digest", {
        count: 5,
        events: [
          { label: "payment_received", timestamp: "2026-01-01", summary: "100 USDC" },
          { label: "escrow_released", timestamp: "2026-01-02", summary: "50 USDC" },
        ],
      });
      expect(html).toContain("100 USDC");
      expect(subject).toMatch(/5/);
    });
  });
});
