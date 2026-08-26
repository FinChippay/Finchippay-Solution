/**
 * lib/invoices.ts
 * Invoice domain: data model, localStorage persistence, and reminder helpers.
 *
 * Invoice records live in localStorage (there is no backend invoice API yet),
 * following the same pattern as lib/paymentLinks.ts. All reads/writes are
 * guarded against the server renderer (Next.js SSR) where `window` is absent.
 *
 * Issue #602 — Invoice Dashboard & Reminders (GrantFox FWC26)
 */

export interface InvoiceFormData {
  recipient: string;
  amount: string;
  memo?: string;
  clientName?: string;
  clientEmail?: string;
  description?: string;
  dueDate?: string;
  asset?: string;
  notes?: string;
  transactionHash?: string;
  fromAddress?: string;
  toAddress?: string;
}

export type InvoiceStatus = "draft" | "sent" | "paid" | "overdue";

export interface Invoice {
  id: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  clientName: string;
  clientEmail: string;
  description: string;
  amount: string;
  asset: string;
  createdAt: string;
  dueDate: string;
  notes?: string;
  transactionHash?: string;
  lastReminderAt?: string;
}

export const INVOICE_STATUSES: InvoiceStatus[] = ["draft", "sent", "paid", "overdue"];

export const INVOICES_STORAGE_KEY = "finchippay.invoices.v1";

/** True only when running in the browser (guards against SSR). */
function hasWindow(): boolean {
  return typeof window !== "undefined";
}

/** Read all invoices from localStorage (empty array when absent/corrupt). */
export function loadInvoices(): Invoice[] {
  if (!hasWindow()) return [];
  try {
    const raw = window.localStorage.getItem(INVOICES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Invoice[]) : [];
  } catch {
    return [];
  }
}

/** Persist the full invoice list to localStorage. */
export function saveInvoices(invoices: Invoice[]): void {
  if (!hasWindow()) return;
  try {
    window.localStorage.setItem(INVOICES_STORAGE_KEY, JSON.stringify(invoices));
  } catch (err) {
    // Quota exceeded or storage unavailable — keep the app functional.
    console.error("[invoices] failed to persist", err);
  }
}

/** Build a human-friendly invoice number (e.g. INV-00042). */
export function buildInvoiceNumber(invoices: Invoice[]): string {
  const max = invoices.reduce((acc, inv) => {
    const match = /INV-(\d+)/.exec(inv.invoiceNumber || "");
    const n = match ? parseInt(match[1], 10) : 0;
    return Number.isFinite(n) && n > acc ? n : acc;
  }, 0);
  return `INV-${String(max + 1).padStart(5, "0")}`;
}

/** Create a new invoice and persist it. Resolves with the created invoice. */
export function createInvoice(data: InvoiceFormData): Promise<Invoice> {
  const invoices = loadInvoices();
  const now = new Date();
  const invoice: Invoice = {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `inv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    invoiceNumber: buildInvoiceNumber(invoices),
    status: "draft",
    clientName: data.clientName?.trim() || data.recipient?.trim() || "Unknown client",
    clientEmail: data.clientEmail?.trim() || "",
    description: data.description?.trim() || data.memo?.trim() || "Invoice",
    amount: data.amount || "0",
    asset: data.asset?.trim().toUpperCase() || "XLM",
    createdAt: now.toISOString(),
    dueDate: data.dueDate || now.toISOString().split("T")[0],
    notes: data.notes?.trim(),
    transactionHash: data.transactionHash?.trim(),
  };
  invoices.push(invoice);
  saveInvoices(invoices);
  return Promise.resolve(invoice);
}

/** Update a single invoice's status and persist. Returns true when found. */
export function updateInvoiceStatus(id: string, status: InvoiceStatus): boolean {
  const invoices = loadInvoices();
  const idx = invoices.findIndex((inv) => inv.id === id);
  if (idx === -1) return false;
  invoices[idx] = { ...invoices[idx], status };
  saveInvoices(invoices);
  return true;
}

/** Delete an invoice by id. Returns true when found. */
export function deleteInvoice(id: string): boolean {
  const invoices = loadInvoices();
  const next = invoices.filter((inv) => inv.id !== id);
  if (next.length === invoices.length) return false;
  saveInvoices(next);
  return true;
}

/**
 * Send a reminder for an invoice. Uses the browser's `mailto:` hand-off so it
 * works with any installed mail client without server infra, and records the
 * reminder timestamp locally. Returns true when a reminder was dispatched.
 */
export function sendInvoiceReminder(invoice: Invoice): boolean {
  if (!hasWindow()) return false;
  const subject = encodeURIComponent(`Invoice ${invoice.invoiceNumber} — Payment Reminder`);
  const body = encodeURIComponent(
    `Hi ${invoice.clientName},\n\n` +
      `This is a friendly reminder about invoice ${invoice.invoiceNumber} ` +
      `for ${invoice.amount} ${invoice.asset}, due ${invoice.dueDate}.\n\n` +
      `Description: ${invoice.description}\n\nThanks!`,
  );
  const mailto = invoice.clientEmail
    ? `mailto:${invoice.clientEmail}?subject=${subject}&body=${body}`
    : `mailto:?subject=${subject}&body=${body}`;
  window.location.href = mailto;

  // Record the reminder timestamp locally.
  const invoices = loadInvoices();
  const idx = invoices.findIndex((inv) => inv.id === invoice.id);
  if (idx !== -1) {
    invoices[idx] = { ...invoices[idx], lastReminderAt: new Date().toISOString() };
    saveInvoices(invoices);
  }
  return true;
}

/**
 * Generate a printable invoice PDF using jsPDF (same stack as
 * lib/generatePDF.ts receipts). Kept here so InvoiceDetail's "Download PDF"
 * action works end-to-end.
 */
export async function generateInvoicePDF(invoice: Invoice): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF();

  const primaryColor: [number, number, number] = [99, 102, 241];
  const darkColor: [number, number, number] = [15, 23, 42];

  // Header — Finchippay branding
  doc.setFillColor(...primaryColor);
  doc.rect(0, 0, 210, 40, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(24);
  doc.setFont("helvetica", "bold");
  doc.text("Finchippay", 20, 25);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text("Invoice", 20, 33);

  // Invoice meta
  doc.setTextColor(...darkColor);
  let yPos = 55;
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(`Invoice ${invoice.invoiceNumber}`, 20, yPos);
  yPos += 7;
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Status: ${invoice.status.toUpperCase()}`, 20, yPos);
  yPos += 6;
  doc.text(`Created: ${formatDate(invoice.createdAt)}`, 20, yPos);
  yPos += 6;
  doc.text(`Due: ${formatDate(invoice.dueDate)}`, 20, yPos);

  // Bill to
  yPos += 10;
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("Bill To", 20, yPos);
  yPos += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(invoice.clientName || "—", 20, yPos);
  yPos += 5;
  doc.text(invoice.clientEmail || "—", 20, yPos);

  // Amount + description table
  yPos += 8;
  autoTable(doc, {
    startY: yPos,
    head: [["Description", "Amount"]],
    body: [
      [invoice.description || "Invoice", `${invoice.amount} ${invoice.asset}`],
    ],
    headStyles: { fillColor: primaryColor, fontSize: 10 },
    styles: { fontSize: 10 },
  });

  doc.save(`invoice-${invoice.invoiceNumber}.pdf`);
}

/** Aggregate totals (per status + grand total) for the dashboard. */
export function summarizeInvoices(invoices: Invoice[]): {
  total: number;
  byStatus: Record<InvoiceStatus, number>;
  outstanding: number;
} {
  const byStatus: Record<InvoiceStatus, number> = {
    draft: 0,
    sent: 0,
    paid: 0,
    overdue: 0,
  };
  let total = 0;
  for (const inv of invoices) {
    const amount = Number.parseFloat(inv.amount);
    const value = Number.isFinite(amount) ? amount : 0;
    total += value;
    byStatus[inv.status] += value;
  }
  // "Outstanding" = unpaid amounts (sent + overdue; drafts are not yet issued).
  const outstanding = byStatus.sent + byStatus.overdue;
  return { total, byStatus, outstanding };
}
