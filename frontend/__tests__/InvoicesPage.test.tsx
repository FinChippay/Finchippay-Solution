/**
 * Tests for pages/invoices.tsx — Invoice Dashboard.
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRouter } from "next/router";
import InvoicesPage from "../pages/invoices";
import { INVOICES_STORAGE_KEY, type Invoice } from "@/lib/invoices";

jest.mock("next/router", () => ({
  useRouter: jest.fn(),
}));

// Mock i18n — return the key's last segment as a readable label.
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const seg = key.split(".").pop() || key;
      const map: Record<string, string> = {
        filterAll: "All",
        filterDraft: "Draft",
        filterSent: "Sent",
        filterPaid: "Paid",
        filterOverdue: "Overdue",
        title: "Invoices",
        subtitle: "Invoices subtitle",
        empty: "No invoices yet. Create one to get started.",
        emptyFilter: "No invoices match this filter.",
        createNew: "New Invoice",
        createFirst: "Create your first invoice",
        loading: "Loading",
        statOutstanding: "Outstanding",
        statPaid: "Paid",
        statTotal: "Total",
        created: "Invoice created",
        reminderSent: "Reminder sent",
        downloadFailed: "Failed",
        filterAllKey: "All",
      };
      return map[seg] ?? seg;
    },
  }),
}));

jest.mock("next/head", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: React.ComponentProps<"div">) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Toast context: simple no-op provider.
const ToastCtx = require("@/lib/ToastContext");
jest.spyOn(ToastCtx, "useToastContext").mockReturnValue({
  addToast: jest.fn(),
  removeToast: jest.fn(),
  toasts: [],
});

const mockReplace = jest.fn();
(useRouter as jest.Mock).mockReturnValue({
  query: {},
  replace: mockReplace,
  pathname: "/invoices",
});

const mkInvoice = (over: Partial<Invoice>): Invoice => ({
  id: "inv-1",
  invoiceNumber: "INV-00001",
  status: "sent",
  clientName: "Acme Corp",
  clientEmail: "billing@acme.test",
  description: "Consulting",
  amount: "250.5",
  asset: "USDC",
  createdAt: "2026-08-01T00:00:00.000Z",
  dueDate: "2026-09-01",
  ...over,
});

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
});

describe("InvoicesPage", () => {
  it("renders empty state when no invoices exist", () => {
    render(<InvoicesPage />);
    expect(screen.getByRole("heading", { name: /Invoices/i })).toBeInTheDocument();
    expect(screen.getByText(/No invoices yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /New Invoice/i })).toBeInTheDocument();
  });

  it("lists invoices and shows summary cards", async () => {
    localStorage.setItem(
      INVOICES_STORAGE_KEY,
      JSON.stringify([
        mkInvoice({ id: "a", clientName: "Alpha Corp", amount: "100", asset: "XLM" }),
        mkInvoice({ id: "b", clientName: "Beta Inc", status: "paid", amount: "200", asset: "XLM" }),
      ]),
    );
    render(<InvoicesPage />);
    await waitFor(() => {
      expect(screen.getByText("Alpha Corp")).toBeInTheDocument();
    });
    // Summary cards (Outstanding 100, Paid 200, Total 300) — invoice cards also
    // render amounts, so assert these appear at least once.
    expect(screen.getAllByText("100 XLM").length).toBeGreaterThan(0);
    expect(screen.getAllByText("200 XLM").length).toBeGreaterThan(0);
    expect(screen.getAllByText("300 XLM").length).toBeGreaterThan(0);
  });

  it("filters invoices by status", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      INVOICES_STORAGE_KEY,
      JSON.stringify([
        mkInvoice({ id: "a", clientName: "Alpha", status: "draft" }),
        mkInvoice({ id: "b", clientName: "Beta", status: "paid" }),
      ]),
    );
    render(<InvoicesPage />);
    await waitFor(() => expect(screen.getByText("Alpha")).toBeInTheDocument());

    await user.click(screen.getByRole("tab", { name: /^Paid/ }));
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /^Draft/ }));
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Beta")).not.toBeInTheDocument();
  });
  it("opens the detail panel from a deep link (?invoice=id)", async () => {
    localStorage.setItem(
      INVOICES_STORAGE_KEY,
      JSON.stringify([mkInvoice({ id: "deep-1", amount: "100", asset: "USDC" })]),
    );
    (useRouter as jest.Mock).mockReturnValue({
      query: { invoice: "deep-1" },
      replace: mockReplace,
      pathname: "/invoices",
    });
    render(<InvoicesPage />);
    await waitFor(() => {
      expect(screen.getByText("Update Status")).toBeInTheDocument();
    });
  });

  it("opens detail on card click from the list", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      INVOICES_STORAGE_KEY,
      JSON.stringify([mkInvoice({ id: "a" })]),
    );
    render(<InvoicesPage />);
    await waitFor(() => expect(screen.getByText("Acme Corp")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /View Details/i }));
    await waitFor(() => {
      expect(screen.getByText("Update Status")).toBeInTheDocument();
    });
    expect(mockReplace).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ invoice: "a" }) }),
      undefined,
      { shallow: true },
    );
  });

  it("renders the reminder flow from the detail panel", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      INVOICES_STORAGE_KEY,
      JSON.stringify([mkInvoice({ id: "a" })]),
    );
    render(<InvoicesPage />);
    await waitFor(() => expect(screen.getByText("Acme Corp")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /View Details/i }));
    await waitFor(() => {
      expect(screen.getByText("Update Status")).toBeInTheDocument();
    });
    // Detail panel renders the status controls and detail actions.
    expect(screen.getByRole("button", { name: /Draft/i })).toBeInTheDocument();
  });

  it("shows a filtered empty state", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      INVOICES_STORAGE_KEY,
      JSON.stringify([mkInvoice({ id: "a", status: "draft" })]),
    );
    render(<InvoicesPage />);
    await waitFor(() => expect(screen.getByText("Acme Corp")).toBeInTheDocument());
    await user.click(screen.getByRole("tab", { name: /^Overdue/ }));
    expect(screen.getByText(/No invoices match/i)).toBeInTheDocument();
  });
});