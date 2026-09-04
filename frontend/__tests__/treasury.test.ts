/**
 * __tests__/treasury.test.ts
 * Unit tests for the treasury data layer (fetchAdminProposals,
 * fetchPaymentProposals, fetchTreasuryOverview, normalizeStatus).
 */

import type { AdminActionProposal, MultiSigProposal } from "@/lib/soroban";
import {
  fetchAdminProposals,
  fetchPaymentProposals,
  fetchTreasuryOverview,
  normalizeStatus,
  ADMIN_ACTION_LABELS,
  type TreasuryProposal,
} from "@/lib/treasury";

const adminProposal: AdminActionProposal = {
  id: 2,
  actionType: "pause",
  actionData: [],
  approvals: ["GAAA", "GBBB"],
  threshold: 3,
  executed: false,
  expirationLedger: 120960,
};

const adminProposal2: AdminActionProposal = {
  id: 1,
  actionType: "upgrade",
  actionData: ["WASMHASH", 2],
  approvals: ["GAAA"],
  threshold: 2,
  executed: false,
  expirationLedger: 120960,
};

const paymentProposal: MultiSigProposal = {
  id: 5,
  proposer: "GAAA",
  recipient: "GCCC",
  token: "native",
  amount: "100",
  threshold: 2,
  signers: ["GAAA", "GDDD"],
  approvals: ["GAAA"],
  status: "Pending",
  expirationLedger: 0,
  from: "GAAA",
  to: "GCCC",
  executed: false,
  cancelled: false,
};

function makeClient(overrides: Record<string, unknown> = {}) {
  return {
    getAdminActionProposal: async (id: number) => {
      if (id === 1) return adminProposal2;
      if (id === 2) return adminProposal;
      return null;
    },
    getMultisigCount: async () => 5,
    getMultisig: async (id: number) => (id === 5 ? paymentProposal : null),
    getAdminSigners: async () => ["GAAA", "GBBB"],
    getAdminSignersThreshold: async () => 3,
    ...overrides,
  } as unknown as Parameters<typeof fetchTreasuryOverview>[1] & {
    getAdminActionProposal: (id: number) => Promise<AdminActionProposal | null>;
  };
}

describe("normalizeStatus", () => {
  it("maps contract status strings to stable UI tokens", () => {
    expect(normalizeStatus("Pending")).toBe("pending");
    expect(normalizeStatus("Executed")).toBe("executed");
    expect(normalizeStatus("Cancelled")).toBe("cancelled");
    expect(normalizeStatus("executed", true)).toBe("executed");
    expect(normalizeStatus("pending", true)).toBe("executed");
  });
});

describe("fetchAdminProposals", () => {
  it("probes contiguous ids and stops at the first miss", async () => {
    const client = makeClient();
    const result = await fetchAdminProposals(client as never, "GAAA");
    expect(result.map((p) => p.id)).toEqual([1, 2]);
  });

  it("tolerates RPC errors as missing proposals", async () => {
    const client = makeClient({
      getAdminActionProposal: async () => {
        throw new Error("RPC timeout");
      },
    });
    const result = await fetchAdminProposals(client as never, "GAAA");
    expect(result).toEqual([]);
  });
});

describe("fetchPaymentProposals", () => {
  it("lists proposals 1..count", async () => {
    const client = makeClient();
    const result = await fetchPaymentProposals(client as never, "GAAA");
    expect(result.map((p) => p.id)).toEqual([5]);
  });
});

describe("fetchTreasuryOverview", () => {
  it("combines admin and payment proposals with admin signers/threshold", async () => {
    const client = makeClient();
    const overview = await fetchTreasuryOverview("GAAA", client as never);

    expect(overview.adminSigners).toEqual(["GAAA", "GBBB"]);
    expect(overview.adminThreshold).toBe(3);

    // Admin proposals surface first (2 then 1), then payment (5).
    expect(overview.proposals.map((p) => `${p.kind}:${p.id}`)).toEqual([
      "admin:2",
      "admin:1",
      "payment:5",
    ]);

    const admin = overview.proposals.find((p) => p.kind === "admin" && p.id === 2);
    expect(admin).toBeDefined();
    expect(admin?.actionType).toBe("pause");
    expect(admin?.approvals).toEqual(["GAAA", "GBBB"]);
    expect(admin?.threshold).toBe(3);
    expect(admin?.status).toBe("pending");
    expect(admin?.proposer).toBe("GAAA");
  });

  it("surfaces executed admin proposals as executed", async () => {
    const executed: AdminActionProposal = {
      ...adminProposal,
      id: 3,
      executed: true,
    };
    const client = makeClient({
      getAdminActionProposal: async (id: number) => {
        if (id === 3) return executed;
        return null;
      },
    });
    const overview = await fetchTreasuryOverview(undefined, client as never);
    expect(overview.proposals[0].status).toBe("executed");
  });

  it("handles empty contract state", async () => {
    const client = makeClient({
      getAdminActionProposal: async () => null,
      getMultisigCount: async () => 0,
      getMultisig: async () => null,
    });
    const overview = await fetchTreasuryOverview(undefined, client as never);
    expect(overview.proposals).toEqual([]);
  });
});

describe("ADMIN_ACTION_LABELS", () => {
  it("exposes readable labels for known action types", () => {
    expect(ADMIN_ACTION_LABELS.pause).toBe("Pause Contract");
    expect(ADMIN_ACTION_LABELS.upgrade).toBe("Upgrade Contract");
  });
});

// Ensure the type is re-exported cleanly for consumers.
const _typeCheck: TreasuryProposal["status"] = "pending";
void _typeCheck;
