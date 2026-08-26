import type { Meta, StoryObj } from "@storybook/react";
import { INVOICES_STORAGE_KEY, type Invoice } from "@/lib/invoices";
import InvoicesPage from "../pages/invoices";

const invoices: Invoice[] = [
  {
    id: "inv-001",
    invoiceNumber: "INV-00017",
    status: "sent",
    clientName: "Stellar Voyage Ltd",
    clientEmail: "billing@stellar-voyage.test",
    description: "Q3 integration sprint",
    amount: "250",
    asset: "USDC",
    createdAt: "2026-08-01T09:00:00.000Z",
    dueDate: "2026-09-01",
    transactionHash: "abc123",
  },
  {
    id: "inv-002",
    invoiceNumber: "INV-00018",
    status: "draft",
    clientName: "MergeOS Foundation",
    clientEmail: "ops@mergeos.test",
    description: "Design system consulting",
    amount: "120",
    asset: "XLM",
    createdAt: "2026-08-12T14:30:00.000Z",
    dueDate: "2026-09-15",
  },
  {
    id: "inv-003",
    invoiceNumber: "INV-00019",
    status: "paid",
    clientName: "Aqua Protocol",
    clientEmail: "pay@aqua.test",
    description: "M1 delivery",
    amount: "500",
    asset: "USDC",
    createdAt: "2026-07-20T08:00:00.000Z",
    dueDate: "2026-08-05",
  },
  {
    id: "inv-004",
    invoiceNumber: "INV-00020",
    status: "overdue",
    clientName: "SoroMint Studios",
    clientEmail: "finance@soromint.test",
    description: "Asset illustration pack",
    amount: "75.5",
    asset: "XLM",
    createdAt: "2026-06-15T10:00:00.000Z",
    dueDate: "2026-07-01",
  },
];

const meta = {
  title: "Pages/Invoices",
  component: InvoicesPage,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Invoice dashboard: list invoices by status, filter with tabs, view per-status totals, send payment reminders, and deep-link into the detail panel via ?invoice=<id>.",
      },
    },
  },
  play: async ({}) => {
    if (window) {
      window.localStorage.clear();
      window.localStorage.setItem(INVOICES_STORAGE_KEY, JSON.stringify(invoices));
    }
  },
} satisfies Meta<typeof InvoicesPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = {
  play: async () => {
    window.localStorage.clear();
  },
};

export const OverdueFilter: Story = {
  play: async () => {
    window.localStorage.clear();
    window.localStorage.setItem(INVOICES_STORAGE_KEY, JSON.stringify(invoices));
  },
};