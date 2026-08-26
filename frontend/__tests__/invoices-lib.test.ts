/**
 * Tests for lib/invoices.ts — localStorage persistence + summary helpers.
 * @jest-environment jsdom
 */
import {
  buildInvoiceNumber,
  createInvoice,
  deleteInvoice,
  INVOICES_STORAGE_KEY,
  loadInvoices,
  sendInvoiceReminder,
  summarizeInvoices,
  updateInvoiceStatus,
  type Invoice,
} from "@/lib/invoices";

const BASE_FORM = {
  recipient: "GABCDEF123",
  clientName: "Acme Corp",
  clientEmail: "billing@acme.test",
  description: "Consulting",
  amount: "250.5",
  asset: "USDC",
  dueDate: "2026-09-01",
};

describe("invoice persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("loadInvoices returns [] when nothing stored / on corrupt data", () => {
    expect(loadInvoices()).toEqual([]);
    localStorage.setItem(INVOICES_STORAGE_KEY, "{not-json");
    expect(loadInvoices()).toEqual([]);
    localStorage.setItem(INVOICES_STORAGE_KEY, JSON.stringify({ nope: true }));
    expect(loadInvoices()).toEqual([]);
  });

  it("createInvoice persists and assigns number + draft status", async () => {
    const inv = await createInvoice(BASE_FORM);
    expect(inv.status).toBe("draft");
    expect(inv.invoiceNumber).toBe("INV-00001");
    expect(inv.clientName).toBe("Acme Corp");
    expect(inv.amount).toBe("250.5");
    expect(inv.asset).toBe("USDC");
    expect(loadInvoices()).toHaveLength(1);
  });

  it("createInvoice increments invoice numbers and normalizes asset code", async () => {
    await createInvoice(BASE_FORM);
    const second = await createInvoice({ ...BASE_FORM, amount: "10", asset: " xlm " });
    expect(second.invoiceNumber).toBe("INV-00002");
    expect(second.asset).toBe("XLM");
  });

  it("createInvoice tolerates missing optional fields", async () => {
    const inv = await createInvoice({ recipient: "GX", amount: "5" });
    expect(inv.clientName).toBe("GX");
    expect(inv.description).toBe("Invoice");
    expect(inv.asset).toBe("XLM");
    expect(inv.dueDate).toBeTruthy();
    expect(String(inv.createdAt)).toBeTruthy();
  });

  it("updateInvoiceStatus persists the new status", async () => {
    const inv = await createInvoice(BASE_FORM);
    expect(updateInvoiceStatus(inv.id, "sent")).toBe(true);
    expect(loadInvoices()[0].status).toBe("sent");
    expect(updateInvoiceStatus("missing-id", "paid")).toBe(false);
  });

  it("deleteInvoice removes the record", async () => {
    const a = await createInvoice(BASE_FORM);
    const b = await createInvoice({ ...BASE_FORM, clientName: "Other" });
    expect(deleteInvoice(a.id)).toBe(true);
    const left = loadInvoices();
    expect(left).toHaveLength(1);
    expect(left[0].id).toBe(b.id);
    expect(deleteInvoice(a.id)).toBe(false);
  });

  it("buildInvoiceNumber scans existing numbers", () => {
    expect(buildInvoiceNumber([])).toBe("INV-00001");
    const items: Invoice[] = [
      {
        id: "1",
        invoiceNumber: "INV-00007",
        status: "draft",
        clientName: "A",
        clientEmail: "",
        description: "",
        amount: "1",
        asset: "XLM",
        createdAt: "",
        dueDate: "",
      },
      {
        id: "2",
        invoiceNumber: "INV-00003",
        status: "paid",
        clientName: "B",
        clientEmail: "",
        description: "",
        amount: "2",
        asset: "XLM",
        createdAt: "",
        dueDate: "",
      },
    ];
    expect(buildInvoiceNumber(items)).toBe("INV-00008");
  });
});

describe("summarizeInvoices", () => {
  const mk = (over: Partial<Invoice>): Invoice => ({
    id: over.id ?? "x",
    invoiceNumber: "INV-00001",
    status: (over.status as Invoice["status"]) ?? "draft",
    clientName: "A",
    clientEmail: "",
    description: "",
    amount: over.amount ?? "0",
    asset: "XLM",
    createdAt: "",
    dueDate: "",
  });

  it("aggregates totals per status and outstanding amounts", () => {
    const invoices = [
      mk({ id: "1", status: "draft", amount: "100" }),
      mk({ id: "2", status: "sent", amount: "200" }),
      mk({ id: "3", status: "paid", amount: "300" }),
      mk({ id: "4", status: "overdue", amount: "50.5" }),
    ];
    const s = summarizeInvoices(invoices);
    expect(s.total).toBeCloseTo(650.5);
    expect(s.byStatus.draft).toBeCloseTo(100);
    expect(s.byStatus.sent).toBeCloseTo(200);
    expect(s.byStatus.paid).toBeCloseTo(300);
    expect(s.byStatus.overdue).toBeCloseTo(50.5);
    // outstanding = sent + overdue (unpaid issued amounts)
    expect(s.outstanding).toBeCloseTo(250.5);
  });

  it("is resilient to non-numeric amounts", () => {
    const s = summarizeInvoices([mk({ status: "paid", amount: "abc" })]);
    expect(s.total).toBe(0);
    expect(s.byStatus.paid).toBe(0);
  });
});

describe("sendInvoiceReminder", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("records lastReminderAt on the invoice", async () => {
    const inv = await createInvoice(BASE_FORM);
    expect(sendInvoiceReminder(inv)).toBe(true);
    const stored = loadInvoices();
    expect(stored[0].lastReminderAt).toBeTruthy();
  });

  it("falls back to a generic mailto when no client email", async () => {
    const inv = await createInvoice({ recipient: "GX", amount: "1" });
    expect(sendInvoiceReminder(inv)).toBe(true);
  });
});