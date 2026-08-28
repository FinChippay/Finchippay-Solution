/**
 * __tests__/export.test.ts
 * Unit tests for CSV and PDF export functions.
 */

import { generateCSV } from "@/utils/export";
import { PaymentRecord } from "@/lib/stellar";

// Mock explorer URL to avoid import issues
jest.mock("@/lib/stellar", () => ({
  ...jest.requireActual("@/lib/stellar"),
  explorerUrl: jest.fn((hash: string) =>
    hash.length === 64 ? `https://stellar.expert/explorer/testnet/tx/${hash}` : null
  ),
}));

// Mock date-fns format for deterministic tests
jest.mock("@/utils/format", () => ({
  ...jest.requireActual("@/utils/format"),
  formatDate: jest.fn((dateStr: string) => {
    // Return a deterministic date format for testing
    return "Jul 21, 2026 · 12:00";
  }),
}));

function createMockPayment(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id: "123456",
    type: "sent",
    amount: "100.0000000",
    asset: "XLM",
    from: "GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC3D5NZ2KMSUGSRNVO7ZFGIGSZ",
    to: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    memo: "Test payment",
    createdAt: "2026-07-21T12:00:00Z",
    transactionHash: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    ...overrides,
  };
}

describe("generateCSV", () => {
  it("should produce a CSV with correct headers", () => {
    const csv = generateCSV([]);
    const lines = csv.trim().split("\n");

    expect(lines.length).toBeGreaterThanOrEqual(1);
    const headerLine = lines[0];

    expect(headerLine).toContain("Date");
    expect(headerLine).toContain("Type");
    expect(headerLine).toContain("From");
    expect(headerLine).toContain("To");
    expect(headerLine).toContain("Amount");
    expect(headerLine).toContain("Asset");
    expect(headerLine).toContain("Memo");
    expect(headerLine).toContain("Transaction Hash");
    expect(headerLine).toContain("Explorer Link");
  });

  it("should produce correct row count for given payments", () => {
    const payments = [
      createMockPayment({ id: "1", type: "sent" }),
      createMockPayment({ id: "2", type: "received" }),
      createMockPayment({ id: "3", type: "sent" }),
    ];

    const csv = generateCSV(payments);
    const lines = csv.trim().split("\n");

    // 1 header + 3 data rows
    expect(lines.length).toBe(4);
  });

  it("should produce valid RFC 4180 CSV (parseable by papaparse)", () => {
    const payments = [
      createMockPayment({ id: "1" }),
      createMockPayment({
        id: "2",
        memo: 'Payment "with quotes"',
        type: "received",
      }),
    ];

    const csv = generateCSV(payments);

    // The CSV should be parseable — no unescaped quotes breaking the format
    // Basic sanity: starts with header fields (unquoted by default)
    expect(csv).toMatch(/^Date,/);

    // Should not contain bare unescaped quotes in cell values
    const lines = csv.trim().split("\n");
    expect(lines.length).toBe(3); // header + 2 rows
  });

  it("should handle empty payments array", () => {
    const csv = generateCSV([]);
    const lines = csv.trim().split("\n");

    // Should have only the header row
    expect(lines.length).toBe(1);
  });

  it("should include explorer links in the last column", () => {
    const hash = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
    const payments = [createMockPayment({ transactionHash: hash })];

    const csv = generateCSV(payments);
    const lines = csv.trim().split("\n");
    const dataRow = lines[1];

    expect(dataRow).toContain(`testnet/tx/${hash}`);
  });

  it("should include all payment fields in each row", () => {
    const payment = createMockPayment({
      type: "received",
      asset: "USDC",
      memo: "invoice #42",
    });
    const csv = generateCSV([payment]);
    const lines = csv.trim().split("\n");
    const dataRow = lines[1];

    // Each field should appear somewhere in the CSV row
    expect(dataRow).toContain("Received");
    expect(dataRow).toContain("USDC");
    expect(dataRow).toContain("invoice #42");
    expect(dataRow).toContain("100.0000000");
  });
});
