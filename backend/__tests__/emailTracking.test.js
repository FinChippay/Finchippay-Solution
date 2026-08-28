/**
 * __tests__/emailTracking.test.js
 *
 * Tests for emailTrackingService.js:
 * - generateEmailId / trackingPixelUrl
 * - recordEvent
 * - handleOpen, handleClick
 * - handleBounce (including suppression threshold)
 * - isSuppressed
 * - getEvents
 */

"use strict";

// Mock knex DB connection
jest.mock("../src/db/connection", () => {
  const mockKnex = jest.fn();
  const rows = [];
  const unsubRows = [];

  const chainMethods = () => {
    const chain = {
      insert: jest.fn().mockResolvedValue([1]),
      where: jest.fn().mockReturnThis(),
      whereIn: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      count: jest.fn().mockReturnThis(),
      join: jest.fn().mockReturnThis(),
      first: jest.fn().mockResolvedValue(null),
      onConflict: jest.fn().mockReturnThis(),
      ignore: jest.fn().mockResolvedValue(undefined),
      then: jest.fn(),
    };
    return chain;
  };

  // Table-specific mocks
  let emailEventsInsertSpy = jest.fn().mockResolvedValue([1]);
  let emailUnsubSelectFirst = jest.fn().mockResolvedValue(null);

  mockKnex.mockImplementation((tableName) => {
    const chain = chainMethods();
    chain.insert = jest.fn().mockResolvedValue([1]);
    chain.first = jest.fn().mockResolvedValue(null);

    if (tableName === "email_events") {
      chain.insert = emailEventsInsertSpy;
    }
    if (tableName === "email_unsubscribes") {
      chain.first = emailUnsubSelectFirst;
    }

    return chain;
  });

  mockKnex.__emailEventsInsertSpy = emailEventsInsertSpy;
  mockKnex.__emailUnsubSelectFirst = emailUnsubSelectFirst;

  return mockKnex;
});

jest.mock("../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const emailTracking = require("../src/services/emailTrackingService");

describe("emailTrackingService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("generateEmailId()", () => {
    it("returns a non-empty string", () => {
      const id = emailTracking.generateEmailId();
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(10);
    });

    it("generates unique IDs", () => {
      const ids = new Set(Array.from({ length: 20 }, () => emailTracking.generateEmailId()));
      expect(ids.size).toBe(20);
    });
  });

  describe("trackingPixelUrl()", () => {
    it("returns a URL containing the emailId and open.gif", () => {
      const url = emailTracking.trackingPixelUrl("testid123");
      expect(url).toContain("testid123");
      expect(url).toContain("open.gif");
    });
  });

  describe("recordEvent()", () => {
    it("inserts a row into email_events", async () => {
      const knex = require("../src/db/connection");
      const chain = { insert: jest.fn().mockResolvedValue([1]) };
      knex.mockReturnValueOnce(chain);

      await emailTracking.recordEvent("emailId1", "sent", {});
      expect(chain.insert).toHaveBeenCalledWith(
        expect.objectContaining({ email_id: "emailId1", event_type: "sent" }),
      );
    });

    it("does not throw when insert fails", async () => {
      const knex = require("../src/db/connection");
      const chain = { insert: jest.fn().mockRejectedValue(new Error("DB error")) };
      knex.mockReturnValueOnce(chain);

      await expect(emailTracking.recordEvent("x", "sent", {})).resolves.toBeUndefined();
    });
  });

  describe("handleOpen()", () => {
    it("records an 'opened' event", async () => {
      const recordSpy = jest.spyOn(emailTracking, "recordEvent").mockResolvedValue();
      await emailTracking.handleOpen("eid1", { userAgent: "Mozilla", ip: "1.2.3.4" });
      expect(recordSpy).toHaveBeenCalledWith("eid1", "opened", expect.objectContaining({ userAgent: "Mozilla" }));
      recordSpy.mockRestore();
    });
  });

  describe("handleClick()", () => {
    it("records a 'clicked' event with the URL", async () => {
      const recordSpy = jest.spyOn(emailTracking, "recordEvent").mockResolvedValue();
      await emailTracking.handleClick("eid1", "https://finchippay.io", { ip: "1.2.3.4" });
      expect(recordSpy).toHaveBeenCalledWith(
        "eid1",
        "clicked",
        expect.objectContaining({ metadata: { url: "https://finchippay.io" } }),
      );
      recordSpy.mockRestore();
    });
  });

  describe("handleBounce()", () => {
    it("returns { suppressed: false } for soft bounces", async () => {
      const recordSpy = jest.spyOn(emailTracking, "recordEvent").mockResolvedValue();
      const result = await emailTracking.handleBounce("a@b.com", "eid1", "soft", "mailbox full");
      expect(result.suppressed).toBe(false);
      recordSpy.mockRestore();
    });

    it("suppresses after reaching HARD_BOUNCE_THRESHOLD hard bounces", async () => {
      const recordSpy = jest.spyOn(emailTracking, "recordEvent").mockResolvedValue();
      const knex = require("../src/db/connection");

      // Simulate count >= threshold
      const countChain = {
        join: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        count: jest.fn().mockReturnThis(),
        first: jest.fn().mockResolvedValue({ cnt: emailTracking.HARD_BOUNCE_THRESHOLD }),
      };
      const insertChain = {
        insert: jest.fn().mockResolvedValue([1]),
        onConflict: jest.fn().mockReturnThis(),
        ignore: jest.fn().mockResolvedValue(undefined),
      };

      knex
        .mockReturnValueOnce({ insert: jest.fn().mockResolvedValue([1]) }) // recordEvent email_events
        .mockReturnValueOnce(countChain) // count query
        .mockReturnValueOnce(insertChain); // insert unsubscribe

      const result = await emailTracking.handleBounce(
        "test@example.com",
        "eid2",
        "hard",
        "no such user",
      );
      expect(result.suppressed).toBe(true);
      recordSpy.mockRestore();
    });
  });

  describe("isSuppressed()", () => {
    it("returns false when no unsubscribe record exists", async () => {
      const knex = require("../src/db/connection");
      const chain = {
        where: jest.fn().mockReturnThis(),
        whereIn: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([]),
      };
      knex.mockReturnValueOnce(chain);
      const result = await emailTracking.isSuppressed("a@b.com");
      expect(result).toBe(false);
    });

    it("returns true when unsubscribe record exists", async () => {
      const knex = require("../src/db/connection");
      const chain = {
        where: jest.fn().mockReturnThis(),
        whereIn: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([{ id: 1 }]),
      };
      knex.mockReturnValueOnce(chain);
      const result = await emailTracking.isSuppressed("a@b.com");
      expect(result).toBe(true);
    });
  });

  describe("getEvents()", () => {
    it("returns ordered events for an emailId", async () => {
      const knex = require("../src/db/connection");
      const mockEvents = [
        { event_type: "sent", timestamp: "2026-01-01", user_agent: null, ip: null, metadata: null },
        { event_type: "opened", timestamp: "2026-01-02", user_agent: "Mozilla", ip: "1.1.1.1", metadata: null },
      ];
      const chain = {
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        select: jest.fn().mockResolvedValue(mockEvents),
      };
      knex.mockReturnValueOnce(chain);
      const events = await emailTracking.getEvents("eid1");
      expect(events).toHaveLength(2);
      expect(events[0].event_type).toBe("sent");
    });
  });
});
