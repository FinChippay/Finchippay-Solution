import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import PaymentBuilder, { type BuilderRecipient } from "../components/PaymentBuilder";

// Mock framer-motion Reorder and motion components for clean Jest testing
jest.mock("framer-motion", () => {
  return {
    Reorder: {
      Group: ({ children, axis: _axis, values: _values, onReorder: _onReorder, ...props }: any) => (
        <div data-testid="reorder-group" {...props}>
          {children}
        </div>
      ),
      Item: ({
        children,
        value,
        onDragOver,
        onDragLeave,
        onDrop,
        whileDrag: _whileDrag,
        onDragStart: _onDragStart,
        onDragEnd: _onDragEnd,
        ...props
      }: any) => (
        <div
          data-testid={`reorder-item-${value.id}`}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          {...props}
        >
          {children}
        </div>
      ),
    },
    motion: {
      button: ({
        children,
        whileHover: _whileHover,
        whileTap: _whileTap,
        initial: _initial,
        animate: _animate,
        transition: _transition,
        ...props
      }: any) => <button {...props}>{children}</button>,
      div: ({
        children,
        whileHover: _whileHover,
        whileTap: _whileTap,
        initial: _initial,
        animate: _animate,
        transition: _transition,
        ...props
      }: any) => <div {...props}>{children}</div>,
    },
  };
});

jest.mock("@/lib/stellar", () => ({
  isValidStellarAddress: jest.fn((addr: string) => addr.startsWith("G") && addr.length === 56),
}));

describe("PaymentBuilder", () => {
  const defaultPublicKey = "GDIRCSW35Z3D53C6U25J3L3V3735Y25Y333333333333333333333333";

  it("renders recipient rows, inputs, toolbar and add button", () => {
    render(<PaymentBuilder publicKey={defaultPublicKey} />);

    expect(screen.getByText("Recipient 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Redo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Add recipient" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("G...")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("0.00")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Memo (optional)")).toBeInTheDocument();
  });

  it("allows adding and removing recipient rows", async () => {
    const user = userEvent.setup();
    render(<PaymentBuilder publicKey={defaultPublicKey} />);

    const addButton = screen.getByRole("button", { name: "+ Add recipient" });
    await user.click(addButton);

    expect(screen.getByText("Recipient 1")).toBeInTheDocument();
    expect(screen.getByText("Recipient 2")).toBeInTheDocument();

    const removeButtons = screen.getAllByRole("button", { name: /remove recipient/i });
    expect(removeButtons).toHaveLength(2);
    await user.click(removeButtons[1]);

    expect(screen.queryByText("Recipient 2")).not.toBeInTheDocument();
    expect(screen.getByText("Recipient 1")).toBeInTheDocument();
  });

  it("updates address, amount, memo, and token fields", async () => {
    const user = userEvent.setup();
    const handleRecipientsChange = jest.fn();
    render(
      <PaymentBuilder publicKey={defaultPublicKey} onRecipientsChange={handleRecipientsChange} />,
    );

    const addressInput = screen.getByPlaceholderText("G...");
    const amountInput = screen.getByPlaceholderText("0.00");
    const memoInput = screen.getByPlaceholderText("Memo (optional)");
    const tokenSelect = screen.getByLabelText("Token for recipient 1");

    await user.type(addressInput, "GA2C5RFPE6GCKMY3US5PAB4UZLKIGF42QD2VXYL43AYVR2AKXT672LAE");
    await user.type(amountInput, "25.5");
    await user.type(memoInput, "Test Memo");
    await user.selectOptions(tokenSelect, "USDC");

    expect(addressInput).toHaveValue("GA2C5RFPE6GCKMY3US5PAB4UZLKIGF42QD2VXYL43AYVR2AKXT672LAE");
    expect(amountInput).toHaveValue(25.5);
    expect(memoInput).toHaveValue("Test Memo");
    expect(tokenSelect).toHaveValue("USDC");
  });

  it("supports undo and redo functionality via buttons", async () => {
    const user = userEvent.setup();
    render(<PaymentBuilder publicKey={defaultPublicKey} />);

    const undoButton = screen.getByRole("button", { name: "Undo" });
    const redoButton = screen.getByRole("button", { name: "Redo" });

    expect(undoButton).toBeDisabled();
    expect(redoButton).toBeDisabled();

    const addButton = screen.getByRole("button", { name: "+ Add recipient" });
    await user.click(addButton);

    expect(screen.getByText("Recipient 2")).toBeInTheDocument();
    expect(undoButton).not.toBeDisabled();

    // Click Undo
    await user.click(undoButton);
    expect(screen.queryByText("Recipient 2")).not.toBeInTheDocument();
    expect(redoButton).not.toBeDisabled();

    // Click Redo
    await user.click(redoButton);
    expect(screen.getByText("Recipient 2")).toBeInTheDocument();
  });

  it("supports undo and redo via keyboard shortcuts (Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y)", async () => {
    const user = userEvent.setup();
    render(<PaymentBuilder publicKey={defaultPublicKey} />);

    const addButton = screen.getByRole("button", { name: "+ Add recipient" });
    await user.click(addButton);
    expect(screen.getByText("Recipient 2")).toBeInTheDocument();

    // Trigger Ctrl+Z
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(screen.queryByText("Recipient 2")).not.toBeInTheDocument();

    // Trigger Ctrl+Shift+Z (Redo)
    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    expect(screen.getByText("Recipient 2")).toBeInTheDocument();

    // Trigger Ctrl+Z again
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(screen.queryByText("Recipient 2")).not.toBeInTheDocument();

    // Trigger Ctrl+Y (Redo)
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    expect(screen.getByText("Recipient 2")).toBeInTheDocument();
  });

  it("supports keyboard navigation and reordering with Space and Arrow keys", async () => {
    const initialRecipients: BuilderRecipient[] = [
      { id: "1", address: "GAAA", amount: "10", memo: "first", token: { code: "XLM" } },
      { id: "2", address: "GBBB", amount: "20", memo: "second", token: { code: "USDC" } },
    ];

    render(<PaymentBuilder publicKey={defaultPublicKey} initialRecipients={initialRecipients} />);

    const dragHandles = screen.getAllByRole("button", { name: /drag to reorder/i });
    expect(dragHandles).toHaveLength(2);

    const firstHandle = dragHandles[0];

    // Pick up recipient 1
    fireEvent.keyDown(firstHandle, { key: " " });
    expect(screen.getByText("Moving (Use Arrow Keys)")).toBeInTheDocument();

    // Move down
    fireEvent.keyDown(firstHandle, { key: "ArrowDown" });

    // Drop recipient
    fireEvent.keyDown(firstHandle, { key: " " });
    expect(screen.queryByText("Moving (Use Arrow Keys)")).not.toBeInTheDocument();
  });

  it("handles cancel reorder with Escape key", async () => {
    render(<PaymentBuilder publicKey={defaultPublicKey} />);

    const dragHandle = screen.getByRole("button", { name: /drag to reorder/i });
    fireEvent.keyDown(dragHandle, { key: " " });
    expect(screen.getByText("Moving (Use Arrow Keys)")).toBeInTheDocument();

    fireEvent.keyDown(dragHandle, { key: "Escape" });
    expect(screen.queryByText("Moving (Use Arrow Keys)")).not.toBeInTheDocument();
  });

  it("handles dropping token and amount from QuickAddPanel onto recipient rows", () => {
    const initialRecipients: BuilderRecipient[] = [
      { id: "row-1", address: "", amount: "", memo: "", token: { code: "XLM" } },
    ];

    render(<PaymentBuilder publicKey={defaultPublicKey} initialRecipients={initialRecipients} />);

    const item = screen.getByTestId("reorder-item-row-1");

    // Simulate drag over
    fireEvent.dragOver(item, {
      dataTransfer: { dropEffect: "none" },
    });

    // Drop token
    fireEvent.drop(item, {
      dataTransfer: {
        getData: (format: string) => {
          if (format === "application/json") {
            return JSON.stringify({ type: "token", value: "USDC" });
          }
          return "";
        },
      },
    });

    const tokenSelect = screen.getByLabelText("Token for recipient 1");
    expect(tokenSelect).toHaveValue("USDC");

    // Drop preset amount
    fireEvent.drop(item, {
      dataTransfer: {
        getData: (format: string) => {
          if (format === "application/json") {
            return JSON.stringify({ type: "amount", value: "100" });
          }
          return "";
        },
      },
    });

    const amountInput = screen.getByPlaceholderText("0.00");
    expect(amountInput).toHaveValue(100);
  });
});
