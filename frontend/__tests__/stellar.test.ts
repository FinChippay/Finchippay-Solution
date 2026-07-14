import { TransactionCategory } from "@/lib/stellar";

describe("Stellar helper", () => {
  it("exposes transaction categories used by payment history", () => {
    expect(TransactionCategory.Payment).toBe("Payment");
    expect(TransactionCategory.Merge).toBe("Merge");
  });
});
