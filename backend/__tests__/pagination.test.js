/**
 * __tests__/pagination.test.js
 * Tests for the standardized cursor-based pagination layer (#74):
 *   - utils/paginate cursor encode/decode + page building
 *   - middleware/pagination limit/cursor parsing and caps
 *   - RFC 5988 Link + X-Total-Count headers on paginated responses
 *   - end-to-end cursor navigation on the tips and events endpoints
 */

"use strict";

const express = require("express");
const request = require("supertest");

const {
  encodeCursor,
  decodeCursor,
  buildPage,
  paginateInMemory,
  setPaginationHeaders,
  InvalidCursorError,
} = require("../src/utils/paginate");
const { pagination } = require("../src/middleware/pagination");

jest.mock("../src/services/tipsService");
const tipsService = require("../src/services/tipsService");

jest.mock("../src/services/stellarService");
const stellarService = require("../src/services/stellarService");

// ─── Unit: cursor codec ────────────────────────────────────────────────────────
describe("cursor codec", () => {
  it("round-trips sort-key fields through an opaque cursor", () => {
    const fields = { created_at: "2026-01-02T03:04:05.000Z", id: 42 };
    const cursor = encodeCursor(fields);
    expect(typeof cursor).toBe("string");
    expect(cursor).not.toContain("{"); // opaque, not raw JSON
    expect(decodeCursor(cursor)).toEqual(fields);
  });

  it("throws InvalidCursorError on a malformed cursor", () => {
    expect(() => decodeCursor("!!!not-base64-json!!!")).toThrow(
      InvalidCursorError,
    );
    expect(() => decodeCursor("")).toThrow(InvalidCursorError);
    // base64 of a non-object JSON value is rejected too
    expect(() => decodeCursor(encodeCursor([1, 2, 3]))).toThrow(
      InvalidCursorError,
    );
  });
});

// ─── Unit: buildPage ───────────────────────────────────────────────────────────
describe("buildPage", () => {
  const cursorOf = (r) => ({ id: r.id });

  it("returns a nextCursor only when more rows exist than the limit", () => {
    const rows = [{ id: 1 }, { id: 2 }, { id: 3 }]; // limit+1 fetched
    const { data, nextCursor } = buildPage(rows, 2, cursorOf);
    expect(data).toHaveLength(2);
    expect(decodeCursor(nextCursor)).toEqual({ id: 2 });
  });

  it("returns null nextCursor on the last page", () => {
    const rows = [{ id: 1 }, { id: 2 }]; // exactly limit
    const { data, nextCursor } = buildPage(rows, 2, cursorOf);
    expect(data).toHaveLength(2);
    expect(nextCursor).toBeNull();
  });
});

// ─── Unit: paginateInMemory (used by webhooks / scheduled) ─────────────────────
describe("paginateInMemory", () => {
  const cursorOf = (r) => ({ id: r.id });
  const desc = (a, b) => b.id - a.id;
  const rows = [{ id: 1 }, { id: 3 }, { id: 2 }]; // unsorted

  it("sorts, slices to the limit, and reports the true total", () => {
    const { data, nextCursor, total } = paginateInMemory(
      rows,
      { limit: 2, cursor: null },
      cursorOf,
      desc,
    );
    expect(data.map((r) => r.id)).toEqual([3, 2]);
    expect(total).toBe(3);
    expect(decodeCursor(nextCursor)).toEqual({ id: 2 });
  });

  it("seeks past the cursor row and stops without a nextCursor", () => {
    const { data, nextCursor } = paginateInMemory(
      rows,
      { limit: 2, cursor: { id: 2 } },
      cursorOf,
      desc,
    );
    expect(data.map((r) => r.id)).toEqual([1]);
    expect(nextCursor).toBeNull();
  });
});

// ─── Unit: pagination middleware ───────────────────────────────────────────────
describe("pagination middleware", () => {
  function run(query) {
    const req = { query };
    const res = {
      statusCode: 200,
      body: undefined,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      },
    };
    let nextCalled = false;
    pagination(req, res, () => {
      nextCalled = true;
    });
    return { req, res, nextCalled };
  }

  it("defaults limit to 20 and cursor to null", () => {
    const { req, nextCalled } = run({});
    expect(nextCalled).toBe(true);
    expect(req.pagination).toEqual({ limit: 20, cursor: null });
  });

  it("caps limit at 100 server-side", () => {
    const { req } = run({ limit: "500" });
    expect(req.pagination.limit).toBe(100);
  });

  it("rejects a non-positive / non-integer limit with VAL_INVALID_LIMIT", () => {
    for (const bad of ["0", "-1", "abc"]) {
      const { res, nextCalled } = run({ limit: bad });
      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(400);
      expect(res.body.error.code).toBe("VAL_INVALID_LIMIT");
    }
  });

  it("decodes a valid cursor and rejects a malformed one", () => {
    const good = run({ cursor: encodeCursor({ id: 7 }) });
    expect(good.req.pagination.cursor).toEqual({ id: 7 });

    const bad = run({ cursor: "@@@" });
    expect(bad.res.statusCode).toBe(400);
    expect(bad.res.body.error.code).toBe("VAL_INVALID_CURSOR");
  });
});

// ─── Unit: response headers ────────────────────────────────────────────────────
describe("setPaginationHeaders", () => {
  function fakeRes() {
    const headers = {};
    return {
      headers,
      setHeader(k, v) {
        headers[k] = v;
      },
      getHeader(k) {
        return headers[k];
      },
    };
  }

  it("always sets X-Total-Count and adds a rel=next Link when a cursor exists", () => {
    const req = { baseUrl: "/api/tips", path: "/received/GABC", query: {} };
    const res = fakeRes();
    setPaginationHeaders(req, res, {
      nextCursor: "CURSOR123",
      total: 57,
      limit: 20,
    });
    expect(res.getHeader("X-Total-Count")).toBe("57");
    expect(res.getHeader("Link")).toBe(
      '</api/tips/received/GABC?cursor=CURSOR123&limit=20>; rel="next"',
    );
    expect(res.getHeader("Access-Control-Expose-Headers")).toContain("Link");
  });

  it("omits the Link header on the last page", () => {
    const req = { baseUrl: "/api/tips", path: "/received/GABC", query: {} };
    const res = fakeRes();
    setPaginationHeaders(req, res, { nextCursor: null, total: 3, limit: 20 });
    expect(res.getHeader("X-Total-Count")).toBe("3");
    expect(res.getHeader("Link")).toBeUndefined();
  });
});

// ─── Integration: tips endpoint keyset navigation ──────────────────────────────
describe("GET /api/tips/received/:creatorPublicKey (keyset)", () => {
  const CREATOR = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA";

  // 3 tips, newest first; the service returns up to limit+1 rows.
  const ALL = [
    { id: 3, timestamp: "2026-01-03T00:00:00.000Z", amount: "3" },
    { id: 2, timestamp: "2026-01-02T00:00:00.000Z", amount: "2" },
    { id: 1, timestamp: "2026-01-01T00:00:00.000Z", amount: "1" },
  ];

  function app() {
    const server = express();
    server.use("/api/tips", require("../src/routes/tips"));
    return server;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    tipsService.getTipsStats.mockResolvedValue({ totalTips: 3 });
    tipsService.getTipsReceived.mockImplementation((_pk, { limit, cursor }) => {
      let rows = ALL;
      if (cursor) {
        rows = ALL.filter(
          (t) =>
            t.timestamp < cursor.created_at ||
            (t.timestamp === cursor.created_at && t.id < cursor.id),
        );
      }
      return Promise.resolve({
        tips: rows.slice(0, limit + 1),
        total: ALL.length,
      });
    });
  });

  it("returns the first page with a Link + X-Total-Count header", async () => {
    const res = await request(app()).get(
      `/api/tips/received/${CREATOR}?limit=2`,
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].id).toBe(3);
    expect(res.headers["x-total-count"]).toBe("3");
    expect(res.headers.link).toMatch(/rel="next"/);
    expect(res.body.pagination.nextCursor).toBeTruthy();
  });

  it("follows nextCursor to a disjoint second page and stops", async () => {
    const first = await request(app()).get(
      `/api/tips/received/${CREATOR}?limit=2`,
    );
    const cursor = first.body.pagination.nextCursor;

    const second = await request(app()).get(
      `/api/tips/received/${CREATOR}?limit=2&cursor=${encodeURIComponent(cursor)}`,
    );
    expect(second.status).toBe(200);
    // Only tip id=1 remains — no overlap with page 1 (ids 3,2).
    expect(second.body.data.map((t) => t.id)).toEqual([1]);
    expect(second.body.pagination.nextCursor).toBeNull();
    expect(second.headers.link).toBeUndefined();
  });
});

// ─── Integration: payments endpoint (Horizon paging token as cursor) ───────────
describe("GET /api/payments/:publicKey (Horizon cursor alignment)", () => {
  const ACCOUNT = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA";

  function app() {
    const server = express();
    server.use("/api/payments", require("../src/routes/payments"));
    return server;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    stellarService.countPaymentsApprox.mockResolvedValue(57);
  });

  it("emits a rel=next Link (from the last paging token) + X-Total-Count on a full page", async () => {
    // A full page (length === limit) implies there may be more.
    stellarService.getPayments.mockResolvedValue([
      { id: "op1", pagingToken: "111", amount: "1" },
      { id: "op2", pagingToken: "222", amount: "2" },
    ]);

    const res = await request(app()).get(`/api/payments/${ACCOUNT}?limit=2`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.headers["x-total-count"]).toBe("57");
    // nextCursor is Horizon's paging token on the last record.
    expect(res.body.pagination.nextCursor).toBe("222");
    expect(res.headers.link).toBe(
      '</api/payments/GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA?cursor=222&limit=2>; rel="next"',
    );
  });

  it("omits the Link header on a short (last) page but still sets X-Total-Count", async () => {
    // Fewer rows than the limit → last page, no next cursor.
    stellarService.getPayments.mockResolvedValue([
      { id: "op1", pagingToken: "111", amount: "1" },
    ]);

    const res = await request(app()).get(`/api/payments/${ACCOUNT}?limit=2`);
    expect(res.status).toBe(200);
    expect(res.body.pagination.nextCursor).toBeNull();
    expect(res.headers.link).toBeUndefined();
    expect(res.headers["x-total-count"]).toBe("57");
  });
});
