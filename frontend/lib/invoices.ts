// Invoice creation
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
}

export async function createInvoice(_data: InvoiceFormData): Promise<void> {
  throw new Error("createInvoice not yet implemented");
}

export async function generateInvoicePDF(_invoice: Invoice): Promise<void> {
  throw new Error("generateInvoicePDF not yet implemented");
}

export function updateInvoiceStatus(_id: string, _status: InvoiceStatus): void {
  // stub
}

export function deleteInvoice(_id: string): void {
  // stub
}
