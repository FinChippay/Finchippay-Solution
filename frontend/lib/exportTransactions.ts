import { getPaymentHistory, PaymentRecord } from "./stellar";

export interface ExportOptions {
  publicKey: string;
  startDate?: Date;
  endDate?: Date;
  type?: "all" | "sent" | "received";
  asset?: string;
}

function escapeCSV(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function exportTransactionsCSV(options: ExportOptions): Promise<string> {
  const { startDate, endDate, type = "all", asset } = options;
  const allRecords: PaymentRecord[] = [];
  let cursor: string | undefined;

  while (allRecords.length < 10000) {
    const { records, nextCursor } = await getPaymentHistory(options.publicKey, 200, cursor);
    allRecords.push(...records);
    if (!nextCursor || records.length === 0) break;
    cursor = nextCursor;
  }

  const filtered = allRecords.filter((r) => {
    const date = new Date(r.createdAt);
    if (startDate && date < startDate) return false;
    if (endDate && date > endDate) return false;
    if (type !== "all" && r.type !== type) return false;
    if (asset && r.asset !== asset) return false;
    return true;
  });

  const headers = ["Date", "Type", "Amount", "Asset", "Counterparty", "Memo", "Transaction Hash"];
  const rows = filtered.map((r) => [
    r.createdAt,
    r.type,
    r.amount,
    r.asset,
    r.type === "sent" ? r.to : r.from,
    r.memo || "",
    r.transactionHash,
  ]);

  const bom = "\uFEFF";
  const csv = [headers, ...rows]
    .map((row) => row.map(escapeCSV).join(","))
    .join("\n");

  return bom + csv;
}

export function downloadCSV(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
