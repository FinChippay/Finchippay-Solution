import { render, screen, fireEvent } from "@testing-library/react";
import TransactionAnnotations from "@/components/TransactionAnnotations";

describe("TransactionAnnotations", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders bookmark button unstyled when not bookmarked", () => {
    render(<TransactionAnnotations txId="tx-1" compact />);
    const btn = screen.getByLabelText("Bookmark transaction");
    expect(btn).toBeInTheDocument();
  });

  it("toggles bookmark on click", () => {
    render(<TransactionAnnotations txId="tx-1" compact />);
    const btn = screen.getByLabelText("Bookmark transaction");
    fireEvent.click(btn);
    expect(screen.getByLabelText("Remove bookmark")).toBeInTheDocument();
  });

  it("renders note and tags in full mode", () => {
    render(<TransactionAnnotations txId="tx-1" compact={false} />);
    expect(screen.getByText("Add bookmark")).toBeInTheDocument();
    expect(screen.getByText("Click to add a note")).toBeInTheDocument();
    expect(screen.getByText("Add tag")).toBeInTheDocument();
  });

  it("allows adding a note in full mode", () => {
    render(<TransactionAnnotations txId="tx-1" compact={false} />);
    fireEvent.click(screen.getByText("Click to add a note"));
    const textarea = screen.getByPlaceholderText("Add a private note...");
    expect(textarea).toBeInTheDocument();
    fireEvent.change(textarea, { target: { value: "My test note" } });
    fireEvent.click(screen.getByText("Save"));
    expect(screen.getByText("My test note")).toBeInTheDocument();
  });

  it("allows adding a tag in full mode", () => {
    render(<TransactionAnnotations txId="tx-1" compact={false} />);
    fireEvent.click(screen.getByText("Add tag"));
    const input = screen.getByLabelText("Add tag");
    fireEvent.change(input, { target: { value: "rent" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("rent")).toBeInTheDocument();
  });
});