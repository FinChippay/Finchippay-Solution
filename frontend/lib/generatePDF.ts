/**
 * lib/generatePDF.ts
 * Generate PDF receipts for transactions, localized to the active locale
 * (Issue #44 — Multi-Language PDF Receipts).
 */

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { formatAsset } from "@/utils/format";
import { formatDate as intlFormatDate, formatNumber } from "@/utils/intlFormat";
import i18n, { getCurrentLanguage } from "@/lib/i18n";

interface TransactionForPDF {
  hash: string;
  ledger: number;
  createdAt: string;
  sourceAccount: string;
  fee: string;
  memo?: string;
  amount?: string;
  asset?: string;
  from?: string;
  to?: string;
  successful: boolean;
}

const RTL_LOCALES: string[] = ["ar", "he"];

/** True when the active UI language is right-to-left (Arabic, Hebrew). */
export function isPDFLocaleRTL(locale: string = getCurrentLanguage()): boolean {
  return RTL_LOCALES.includes(locale);
}

/** BCP-47 tag used for date/number formatting of a given UI locale. */
export function toBCP47(locale: string = getCurrentLanguage()): string {
  const tags: Record<string, string> = {
    en: "en-US",
    es: "es-ES",
    fr: "fr-FR",
    ar: "ar-SA",
    he: "he-IL",
  };
  return tags[locale] ?? "en-US";
}

function t(key: string, params?: Record<string, string | number>): string {
  return i18n.t(key, params);
}

export async function generatePDFReceipt(transaction: TransactionForPDF): Promise<void> {
  const locale = getCurrentLanguage();
  const isRTL = isPDFLocaleRTL(locale);
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" }) as any; // v4.x API compatibility

  // RTL: mirror the canvas so Arabic/Hebrew text flows right-to-left.
  if (isRTL) {
    doc.setR2L(true);
  }

  // Colors
  const primaryColor: [number, number, number] = [99, 102, 241]; // Stellar blue
  const darkColor: [number, number, number] = [15, 23, 42]; // Dark slate
  const lightColor: [number, number, number] = [148, 163, 184]; // Light slate

  // Horizontal position helpers
  const leftX = isRTL ? 190 : 20;
  const leftAlign = isRTL ? "right" : "left";

  // Header - Finchippay branding
  doc.setFillColor(...primaryColor);
  doc.rect(0, 0, 210, 40, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(24);
  doc.setFont("helvetica", "bold");
  doc.text("Finchippay", leftX, 25, { align: leftAlign });

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(t("receipt.transactionReceipt"), leftX, 33, { align: leftAlign });

  // Reset text color for body
  doc.setTextColor(...darkColor);

  // Title
  let yPos = 55;
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(t("receipt.transactionDetails"), leftX, yPos, { align: leftAlign });

  yPos += 10;

  // Status badge
  if (transaction.successful) {
    doc.setFillColor(16, 185, 129); // Emerald
    doc.setTextColor(255, 255, 255);
    doc.rect(leftX, yPos, 30, 8, "F");
    doc.setFontSize(9);
    doc.text(t("receipt.confirmed"), leftX, yPos + 5.5, { align: "left" });
  } else {
    doc.setFillColor(239, 68, 68); // Red
    doc.setTextColor(255, 255, 255);
    doc.rect(leftX, yPos, 25, 8, "F");
    doc.setFontSize(9);
    doc.text(t("receipt.failed"), leftX, yPos + 5.5, { align: "left" });
  }

  yPos += 15;
  doc.setTextColor(...darkColor);

  // Amount section (if payment)
  if (transaction.amount && transaction.asset) {
    doc.setFillColor(241, 245, 249); // Light gray background
    doc.rect(leftX, yPos, 170, 25, "F");

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...lightColor);
    doc.text(t("receipt.amount"), leftX, yPos + 8, { align: leftAlign });

    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...darkColor);
    doc.text(formatAsset(transaction.amount, transaction.asset), leftX, yPos + 18, {
      align: leftAlign,
    });

    yPos += 30;
  }

  // Transaction details table
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");

  const ledgerFormatted = formatNumber(transaction.ledger, locale);
  const timestampFormatted = intlFormatDate(transaction.createdAt, locale, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  const tableData = [
    [t("receipt.transactionHash"), transaction.hash],
    [t("receipt.timestamp"), timestampFormatted],
    [t("receipt.ledger"), ledgerFormatted],
    [t("receipt.feeCharged"), `${transaction.fee} XLM`],
  ];

  if (transaction.from) {
    tableData.push([t("receipt.from"), transaction.from]);
  }

  if (transaction.to) {
    tableData.push([t("receipt.to"), transaction.to]);
  }

  if (transaction.memo) {
    tableData.push([t("receipt.memo"), transaction.memo]);
  }

  // Use autoTable plugin
  autoTable(doc, {
    startY: yPos,
    head: [],
    body: tableData,
    margin: { left: 20, right: 20 },
    styles: {
      fontSize: 9,
      cellPadding: 4,
    },
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 40 },
      1: { cellWidth: 130 },
    },
    theme: "plain",
  });

  // Footer
  const footerY = 270;
  doc.setDrawColor(...lightColor);
  doc.line(20, footerY, 190, footerY);

  doc.setFontSize(8);
  doc.setTextColor(...lightColor);
  doc.text(t("receipt.generatedBy"), leftX, footerY + 5, { align: leftAlign });

  doc.text(
    new Intl.DateTimeFormat(toBCP47(locale), {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date()),
    isRTL ? 20 : 190,
    footerY + 5,
    { align: isRTL ? "left" : "right" },
  );

  doc.text(
    t("receipt.officialNotice"),
    105,
    footerY + 10,
    { align: "center" },
  );

  // Save the PDF
  const fileName = `finchippay-receipt-${transaction.hash.substring(0, 8)}.pdf`;
  doc.save(fileName);
}