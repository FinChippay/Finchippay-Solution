/**
 * #157 — real-time balance over Server-Sent Events.
 *
 * Horizon and the cache are stubbed so the tests exercise the SSE framing,
 * the auth surface, and the one-Horizon-stream-per-account fan-out without
 * touching the network.
 */
"use strict";

const express = require("express");
const http = require("http");
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../src/middleware/auth");

const ME = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA";
const OTHER = "GDUKMGUGDZQK6YHYA5Z6AY2G4XDSZPSZ3SW5UN3ARVMO6QSRDWP5YLEX";

// ─── Horizon stub ─────────────────────────────────────────────────────────────

const horizonStreams = [];

jest.mock("../src/config/stellar", () => {
  const builder = {
    forAccount: jest.fn(() => builder),
    cursor: jest.fn(() => builder),
    stream: jest.fn((handlers) => {
      const close = jest.fn();
      horizonStreams.push({ handlers, close });
      return close;
    }),
  };
  return {
    HORIZON_URL: "https://horizon-testnet.stellar.org",
    server: { payments: jest.fn(() => builder) },
  };
});

jest.mock("../src/services/cacheService", () => ({
  get: jest.fn(async () => null),
  set: jest.fn(async () => undefined),
  del: jest.fn(async () => undefined),
}));

const balances = { current: "100.0000000" };
jest.mock("../src/services/stellarService", () => ({
  getXLMBalance: jest.fn(async () => balances.current),
  getAccount: jest.fn(),
  getPayments: jest.fn(),
  validatePublicKey: jest.fn(),
}));

const accountRoutes = require("../src/routes/accounts");
const balanceStreamService = require("../src/services/balanceStreamService");
const stellarService = require("../src/services/stellarService");

// ─── Raw SSE client ───────────────────────────────────────────────────────────
// supertest buffers the whole response, which never ends for a stream, so these
// tests drive a real socket and read frames as they arrive.

function listen() {
  const app = express();
  app.use("/api/accounts", accountRoutes);
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function tokenFor(publicKey) {
  return jwt.sign({ publicKey }, JWT_SECRET, { expiresIn: "1h" });
}

/**
 * Open an SSE connection and collect frames.
 * @returns {Promise<{ statusCode, headers, frames, waitFor, close }>}
 */
function openStream(server, path) {
  const { port } = server.address();

  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path, method: "GET" },
      (res) => {
        const frames = [];
        const waiters = [];
        let buffer = "";

        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          buffer += chunk;
          let index;
          while ((index = buffer.indexOf("\n\n")) !== -1) {
            frames.push(buffer.slice(0, index));
            buffer = buffer.slice(index + 2);
          }
          for (const waiter of waiters.splice(0)) waiter();
        });

        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          frames,
          /** Resolve once `predicate(frames)` holds, or reject after 3s. */
          waitFor(predicate) {
            return new Promise((res2, rej2) => {
              const check = () => {
                if (predicate(frames)) {
                  clearTimeout(timer);
                  return res2(frames);
                }
                waiters.push(check);
              };
              const timer = setTimeout(
                () => rej2(new Error(`Timed out. Frames: ${JSON.stringify(frames)}`)),
                3000,
              );
              check();
            });
          },
          close: () => {
            req.destroy();
            res.destroy();
          },
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function parseFrame(frame) {
  const event = /^event: (.+)$/m.exec(frame);
  const data = /^data: (.+)$/m.exec(frame);
  return {
    event: event?.[1],
    data: data ? JSON.parse(data[1]) : null,
  };
}

function eventsOf(frames, name) {
  return frames.map(parseFrame).filter((f) => f.event === name);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/accounts/:publicKey/stream (#157)", () => {
  let server;

  beforeEach(async () => {
    horizonStreams.length = 0;
    balances.current = "100.0000000";
    jest.clearAllMocks();
    balanceStreamService.closeAll();
    server = await listen();
  });

  afterEach(async () => {
    balanceStreamService.closeAll();
    await new Promise((resolve) => server.close(resolve));
  });

  it("rejects a request with no token", async () => {
    const stream = await openStream(server, `/api/accounts/${ME}/stream`);
    expect(stream.statusCode).toBe(401);
    stream.close();
  });

  it("rejects streaming another account's balance", async () => {
    const stream = await openStream(
      server,
      `/api/accounts/${OTHER}/stream?token=${tokenFor(ME)}`,
    );
    expect(stream.statusCode).toBe(403);
    stream.close();
  });

  it("accepts the JWT from the query string, which EventSource cannot send as a header", async () => {
    const stream = await openStream(
      server,
      `/api/accounts/${ME}/stream?token=${tokenFor(ME)}`,
    );

    expect(stream.statusCode).toBe(200);
    expect(stream.headers["content-type"]).toContain("text/event-stream");
    expect(stream.headers["cache-control"]).toContain("no-cache");
    expect(stream.headers["connection"]).toBe("keep-alive");
    expect(stream.headers["x-accel-buffering"]).toBe("no");

    stream.close();
  });

  it("pushes the current balance as soon as the connection opens", async () => {
    const stream = await openStream(
      server,
      `/api/accounts/${ME}/stream?token=${tokenFor(ME)}`,
    );

    await stream.waitFor((frames) => eventsOf(frames, "balance").length >= 1);

    const [first] = eventsOf(stream.frames, "balance");
    expect(first.data).toMatchObject({ publicKey: ME, xlm: "100.0000000" });

    stream.close();
  });

  it("pushes a fresh balance when Horizon reports a payment", async () => {
    const stream = await openStream(
      server,
      `/api/accounts/${ME}/stream?token=${tokenFor(ME)}`,
    );
    await stream.waitFor((frames) => eventsOf(frames, "balance").length >= 1);

    balances.current = "142.5000000";
    horizonStreams[0].handlers.onmessage({ id: "1", type: "payment" });

    await stream.waitFor((frames) => eventsOf(frames, "balance").length >= 2);

    const balanceEvents = eventsOf(stream.frames, "balance");
    expect(balanceEvents[balanceEvents.length - 1].data.xlm).toBe("142.5000000");

    stream.close();
  });

  it("forwards a Horizon stream failure as a stream-error event", async () => {
    const stream = await openStream(
      server,
      `/api/accounts/${ME}/stream?token=${tokenFor(ME)}`,
    );
    await stream.waitFor((frames) => eventsOf(frames, "balance").length >= 1);

    horizonStreams[0].handlers.onerror(new Error("horizon down"));

    await stream.waitFor((frames) => eventsOf(frames, "stream-error").length >= 1);
    expect(eventsOf(stream.frames, "stream-error")[0].data.message).toMatch(
      /Horizon/i,
    );

    stream.close();
  });

  it("reports an unfunded account as a stream-error rather than a broken stream", async () => {
    const notFound = new Error("Account not found");
    notFound.status = 404;
    stellarService.getXLMBalance.mockRejectedValueOnce(notFound);

    const stream = await openStream(
      server,
      `/api/accounts/${ME}/stream?token=${tokenFor(ME)}`,
    );

    await stream.waitFor((frames) => eventsOf(frames, "stream-error").length >= 1);
    expect(eventsOf(stream.frames, "stream-error")[0].data.message).toMatch(
      /not found/i,
    );

    stream.close();
  });

  it("shares one Horizon stream between multiple tabs on the same account", async () => {
    const token = tokenFor(ME);
    const tabOne = await openStream(server, `/api/accounts/${ME}/stream?token=${token}`);
    await tabOne.waitFor((frames) => eventsOf(frames, "balance").length >= 1);

    const tabTwo = await openStream(server, `/api/accounts/${ME}/stream?token=${token}`);
    await tabTwo.waitFor((frames) => eventsOf(frames, "balance").length >= 1);

    expect(horizonStreams).toHaveLength(1);
    expect(balanceStreamService.activeStreamCount()).toBe(1);
    expect(balanceStreamService.subscriberCount(ME)).toBe(2);

    // Both tabs receive the same push.
    balances.current = "7.0000000";
    horizonStreams[0].handlers.onmessage({ id: "1", type: "payment" });

    await tabOne.waitFor((frames) => eventsOf(frames, "balance").length >= 2);
    await tabTwo.waitFor((frames) => eventsOf(frames, "balance").length >= 2);

    tabOne.close();
    tabTwo.close();
  });

  it("closes the Horizon stream once the last client disconnects", async () => {
    const token = tokenFor(ME);
    const tabOne = await openStream(server, `/api/accounts/${ME}/stream?token=${token}`);
    await tabOne.waitFor((frames) => eventsOf(frames, "balance").length >= 1);
    const tabTwo = await openStream(server, `/api/accounts/${ME}/stream?token=${token}`);
    await tabTwo.waitFor((frames) => eventsOf(frames, "balance").length >= 1);

    tabOne.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(horizonStreams[0].close).not.toHaveBeenCalled();
    expect(balanceStreamService.subscriberCount(ME)).toBe(1);

    tabTwo.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(horizonStreams[0].close).toHaveBeenCalled();
    expect(balanceStreamService.activeStreamCount()).toBe(0);
  });

  it("drops the cached account before reading the balance for a payment event", async () => {
    const cache = require("../src/services/cacheService");
    const stream = await openStream(
      server,
      `/api/accounts/${ME}/stream?token=${tokenFor(ME)}`,
    );
    await stream.waitFor((frames) => eventsOf(frames, "balance").length >= 1);

    horizonStreams[0].handlers.onmessage({ id: "1", type: "payment" });
    await stream.waitFor((frames) => eventsOf(frames, "balance").length >= 2);

    expect(cache.del).toHaveBeenCalledWith(`account:${ME}`);

    stream.close();
  });

  it("collapses a burst of payment events into fewer Horizon reads", async () => {
    const stream = await openStream(
      server,
      `/api/accounts/${ME}/stream?token=${tokenFor(ME)}`,
    );
    await stream.waitFor((frames) => eventsOf(frames, "balance").length >= 1);

    const callsBefore = stellarService.getXLMBalance.mock.calls.length;
    for (let i = 0; i < 10; i += 1) {
      horizonStreams[0].handlers.onmessage({ id: String(i), type: "payment" });
    }

    await stream.waitFor((frames) => eventsOf(frames, "balance").length >= 2);
    await new Promise((resolve) => setTimeout(resolve, 100));

    const extraCalls = stellarService.getXLMBalance.mock.calls.length - callsBefore;
    expect(extraCalls).toBeLessThan(10);

    stream.close();
  });
});
