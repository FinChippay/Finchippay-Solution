import {
  TransactionCategory,
  formatStroopsToXlm,
  getFeeEstimate,
  isHorizonAccountNotFoundError,
  toHorizonUnavailableError,
} from "@/lib/stellar";

describe("Stellar helper", () => {
  it("exposes transaction categories used by payment history", () => {
    expect(TransactionCategory.Payment).toBe("Payment");
    expect(TransactionCategory.Merge).toBe("Merge");
  });

  describe("formatStroopsToXlm", () => {
    it("converts bigint and number stroops to formatted XLM string", () => {
      expect(formatStroopsToXlm(10_000n)).toBe("0.0010000");
      expect(formatStroopsToXlm(10_000_000n)).toBe("1.0000000");
      expect(formatStroopsToXlm(100)).toBe("0.0000100");
    });
  });

  describe("Horizon account lookup errors (#913)", () => {
    it("recognizes a Horizon 404 response as an unfunded destination", () => {
      expect(isHorizonAccountNotFoundError({ response: { status: 404 } })).toBe(true);
    });

    it("recognizes a top-level 404 status as an unfunded destination", () => {
      expect(isHorizonAccountNotFoundError({ status: 404 })).toBe(true);
    });

    it("recognizes Horizon's not_found problem type", () => {
      expect(isHorizonAccountNotFoundError({ response: { data: { type: "not_found" } } })).toBe(true);
    });

    it("does not classify transient failures as an unfunded destination", () => {
      expect(isHorizonAccountNotFoundError({ response: { status: 500 } })).toBe(false);
      expect(isHorizonAccountNotFoundError(new Error("socket timeout"))).toBe(false);
    });

    it("converts transient failures into a retryable error and preserves the cause", () => {
      const timeout = new Error("socket timeout");
      const unavailable = toHorizonUnavailableError(timeout);

      expect(unavailable.message).toBe("Horizon unavailable, please retry");
      expect(unavailable.cause).toBe(timeout);
    });
  });

  describe("getFeeEstimate (#722)", () => {
    it("returns correct fee estimate for estimate_send_tip", async () => {
      const estimate = await getFeeEstimate("estimate_send_tip", {
        token: "CAS3J7GYCCXGRMV5TACBX2FPGEVOVladj7s89dfa",
        amount: "1000000",
      });

      expect(estimate).toEqual({
        cpu_instructions: 500_000n,
        ledger_read_bytes: 1_500,
        ledger_write_bytes: 500,
        estimated_stroops: 10_000n,
      });
    });

    it("returns correct fee estimate for estimate_create_escrow", async () => {
      const estimate = await getFeeEstimate("estimate_create_escrow", {
        amount: "5000000",
        release_ledger: 123456,
      });

      expect(estimate).toEqual({
        cpu_instructions: 750_000n,
        ledger_read_bytes: 2_000,
        ledger_write_bytes: 1_000,
        estimated_stroops: 15_000n,
      });
    });

    it("returns correct fee estimate for estimate_open_stream", async () => {
      const estimate = await getFeeEstimate("estimate_open_stream", {
        rate: "100",
        deposit: "100000",
      });

      expect(estimate).toEqual({
        cpu_instructions: 750_000n,
        ledger_read_bytes: 2_000,
        ledger_write_bytes: 1_000,
        estimated_stroops: 15_000n,
      });
    });

    it("scales estimate_batch_send linearly with recipient_count", async () => {
      const single = await getFeeEstimate("estimate_batch_send", { recipient_count: 1 });
      const five = await getFeeEstimate("estimate_batch_send", { recipient_count: 5 });

      expect(single.cpu_instructions).toBe(550_000n);
      expect(single.ledger_read_bytes).toBe(1_500);
      expect(single.ledger_write_bytes).toBe(600);
      expect(single.estimated_stroops).toBe(10_000n);

      expect(five.cpu_instructions).toBe(1_550_000n);
      expect(five.ledger_read_bytes).toBe(3_500);
      expect(five.ledger_write_bytes).toBe(1_800);
      expect(five.estimated_stroops).toBe(30_000n);

      // Verify exact linear difference matching contract spec
      expect(five.cpu_instructions - single.cpu_instructions).toBe(4n * 250_000n);
      expect(five.estimated_stroops - single.estimated_stroops).toBe(4n * 5_000n);
    });

    it("accepts array of recipients or camelCase recipientCount for batch send", async () => {
      const fromArray = await getFeeEstimate("estimate_batch_send", {
        recipients: [
          { to: "A", amount: "10" },
          { to: "B", amount: "20" },
          { to: "C", amount: "30" },
        ],
      });
      const fromCamel = await getFeeEstimate("estimate_batch_send", { recipientCount: 3 });

      expect(fromArray).toEqual(fromCamel);
      expect(fromArray.cpu_instructions).toBe(300_000n + 3n * 250_000n);
      expect(fromArray.estimated_stroops).toBe(5_000n + 3n * 5_000n);
    });

    it("scales estimate_create_multisig with signers count", async () => {
      const single = await getFeeEstimate("estimate_create_multisig", { signers_count: 1 });
      const three = await getFeeEstimate("estimate_create_multisig", { signersCount: 3 });

      expect(single.cpu_instructions).toBe(500_000n);
      expect(single.ledger_read_bytes).toBe(1_400);
      expect(single.ledger_write_bytes).toBe(700);
      expect(single.estimated_stroops).toBe(10_000n);

      expect(three.cpu_instructions).toBe(700_000n);
      expect(three.ledger_read_bytes).toBe(1_800);
      expect(three.ledger_write_bytes).toBe(900);
      expect(three.estimated_stroops).toBe(14_000n);
    });

    it("throws error for unsupported estimation method", async () => {
      await expect(getFeeEstimate("unsupported_method" as any, {})).rejects.toThrow(
        "Unsupported estimation method: unsupported_method",
      );
    });
  });
});
