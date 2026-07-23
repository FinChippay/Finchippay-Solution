/**
 * utils/export.ts
 * Transaction export utilities: CSV (papaparse) and PDF (jspdf + jspdf-autotable).
 */

import Papa from "papaparse";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { PaymentRecord, explorerUrl } from "@/lib/stellar";
import { formatDate } from "@/utils/format";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ExportFormat = "csv" | "pdf";

export interface ExportOptions {
  /** Public key of the account (shown in PDF header). */
  accountAddress: string;
  /** Optional date range label for the PDF header. */
  dateRangeLabel?: string;
  /** Network label (e.g. "Testnet" / "Mainnet") for PDF footer. */
  networkLabel?: string;
}

// ─── CSV Columns ──────────────────────────────────────────────────────────────

const CSV_HEADERS = [
  "Date",
  "Type",
  "From",
  "To",
  "Amount",
  "Asset",
  "Memo",
  "Transaction Hash",
  "Explorer Link",
] as const;

function paymentToRow(payment: PaymentRecord): string[] {
  const date = formatDate(payment.createdAt);
  const type = payment.type === "sent" ? "Sent" : "Received";
  const amount = payment.amount;
  const asset = payment.asset ?? "XLM";
  const link = explorerUrl(payment.transactionHash) ?? "";

  return [
    date,
    type,
    payment.from,
    payment.to,
    amount,
    asset,
    payment.memo ?? "",
    payment.transactionHash,
    link,
  ];
}

// ─── CSV Export ───────────────────────────────────────────────────────────────

/**
 * Generate an RFC 4180-compliant CSV string from payment records using papaparse.
 */
export function generateCSV(payments: PaymentRecord[]): string {
  const rows = payments.map(paymentToRow);

  return Papa.unparse({
    fields: [...CSV_HEADERS],
    data: rows,
  });
}

/**
 * Trigger a browser file download of a CSV string.
 */
export function downloadCSV(csvString: string, dateStamp: string): void {
  const filename = `finchippay-transactions-${dateStamp}.csv`;
  triggerDownload(csvString, filename, "text/csv;charset=utf-8;");
}

// ─── PDF Export ───────────────────────────────────────────────────────────────

/**
 * Finchippay brand colours used in the PDF statement.
 */
const BRAND = {
  primary: [56, 189, 248] as [number, number, number], // sky-400 ≈ stellar-400
  dark: [15, 23, 42] as [number, number, number],       // slate-900
  muted: [100, 116, 139] as [number, number, number],    // slate-500
  lightBg: [241, 245, 249] as [number, number, number],  // slate-100
  white: [255, 255, 255] as [number, number, number],
  red: [239, 68, 68] as [number, number, number],        // red-500
  green: [34, 197, 94] as [number, number, number],       // green-500
};

/**
 * SVG star logo drawn inline for the PDF header (no external asset needed).
 */
function drawFinchippayLogo(doc: jsPDF, x: number, y: number, size: number): void {
  const cx = x + size / 2;
  const cy = y + size / 2;
  const outerR = size / 2;

  // Draw a branded circle with "F" monogram
  doc.setFillColor(...BRAND.primary);
  doc.circle(cx, cy, outerR, "F");
  doc.setTextColor(...BRAND.white);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(size * 0.5);
  doc.text("F", cx, cy + size * 0.17, { align: "center" });
}

/**
 * Generate a PDF Blob containing a branded Finchippay transaction statement.
 */
export function generatePDF(
  payments: PaymentRecord[],
  options: ExportOptions
): Blob {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const usableWidth = pageWidth - margin * 2;

  // ── Header ────────────────────────────────────────────────────────────────
  let y = 10;

  // Logo + brand name
  drawFinchippayLogo(doc, margin, y, 10);
  doc.setTextColor(...BRAND.dark);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Finchippay", margin + 13, y + 7);

  // "Transaction Statement" label
  doc.setTextColor(...BRAND.muted);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Transaction Statement", margin + 13, y + 12);

  y += 18;

  // Divider line
  doc.setDrawColor(...BRAND.primary);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageWidth - margin, y);
  y += 6;

  // Account address
  doc.setTextColor(...BRAND.dark);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("Account:", margin, y);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...BRAND.muted);
  doc.text(options.accountAddress, margin + 18, y);

  // Network
  if (options.networkLabel) {
    doc.setTextColor(...BRAND.dark);
    doc.setFont("helvetica", "bold");
    doc.text("Network:", pageWidth - margin - 50, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...BRAND.muted);
    doc.text(options.networkLabel, pageWidth - margin - 28, y);
  }

  y += 5;

  // Date range
  if (options.dateRangeLabel) {
    doc.setTextColor(...BRAND.dark);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("Period:", margin, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...BRAND.muted);
    doc.text(options.dateRangeLabel, margin + 15, y);
    y += 5;
  }

  // Record count
  doc.setTextColor(...BRAND.muted);
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.text(`${payments.length} transaction${payments.length !== 1 ? "s" : ""}`, margin, y);

  y += 6;

  // ── Table ─────────────────────────────────────────────────────────────────
  const tableHeaders = [
    "Date",
    "Type",
    "From",
    "To",
    "Amount",
    "Asset",
    "Memo",
    "Transaction Hash",
    "Explorer Link",
  ];

  const tableRows = payments.map((p) => [
    formatDate(p.createdAt),
    p.type === "sent" ? "Sent" : "Received",
    p.from,
    p.to,
    p.amount,
    p.asset ?? "XLM",
    p.memo ?? "",
    p.transactionHash,
    explorerUrl(p.transactionHash) ?? "",
  ]);

  autoTable(doc, {
    head: [tableHeaders],
    body: tableRows,
    startY: y,
    margin: { left: margin, right: margin },
    styles: {
      fontSize: 7,
      cellPadding: 2,
      lineColor: [226, 232, 240],
      lineWidth: 0.1,
    },
    headStyles: {
      fillColor: BRAND.primary,
      textColor: BRAND.white,
      fontStyle: "bold",
      fontSize: 7,
    },
    bodyStyles: {
      fillColor: BRAND.white,
      textColor: BRAND.dark,
    },
    alternateRowStyles: {
      fillColor: BRAND.lightBg,
    },
    columnStyles: {
      0: { cellWidth: 28 },  // Date
      1: { cellWidth: 14 },  // Type
      2: { cellWidth: 36 },  // From
      3: { cellWidth: 36 },  // To
      4: { cellWidth: 18 },  // Amount
      5: { cellWidth: 14 },  // Asset
      6: { cellWidth: 24 },  // Memo
      7: { cellWidth: 38 },  // Hash
      8: { cellWidth: 36 },  // Explorer Link
    },
  });

  // ── Footer ────────────────────────────────────────────────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setTextColor(...BRAND.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.text(
      `Generated by Finchippay Solution · Page ${i} of ${pageCount}`,
      margin,
      doc.internal.pageSize.getHeight() - 6
    );
  }

  return doc.output("blob");
}

/**
 * Trigger a browser file download of the PDF blob.
 */
export function downloadPDF(blob: Blob, dateStamp: string): void {
  const url = URL.createObjectURL(blob);
  const filename = `finchippay-statement-${dateStamp}.pdf`;
  triggerDownloadUrl(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function triggerDownload(contents: string, filename: string, type: string): void {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  triggerDownloadUrl(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function triggerDownloadUrl(url: string, filename: string): void {
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
