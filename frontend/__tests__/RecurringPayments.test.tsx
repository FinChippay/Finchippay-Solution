import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RecurringPayments, { RecurringSchedule } from "../components/RecurringPayments";

const STORAGE_KEY = "finchippay:recurring-schedules";

describe("RecurringPayments Component", () => {
  const mockOnPayNow = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  it("renders empty state when no schedules exist", () => {
    render(<RecurringPayments onPayNow={mockOnPayNow} />);

    expect(screen.getByText("Recurring Payments")).toBeInTheDocument();
    expect(screen.getByText("No recurring schedules yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /\+ New schedule/i })).toBeInTheDocument();
  });

  it("'Create schedule' form validates required fields", async () => {
    const user = userEvent.setup();
    render(<RecurringPayments onPayNow={mockOnPayNow} />);

    // Open creation form
    const newScheduleBtn = screen.getByRole("button", { name: /\+ New schedule/i });
    await user.click(newScheduleBtn);

    expect(screen.getByText("New recurring payment")).toBeInTheDocument();

    // Submit with empty recipient
    const createBtn = screen.getByRole("button", { name: /^Create$/i });
    await user.click(createBtn);
    expect(screen.getByText("Recipient is required.")).toBeInTheDocument();

    // Fill recipient, leave amount empty
    const recipientInput = screen.getByPlaceholderText("G...");
    await user.type(recipientInput, "GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC3D5NZ2KMSUGSRNVO7ZFGIGSZ");
    await user.click(createBtn);
    expect(screen.getByText("Enter a valid amount.")).toBeInTheDocument();

    // Fill invalid amount (0)
    const amountInput = screen.getByPlaceholderText("0.0000000");
    await user.type(amountInput, "0");
    await user.click(createBtn);
    expect(screen.getByText("Enter a valid amount.")).toBeInTheDocument();
  });

  it("creates a schedule successfully and stores it in localStorage", async () => {
    const user = userEvent.setup();
    render(<RecurringPayments onPayNow={mockOnPayNow} />);

    await user.click(screen.getByRole("button", { name: /\+ New schedule/i }));
    await user.type(screen.getByPlaceholderText("G..."), "GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC3D5NZ2KMSUGSRNVO7ZFGIGSZ");
    await user.type(screen.getByPlaceholderText("0.0000000"), "250");
    await user.type(screen.getByPlaceholderText("Rent, Salary..."), "Monthly Rent");

    await user.click(screen.getByRole("button", { name: /^Create$/i }));

    expect(screen.queryByText("New recurring payment")).not.toBeInTheDocument();
    expect(screen.getByText("250 XLM")).toBeInTheDocument();
    expect(screen.getByText("monthly")).toBeInTheDocument();
    expect(screen.getByText("· Monthly Rent")).toBeInTheDocument();

    const storedData = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    expect(storedData).toHaveLength(1);
    expect(storedData[0].amount).toBe("250");
    expect(storedData[0].memo).toBe("Monthly Rent");
  });

  it("schedule list renders mocked data correctly", () => {
    const mockSchedules: RecurringSchedule[] = [
      {
        id: "sched-123",
        recipient: "GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC3D5NZ2KMSUGSRNVO7ZFGIGSZ",
        amount: "150.5",
        memo: "Software Subscription",
        frequency: "weekly",
        startDate: "2026-08-01",
        nextDueDate: "2026-08-01",
        createdAt: 1700000000000,
      },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mockSchedules));

    render(<RecurringPayments onPayNow={mockOnPayNow} />);

    expect(screen.getByText("150.5 XLM")).toBeInTheDocument();
    expect(screen.getByText("weekly")).toBeInTheDocument();
    expect(screen.getByText("· Software Subscription")).toBeInTheDocument();
    expect(screen.getByText(/GBRPYHIL…FGIGSZ/)).toBeInTheDocument();
  });

  it("delete schedule removes schedule and updates localStorage", async () => {
    const user = userEvent.setup();
    const mockSchedules: RecurringSchedule[] = [
      {
        id: "sched-del",
        recipient: "GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC3D5NZ2KMSUGSRNVO7ZFGIGSZ",
        amount: "50",
        memo: "Test Delete",
        frequency: "monthly",
        startDate: "2026-08-01",
        nextDueDate: "2026-08-01",
        createdAt: 1700000000000,
      },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mockSchedules));

    render(<RecurringPayments onPayNow={mockOnPayNow} />);

    expect(screen.getByText("50 XLM")).toBeInTheDocument();

    const deleteBtn = screen.getByRole("button", { name: /Delete schedule/i });
    await user.click(deleteBtn);

    expect(screen.queryByText("50 XLM")).not.toBeInTheDocument();
    expect(screen.getByText("No recurring schedules yet.")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]")).toHaveLength(0);
  });

  it("edits an existing schedule", async () => {
    const user = userEvent.setup();
    const mockSchedules: RecurringSchedule[] = [
      {
        id: "sched-edit",
        recipient: "GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC3D5NZ2KMSUGSRNVO7ZFGIGSZ",
        amount: "100",
        memo: "Original Memo",
        frequency: "weekly",
        startDate: "2026-08-01",
        nextDueDate: "2026-08-01",
        createdAt: 1700000000000,
      },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mockSchedules));

    render(<RecurringPayments onPayNow={mockOnPayNow} />);

    const editBtn = screen.getByRole("button", { name: /Edit schedule/i });
    await user.click(editBtn);

    expect(screen.getByText("Edit schedule")).toBeInTheDocument();

    const amountInput = screen.getByPlaceholderText("0.0000000");
    await user.clear(amountInput);
    await user.type(amountInput, "300");

    await user.click(screen.getByRole("button", { name: /^Save$/i }));

    expect(screen.getByText("300 XLM")).toBeInTheDocument();
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    expect(stored[0].amount).toBe("300");
  });

  it("renders due-today banner and handles Pay Now click", async () => {
    const user = userEvent.setup();
    const todayStr = new Date().toISOString().slice(0, 10);
    const mockSchedules: RecurringSchedule[] = [
      {
        id: "sched-due",
        recipient: "GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC3D5NZ2KMSUGSRNVO7ZFGIGSZ",
        amount: "75",
        memo: "Urgent Payment",
        frequency: "monthly",
        startDate: todayStr,
        nextDueDate: todayStr,
        createdAt: 1700000000000,
      },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mockSchedules));

    render(<RecurringPayments onPayNow={mockOnPayNow} />);

    expect(screen.getByText(/Due today/i)).toBeInTheDocument();

    const payNowBtn = screen.getByRole("button", { name: /Pay Now/i });
    await user.click(payNowBtn);

    expect(mockOnPayNow).toHaveBeenCalledWith({
      destination: "GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC3D5NZ2KMSUGSRNVO7ZFGIGSZ",
      amount: "75",
      memo: "Urgent Payment",
    });
  });
});
