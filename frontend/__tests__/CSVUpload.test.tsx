import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CSVUpload from "../components/CSVUpload";

jest.mock("papaparse", () => ({
  parse: jest.fn((file, config) => {
    // Simulate Papa Parse behavior based on file name
    if (file.name === "valid.csv") {
      config.complete({
        data: [
          ["recipient", "amount", "asset", "memo"],
          [
            "GA2C5RFPE6GCKMY3US5PAB4UZLKIGF42QD2VXYL43AYVR2AKXT672LAE",
            "10",
            "XLM",
            "Payment 1",
          ],
          [
            "GBBD47IFQTWJG7QNO6O74H5GLT4H3PTJQ4XHMFNKDQYSCY5BXKDY3J7B",
            "20",
            "XLM",
            "Payment 2",
          ],
        ],
      });
    } else if (file.name === "invalid.csv") {
      config.complete({
        data: [
          ["recipient", "amount", "asset", "memo"],
          ["INVALID_ADDRESS", "-10", "XLM", "Bad payment"],
        ],
      });
    } else if (file.name === "empty.csv") {
      config.complete({ data: [] });
    } else if (file.name === "headers-only.csv") {
      config.complete({
        data: [["recipient", "amount", "asset", "memo"]],
      });
    } else if (file.name === "large.csv") {
      const data = [["recipient", "amount", "asset", "memo"]];
      for (let i = 0; i < 150; i++) {
        data.push([
          "GA2C5RFPE6GCKMY3US5PAB4UZLKIGF42QD2VXYL43AYVR2AKXT672LAE",
          String(1 + Math.random() * 100),
          "XLM",
          `Payment ${i + 1}`,
        ]);
      }
      config.complete({ data });
    }
  }),
}));

jest.mock("@/lib/stellar", () => ({
  isValidStellarAddress: jest.fn(
    (addr: string) => addr.startsWith("G") && addr.length === 56
  ),
}));

describe("CSVUpload Component", () => {
  const mockOnImport = jest.fn();
  const mockOnCancel = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders upload step with drag-and-drop zone", () => {
    render(<CSVUpload onImport={mockOnImport} onCancel={mockOnCancel} />);
    expect(
      screen.getByText("Drag and drop your CSV file here")
    ).toBeInTheDocument();
    expect(screen.getByText(/browse/i)).toBeInTheDocument();
    expect(screen.getByText("📥 Download template")).toBeInTheDocument();
  });

  it("handles file selection and transitions to mapping step", async () => {
    render(<CSVUpload onImport={mockOnImport} onCancel={mockOnCancel} />);

    const file = new File(
      [
        "recipient,amount,asset,memo\nGA2C5RFPE6GCKMY3US5PAB4UZLKIGF42QD2VXYL43AYVR2AKXT672LAE,10,XLM,Test",
      ],
      "valid.csv",
      { type: "text/csv" }
    );

    const browseButton = screen.getByText(/browse/i);
    fireEvent.click(browseButton);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(fileInput, "files", {
      value: [file],
    });

    fireEvent.change(fileInput);

    await waitFor(() => {
      expect(screen.getByText("Map CSV columns to payment fields")).toBeInTheDocument();
    });
  });

  it("displays column mapping UI with dropdown selectors", async () => {
    render(<CSVUpload onImport={mockOnImport} onCancel={mockOnCancel} />);

    const file = new File(
      ["recipient,amount,asset,memo\nG...,10,XLM,Test"],
      "valid.csv",
      { type: "text/csv" }
    );

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(fileInput, "files", {
      value: [file],
    });

    fireEvent.change(fileInput);

    await waitFor(() => {
      expect(screen.getByText(/Recipient Address/i)).toBeInTheDocument();
      expect(screen.getByText(/Amount/i)).toBeInTheDocument();
    });
  });

  it("validates rows and shows preview with status indicators", async () => {
    render(<CSVUpload onImport={mockOnImport} onCancel={mockOnCancel} />);

    const file = new File(
      [
        "recipient,amount,asset,memo\nGA2C5RFPE6GCKMY3US5PAB4UZLKIGF42QD2VXYL43AYVR2AKXT672LAE,10,XLM,Test",
      ],
      "valid.csv",
      { type: "text/csv" }
    );

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(fileInput, "files", {
      value: [file],
    });

    fireEvent.change(fileInput);

    await waitFor(() => {
      const recipientSelects = screen.getAllByDisplayValue("Not mapped");
      expect(recipientSelects.length).toBeGreaterThan(0);
    });

    // Map columns
    const selects = screen.getAllByRole("combobox");
    await userEvent.selectOption(selects[0], "0"); // recipient
    await userEvent.selectOption(selects[1], "1"); // amount

    const continueButton = screen.getByText(/Continue to preview/i);
    fireEvent.click(continueButton);

    await waitFor(() => {
      expect(screen.getByText(/Preview/i)).toBeInTheDocument();
    });
  });

  it("allows importing valid rows and calls onImport callback", async () => {
    render(<CSVUpload onImport={mockOnImport} onCancel={mockOnCancel} />);

    const file = new File(
      [
        "recipient,amount,asset,memo\nGA2C5RFPE6GCKMY3US5PAB4UZLKIGF42QD2VXYL43AYVR2AKXT672LAE,10,XLM,Test1\nGBBD47IFQTWJG7QNO6O74H5GLT4H3PTJQ4XHMFNKDQYSCY5BXKDY3J7B,20,XLM,Test2",
      ],
      "valid.csv",
      { type: "text/csv" }
    );

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(fileInput, "files", {
      value: [file],
    });

    fireEvent.change(fileInput);

    // Wait for mapping step
    await waitFor(() => {
      expect(screen.getByText("Map CSV columns to payment fields")).toBeInTheDocument();
    });

    // Map columns
    const selects = screen.getAllByRole("combobox");
    await userEvent.selectOption(selects[0], "0"); // recipient
    await userEvent.selectOption(selects[1], "1"); // amount

    // Continue to preview
    const continueButton = screen.getByText(/Continue to preview/i);
    fireEvent.click(continueButton);

    await waitFor(() => {
      expect(screen.getByText(/Preview/i)).toBeInTheDocument();
    });

    // Import valid rows
    const importButton = screen.getByText(/Import.*valid rows/i);
    fireEvent.click(importButton);

    await waitFor(() => {
      expect(mockOnImport).toHaveBeenCalledWith(expect.any(Array));
      const importedRows = mockOnImport.mock.calls[0][0];
      expect(importedRows.length).toBe(2);
    });
  });

  it("handles large CSV files (100+ rows) without UI freeze", async () => {
    render(<CSVUpload onImport={mockOnImport} onCancel={mockOnCancel} />);

    const file = new File(["large csv content"], "large.csv", {
      type: "text/csv",
    });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(fileInput, "files", {
      value: [file],
    });

    const startTime = performance.now();
    fireEvent.change(fileInput);

    await waitFor(() => {
      expect(screen.getByText("Map CSV columns to payment fields")).toBeInTheDocument();
    });

    const endTime = performance.now();
    const parseTime = endTime - startTime;

    // Ensure parsing didn't take too long (reasonable threshold)
    expect(parseTime).toBeLessThan(5000); // 5 seconds is a reasonable threshold
  });

  it("shows validation errors for invalid data", async () => {
    render(<CSVUpload onImport={mockOnImport} onCancel={mockOnCancel} />);

    const file = new File(
      ["recipient,amount,asset,memo\nINVALID_ADDRESS,-10,XLM,BadPayment"],
      "invalid.csv",
      { type: "text/csv" }
    );

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(fileInput, "files", {
      value: [file],
    });

    fireEvent.change(fileInput);

    await waitFor(() => {
      expect(screen.getByText("Map CSV columns to payment fields")).toBeInTheDocument();
    });

    const selects = screen.getAllByRole("combobox");
    await userEvent.selectOption(selects[0], "0"); // recipient
    await userEvent.selectOption(selects[1], "1"); // amount

    const continueButton = screen.getByText(/Continue to preview/i);
    fireEvent.click(continueButton);

    await waitFor(() => {
      expect(screen.getByText(/Preview/i)).toBeInTheDocument();
      expect(screen.getByText(/Invalid Stellar address/i)).toBeInTheDocument();
      expect(screen.getByText(/Invalid amount/i)).toBeInTheDocument();
    });
  });

  it("rejects non-CSV files with error message", async () => {
    render(<CSVUpload onImport={mockOnImport} onCancel={mockOnCancel} />);

    const file = new File(["not csv content"], "data.txt", {
      type: "text/plain",
    });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(fileInput, "files", {
      value: [file],
    });

    fireEvent.change(fileInput);

    await waitFor(() => {
      expect(screen.getByText("Please select a CSV file")).toBeInTheDocument();
    });
  });

  it("allows inline editing of row data in preview", async () => {
    render(<CSVUpload onImport={mockOnImport} onCancel={mockOnCancel} />);

    const file = new File(
      [
        "recipient,amount,asset,memo\nGA2C5RFPE6GCKMY3US5PAB4UZLKIGF42QD2VXYL43AYVR2AKXT672LAE,10,XLM,Test",
      ],
      "valid.csv",
      { type: "text/csv" }
    );

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(fileInput, "files", {
      value: [file],
    });

    fireEvent.change(fileInput);

    await waitFor(() => {
      expect(screen.getByText("Map CSV columns to payment fields")).toBeInTheDocument();
    });

    const selects = screen.getAllByRole("combobox");
    await userEvent.selectOption(selects[0], "0");
    await userEvent.selectOption(selects[1], "1");

    const continueButton = screen.getByText(/Continue to preview/i);
    fireEvent.click(continueButton);

    await waitFor(() => {
      const inputs = screen.getAllByRole("textbox");
      expect(inputs.length).toBeGreaterThan(0);
    });
  });
});
