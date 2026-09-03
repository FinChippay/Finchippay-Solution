/* eslint-env jest */
/**
 * __tests__/notificationServiceQueueClaim.test.js
 *
 * Covers the atomic claim step of email_send_queue processing
 * (notificationService.claimQueuedEmails), used by processEmailQueue:
 * - Concurrent claims never select the same row twice
 * - Stale "processing" rows (crashed worker) are reclaimed
 * - Fresh "processing" rows are left alone
 * - Rows not yet due are left alone
 */

"use strict";

const crypto = require("crypto");
const knex = require("../src/db/connection");
const notificationService = require("../src/services/notificationService");

function makeQueueRow(overrides) {
  const id = crypto.randomUUID();
  return Object.assign(
    {
      email_id: id,
      to_address: "user@example.com",
      subject: "Test",
      html: "<p>hi</p>",
      text: "hi",
      template_type: "payment_received",
      status: "pending",
      attempts: 0,
      max_attempts: 3,
      next_attempt_at: new Date(Date.now() - 1000).toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    overrides,
  );
}

describe("email_send_queue atomic claim", () => {
  beforeEach(async () => {
    await knex("email_send_queue").delete();
  });

  afterAll(async () => {
    await knex.destroy();
  });

  test("claims due pending rows and flips them to processing", async () => {
    await knex("email_send_queue").insert([makeQueueRow({}), makeQueueRow({})]);

    const claimed = await notificationService.claimQueuedEmails(50);

    expect(claimed).toHaveLength(2);
    claimed.forEach((row) => {
      expect(row.status).toBe("processing");
      expect(row.locked_by).toBeTruthy();
      expect(row.locked_at).toBeTruthy();
    });
  });

  test("two concurrent claims never select the same row", async () => {
    const rows = Array.from({ length: 10 }, () => makeQueueRow({}));
    await knex("email_send_queue").insert(rows);

    const [batchA, batchB] = await Promise.all([
      notificationService.claimQueuedEmails(5),
      notificationService.claimQueuedEmails(5),
    ]);

    const idsA = batchA.map((row) => row.id);
    const idsB = batchB.map((row) => row.id);
    const overlap = idsA.filter((id) => idsB.includes(id));

    expect(overlap).toHaveLength(0);
    expect(idsA.length + idsB.length).toBe(10);
  });

  test("a crashed worker's stale processing row is reclaimed", async () => {
    const staleLockedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min ago
    await knex("email_send_queue").insert(
      makeQueueRow({
        status: "processing",
        locked_by: "dead-worker:123",
        locked_at: staleLockedAt,
      }),
    );

    const claimed = await notificationService.claimQueuedEmails(50);

    expect(claimed).toHaveLength(1);
    expect(claimed[0].locked_by).not.toBe("dead-worker:123");
  });

  test("a fresh processing row (recently locked) is not reclaimed", async () => {
    await knex("email_send_queue").insert(
      makeQueueRow({
        status: "processing",
        locked_by: "live-worker:456",
        locked_at: new Date().toISOString(),
      }),
    );

    const claimed = await notificationService.claimQueuedEmails(50);

    expect(claimed).toHaveLength(0);
  });

  test("rows not yet due are not claimed", async () => {
    await knex("email_send_queue").insert(
      makeQueueRow({
        next_attempt_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1h from now
      }),
    );

    const claimed = await notificationService.claimQueuedEmails(50);

    expect(claimed).toHaveLength(0);
  });
});
