// Stub: Invoice creation — to be implemented
export interface InvoiceFormData {
  recipient: string;
  amount: string;
  memo?: string;
}

export async function createInvoice(_data: InvoiceFormData): Promise<void> {
  throw new Error("createInvoice not yet implemented");
}
