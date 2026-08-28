"use strict";

const express = require("express");
const crypto = require("crypto");
const balanceStreamService = require("../services/balanceStreamService");
const stellarService = require("../services/stellarService");
const cacheService = require("../services/cacheService");

const router = express.Router();

// Simple in-memory event buffer per connection for Last-Event-ID replay (max 100)
const eventBuffer = [];
let eventIdCounter = 0;

function bufferEvent(publicKey, eventType, data) {
  eventIdCounter++;
  const eventObj = {
    id: eventIdCounter,
    publicKey,
    type: eventType,
    data,
  };
  eventBuffer.push(eventObj);
  if (eventBuffer.length > 100) {
    eventBuffer.shift();
  }
  return eventObj;
}

// Generate a single-use, short-lived stream ticket
router.post("/:publicKey/ticket", async (req, res) => {
  try {
    const publicKey = req.params.publicKey;
    // Generate a random 32-byte hex string for the ticket
    const ticket = crypto.randomBytes(32).toString("hex");
    
    // Store ticket in cache for 30 seconds, associated with this publicKey
    await cacheService.set(`stream_ticket:${ticket}`, publicKey, 30);
    
    res.json({ ticket });
  } catch (err) {
    res.status(500).json({ error: "Failed to generate stream ticket" });
  }
});

router.get("/:publicKey", async (req, res) => {
  const publicKey = req.params.publicKey;
  const ticket = req.query.ticket;

  if (!ticket) {
    return res.status(401).json({ error: "Stream ticket is required" });
  }

  try {
    const cachedKey = await cacheService.get(`stream_ticket:${ticket}`);
    
    // Verify the ticket exists and matches the requested public key
    if (!cachedKey || cachedKey !== publicKey) {
      return res.status(401).json({ error: "Invalid or expired stream ticket" });
    }

    // Invalidate the ticket immediately to ensure single-use
    await cacheService.del(`stream_ticket:${ticket}`);
  } catch (err) {
    return res.status(500).json({ error: "Internal server error validating ticket" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const lastEventId = req.headers["last-event-id"]
    ? parseInt(req.headers["last-event-id"], 10)
    : null;

  // Replay missed events if Last-Event-ID is provided
  if (lastEventId) {
    const missedEvents = eventBuffer.filter((e) => e.publicKey === publicKey && e.id > lastEventId);
    for (const ev of missedEvents) {
      res.write(`id: ${ev.id}\n`);
      res.write(`event: ${ev.type}\n`);
      res.write(`data: ${JSON.stringify(ev.data)}\n\n`);
    }
  }

  // Send initial balance
  try {
    const initialBalance = await stellarService.getXLMBalance(publicKey);
    const initEv = bufferEvent(publicKey, "balance", {
      publicKey,
      xlm: initialBalance,
      updatedAt: Date.now(),
    });
    res.write(`id: ${initEv.id}\n`);
    res.write(`event: balance\n`);
    res.write(`data: ${JSON.stringify(initEv.data)}\n\n`);
  } catch {
    // Initial fetch error ignored; stream will update on event
  }

  // Set up heartbeat timer (15s)
  const heartbeatTimer = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 15000);

  // Subscribe to balanceStreamService
  const unsubscribe = balanceStreamService.subscribe(publicKey, {
    onBalance: (data) => {
      const ev = bufferEvent(publicKey, "balance", data);
      res.write(`id: ${ev.id}\n`);
      res.write(`event: balance\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    },
    onError: (err) => {
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify(err)}\n\n`);
    },
  });

  req.on("close", () => {
    clearInterval(heartbeatTimer);
    unsubscribe();
  });
});

module.exports = router;